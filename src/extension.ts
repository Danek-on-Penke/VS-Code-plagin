import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Represents the state of the recovery session for a single file.
 */
interface RecoverySession {
  /** Characters to be restored, in order. */
  pendingChars: string[];
  /** The file path being recovered. */
  filePath: string;
  /** The editor that was active when recovery started. */
  editor: vscode.TextEditor;
}

let recoverySession: RecoverySession | null = null;
let typeCommandDisposable: vscode.Disposable | null = null;

/**
 * Returns the path to the workspace's git repository root, or null if not a git repo.
 */
function getGitRoot(filePath: string): string | null {
  try {
    const dir = path.dirname(filePath);
    const result = execSync('git rev-parse --show-toplevel', {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return result;
  } catch {
    return null;
  }
}

/**
 * Retrieves the content of the given file from the last git commit (HEAD).
 * Returns null if the file is not tracked or there is no commit.
 */
function getLastCommitContent(filePath: string, gitRoot: string): string | null {
  try {
    const relPath = path.relative(gitRoot, filePath).split(path.sep).join('/');
    const content = execSync(`git show HEAD:"${relPath}"`, {
      cwd: gitRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return content;
  } catch {
    return null;
  }
}

/**
 * Splits text into line chunks preserving trailing '\n' on each complete line.
 */
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

/**
 * Tries to extract deleted characters by treating files as line sequences first.
 * Returns null when current is not a subsequence of committed at line level.
 */
function computeDeletedLinesFirst(committed: string, current: string): string[] | null {
  const committedLines = splitLineChunks(committed);
  const currentLines = splitLineChunks(current);
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

/**
 * Computes the list of characters that are in `committed` but not (yet) in `current`,
 * preserving their original order from the committed version.
 *
 * Uses line-level subsequence extraction first, then falls back to LCS.
 */
function computeDeletedChars(committed: string, current: string): string[] {
  // For very large files, limit the comparison range to avoid excessive memory usage.
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
  const deleted: string[] = [];

  // Fallback to LCS when current content is not a subsequence of committed.
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

/**
 * Starts a recovery session for the currently active editor.
 */
async function startRecovery(context: vscode.ExtensionContext): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Восстановление кода: активный редактор не найден.');
    return;
  }

  const filePath = editor.document.fileName;

  if (editor.document.isUntitled) {
    vscode.window.showErrorMessage('Восстановление кода: нельзя восстановить несохранённый файл.');
    return;
  }

  const gitRoot = getGitRoot(filePath);
  if (!gitRoot) {
    vscode.window.showErrorMessage(
      'Восстановление кода: файл находится вне git-репозитория.',
    );
    return;
  }

  const committedContent = getLastCommitContent(filePath, gitRoot);
  if (committedContent === null) {
    vscode.window.showErrorMessage(
      'Восстановление кода: не удалось получить последнюю закоммиченную версию файла. ' +
      'Убедитесь, что файл был закоммичен хотя бы один раз.',
    );
    return;
  }

  const currentContent = editor.document.getText();

  if (committedContent === currentContent) {
    vscode.window.showInformationMessage(
      'Восстановление кода: файл совпадает с последним коммитом, восстанавливать нечего.',
    );
    return;
  }

  const deletedChars = computeDeletedChars(committedContent, currentContent);

  if (deletedChars.length === 0) {
    vscode.window.showInformationMessage(
      'Восстановление кода: удалённые символы относительно последнего коммита не найдены.',
    );
    return;
  }

  // Stop any existing session first.
  stopRecovery();

  recoverySession = {
    pendingChars: deletedChars,
    filePath,
    editor,
  };

  // Override the 'type' command so every keypress restores the next character.
  // The `args.text` (the actually typed key) is intentionally ignored — each
  // keypress triggers recovery of the next deleted character instead.
  typeCommandDisposable = vscode.commands.registerCommand('type', async (_args: { text: string }) => {
    if (!recoverySession || recoverySession.pendingChars.length === 0) {
      stopRecovery();
      return;
    }

    // Use the editor captured at session start to avoid inserting into the wrong file
    // if the active editor changes between keypresses.
    const sessionEditor = recoverySession.editor;
    if (sessionEditor.document.fileName !== recoverySession.filePath) {
      stopRecovery();
      return;
    }

    const nextChar = recoverySession.pendingChars.shift()!;

    await sessionEditor.edit((editBuilder) => {
      // Insert the next deleted character at the current cursor position.
      editBuilder.insert(sessionEditor.selection.active, nextChar);
    });

    if (recoverySession.pendingChars.length === 0) {
      stopRecovery();
      vscode.window.showInformationMessage(
        'Восстановление кода: восстановление завершено.',
      );
      return;
    }
  });

  context.subscriptions.push(typeCommandDisposable);

  vscode.window.showInformationMessage(
    'Восстановление кода: режим включён. Нажимайте любые клавиши для пошагового восстановления. ' +
    'Для остановки нажмите Ctrl+Shift+R.',
  );
}

/**
 * Stops the active recovery session and restores normal typing.
 */
function stopRecovery(): void {
  if (typeCommandDisposable) {
    typeCommandDisposable.dispose();
    typeCommandDisposable = null;
  }
  recoverySession = null;
}

export function activate(context: vscode.ExtensionContext): void {
  // Register commands.
  context.subscriptions.push(
    vscode.commands.registerCommand('codeRecovery.start', () => startRecovery(context)),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codeRecovery.stop', () => {
      if (recoverySession === null) {
        vscode.window.showInformationMessage('Восстановление кода: режим не активен.');
        return;
      }
      stopRecovery();
      vscode.window.showInformationMessage('Восстановление кода: восстановление остановлено.');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codeRecovery.toggle', () => {
      if (recoverySession !== null) {
        stopRecovery();
        vscode.window.showInformationMessage('Восстановление кода: восстановление остановлено.');
      } else {
        startRecovery(context);
      }
    }),
  );

  // Stop recovery session if the user switches to a different file.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (recoverySession !== null) {
        stopRecovery();
        vscode.window.showInformationMessage('Восстановление кода: восстановление остановлено (редактор изменён).');
      }
    }),
  );
}

export function deactivate(): void {
  stopRecovery();
}
