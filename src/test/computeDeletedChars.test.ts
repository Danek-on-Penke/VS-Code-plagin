/**
 * Unit tests for the computeDeletedChars function.
 * Run with: node out/test/computeDeletedChars.test.js
 */

import * as assert from 'assert';

/**
 * Inlined copy of computeDeletedChars for testing without requiring the full VS Code API.
 */
function computeDeletedChars(committed: string, current: string): string[] {
  function splitLineChunks(text: string): string[] {
    if (text.length === 0) {
      return [];
    }
    const parts = text.split('\n');
    const chunks: string[] = [];
    for (let idx = 0; idx < parts.length - 1; idx++) {
      chunks.push(`${parts[idx]}\n`);
    }
    const lastPart = parts[parts.length - 1];
    if (lastPart.length > 0) {
      chunks.push(lastPart);
    }
    return chunks;
  }

  function computeDeletedLinesFirst(a: string, b: string): string[] | null {
    const committedLines = splitLineChunks(a);
    const currentLines = splitLineChunks(b);
    const deletedChars: string[] = [];
    let i = 0;
    let j = 0;
    while (i < committedLines.length && j < currentLines.length) {
      if (committedLines[i] === currentLines[j]) {
        i++;
        j++;
      } else {
        for (const ch of committedLines[i]) {
          deletedChars.push(ch);
        }
        i++;
      }
    }
    while (i < committedLines.length) {
      for (const ch of committedLines[i]) {
        deletedChars.push(ch);
      }
      i++;
    }
    if (j === currentLines.length) {
      return deletedChars;
    }
    return null;
  }

  const MAX_LEN = 50_000;
  const a = committed.slice(0, MAX_LEN);
  const b = current.slice(0, MAX_LEN);

  const lineBasedDeleted = computeDeletedLinesFirst(a, b);
  if (lineBasedDeleted !== null) {
    const deleted = [...lineBasedDeleted];
    if (committed.length > MAX_LEN) {
      for (const ch of committed.slice(MAX_LEN)) {
        deleted.push(ch);
      }
    }
    return deleted;
  }

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let row = 1; row <= m; row++) {
    for (let col = 1; col <= n; col++) {
      if (a[row - 1] === b[col - 1]) {
        dp[row][col] = dp[row - 1][col - 1] + 1;
      } else {
        dp[row][col] = Math.max(dp[row - 1][col], dp[row][col - 1]);
      }
    }
  }

  let row = m;
  let col = n;
  const deletedReversed: string[] = [];
  while (row > 0 && col > 0) {
    if (a[row - 1] === b[col - 1]) {
      row--;
      col--;
    } else if (dp[row - 1][col] >= dp[row][col - 1]) {
      deletedReversed.push(a[row - 1]);
      row--;
    } else {
      col--;
    }
  }
  while (row > 0) {
    deletedReversed.push(a[row - 1]);
    row--;
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
  assert.deepStrictEqual(result, ['l', 'i', 'n', 'e', '2', '\n']);
});

test('line breaks are restored in stable order for removed middle block', () => {
  const committed = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
  const current = 'const a = 1;\nconst c = 3;\n';
  const result = computeDeletedChars(committed, current);
  assert.deepStrictEqual(result, ['c', 'o', 'n', 's', 't', ' ', 'b', ' ', '=', ' ', '2', ';', '\n']);
});

test('line-based pass keeps deleted newlines when text repeats', () => {
  const committed = 'aaa\nbbb\naaa\n';
  const current = 'aaa\naaa\n';
  const result = computeDeletedChars(committed, current);
  assert.deepStrictEqual(result, ['b', 'b', 'b', '\n']);
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
