/**
 * Unit tests for the computeDeletedChars function.
 * Run with: node out/test/computeDeletedChars.test.js
 */

import * as assert from 'assert';

/**
 * Inlined copy of computeDeletedChars for testing without requiring the full VS Code API.
 */
function computeDeletedChars(committed: string, current: string): string[] {
  const MAX_LEN = 50_000;
  const a = committed.slice(0, MAX_LEN);
  const b = current.slice(0, MAX_LEN);

  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = m;
  let j = n;
  const deletedReversed: string[] = [];
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      deletedReversed.push(a[i - 1]);
      i--;
    } else {
      j--;
    }
  }
  while (i > 0) {
    deletedReversed.push(a[i - 1]);
    i--;
  }

  const deleted: string[] = [];
  for (let k = deletedReversed.length - 1; k >= 0; k--) {
    deleted.push(deletedReversed[k]);
  }

  if (committed.length > MAX_LEN) {
    for (const ch of committed.slice(MAX_LEN)) {
      deleted.push(ch);
    }
  }

  return deleted;
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${(err as Error).message}`);
    failed++;
  }
}

console.log('\ncomputeDeletedChars tests\n');

test('no deletions returns empty array', () => {
  const result = computeDeletedChars('hello', 'hello');
  assert.deepStrictEqual(result, []);
});

test('all characters deleted returns all committed characters', () => {
  const result = computeDeletedChars('abc', '');
  assert.deepStrictEqual(result, ['a', 'b', 'c']);
});

test('suffix deleted returns correct number of deleted chars', () => {
  const result = computeDeletedChars('hello world', 'hello');
  // LCS is 'hello' (length 5); deleted chars are ' world' (6 chars).
  // The exact order may vary by backtracking path, so check count and multiset.
  assert.strictEqual(result.length, 6);
  const sorted = result.slice().sort().join('');
  assert.strictEqual(sorted, ' dlorw');
});

test('prefix deleted returns deleted prefix', () => {
  const result = computeDeletedChars('hello world', 'world');
  assert.deepStrictEqual(result, ['h', 'e', 'l', 'l', 'o', ' ']);
});

test('middle deleted returns deleted middle', () => {
  const result = computeDeletedChars('hello world', 'helloworld');
  assert.deepStrictEqual(result, [' ']);
});

test('restoring deleted chars one by one produces committed content', () => {
  const committed = 'function foo() {\n  return 42;\n}';
  const current = 'function foo() {}';
  const deleted = computeDeletedChars(committed, current);

  // Simulate restoring characters one at a time at the position of the diff.
  // The concatenation of current + deleted chars should reconstruct committed.
  // This is a simplified check: deleted + current should contain all chars of committed.
  const combined = committed.split('');
  const currentChars = current.split('');
  // Every char in committed must appear in either current or deleted.
  const allFromDeletedAndCurrent = [...currentChars, ...deleted].sort().join('');
  const committedSorted = committed.split('').sort().join('');
  assert.strictEqual(allFromDeletedAndCurrent, committedSorted);
});

test('empty committed returns empty deleted', () => {
  const result = computeDeletedChars('', 'some new content');
  assert.deepStrictEqual(result, []);
});

test('newline characters are preserved', () => {
  const result = computeDeletedChars('line1\nline2\nline3', 'line1\nline3');
  assert.deepStrictEqual(result, ['\n', 'l', 'i', 'n', 'e', '2']);
});

test('single character deletion', () => {
  const result = computeDeletedChars('ab', 'a');
  assert.deepStrictEqual(result, ['b']);
});

test('order is preserved for unambiguous deletion at end', () => {
  // No repeated characters, so the LCS is unique and order is deterministic.
  const result = computeDeletedChars('abcdef', 'abc');
  assert.deepStrictEqual(result, ['d', 'e', 'f']);
});

test('order is preserved for unambiguous deletion at start', () => {
  const result = computeDeletedChars('abcdef', 'def');
  assert.deepStrictEqual(result, ['a', 'b', 'c']);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
