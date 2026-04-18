import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Represents the state of the recovery session for a single file.
 */
interface RecoverySession {
  /** Characters to be restored, in order. */
  pendingChars: string[];
  /** Number of characters already restored in this session. */
  restoredCount: number;
  /** The file path being recovered. */
  filePath: string;
  /** The editor that was active when recovery started. */
  editor: vscode.TextEditor;
}

let recoverySession: RecoverySession | null = null;
let statusBarItem: vscode.StatusBarItem;
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
 * Computes the list of characters that are in `committed` but not (yet) in `current`,
 * preserving their original order from the committed version.
 *
 * Uses a simple LCS (longest common subsequence) diff to find deleted characters.
 */
function computeDeletedChars(committed: string, current: string): string[] {
  // For very large files, limit the comparison range to avoid excessive memory usage.
  const MAX_LEN = 50_000;
  const a = committed.slice(0, MAX_LEN);
  const b = current.slice(0, MAX_LEN);

  const m = a.length;
  const n = b.length;

  const deleted: string[] = [];

  // Build the full DP table for LCS, then backtrack to find deleted characters.
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

  // Backtrack through the DP table to collect deleted characters.
  let i = m;
  let j = n;
  const deletedReversed: string[] = [];
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      // Character a[i-1] is deleted (not in b).
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

  // Reverse to get the correct order.
  for (let k = deletedReversed.length - 1; k >= 0; k--) {
    deleted.push(deletedReversed[k]);
  }

  // Also include characters from the part of `committed` beyond MAX_LEN.
  if (committed.length > MAX_LEN) {
    for (const ch of committed.slice(MAX_LEN)) {
      deleted.push(ch);
    }
  }

  return deleted;
}

/**
 * Updates the status bar to reflect the current recovery state.
 */
function updateStatusBar(): void {
  if (recoverySession === null) {
    statusBarItem.text = '$(circle-slash) Восстановление: выкл.';
    statusBarItem.tooltip = 'Режим восстановления выключен. Нажмите Ctrl+Shift+R для запуска.';
    statusBarItem.backgroundColor = undefined;
  } else {
    const remaining = recoverySession.pendingChars.length;
    const restored = recoverySession.restoredCount;
    statusBarItem.text = `$(sync~spin) Восстановление: ${restored} восстановлено, ${remaining} осталось`;
    statusBarItem.tooltip =
      `Режим восстановления активен.\nНажмите любую клавишу, чтобы вернуть следующий удалённый символ.\n` +
      `Восстановлено: ${restored} | Осталось: ${remaining}\n` +
      `Нажмите Ctrl+Shift+R или выполните команду «Остановить восстановление кода».`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
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
    restoredCount: 0,
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
    recoverySession.restoredCount++;

    await sessionEditor.edit((editBuilder) => {
      // Insert the next deleted character at the current cursor position.
      editBuilder.insert(sessionEditor.selection.active, nextChar);
    });

    if (recoverySession.pendingChars.length === 0) {
      const totalRestored = recoverySession.restoredCount;
      stopRecovery();
      vscode.window.showInformationMessage(
        `Восстановление кода: восстановлены все удалённые символы (${totalRestored}).`,
      );
      return;
    }

    updateStatusBar();
  });

  context.subscriptions.push(typeCommandDisposable);

  updateStatusBar();
  vscode.window.showInformationMessage(
    `Восстановление кода: режим включён — к восстановлению ${deletedChars.length} символов. ` +
    `Нажимайте любые клавиши, чтобы возвращать символы по одному. Для остановки нажмите Ctrl+Shift+R.`,
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
  updateStatusBar();
}

export function activate(context: vscode.ExtensionContext): void {
  // Create the status bar item.
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'codeRecovery.toggle';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  updateStatusBar();

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
      const restored = recoverySession.restoredCount;
      const remaining = recoverySession.pendingChars.length;
      stopRecovery();
      vscode.window.showInformationMessage(
        `Восстановление кода: остановлено. Восстановлено ${restored}, осталось ${remaining}.`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('codeRecovery.toggle', () => {
      if (recoverySession !== null) {
        const restored = recoverySession.restoredCount;
        const remaining = recoverySession.pendingChars.length;
        stopRecovery();
        vscode.window.showInformationMessage(
          `Восстановление кода: остановлено. Восстановлено ${restored}, осталось ${remaining}.`,
        );
      } else {
        startRecovery(context);
      }
    }),
  );

  // Stop recovery session if the user switches to a different file.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (recoverySession !== null) {
        const restored = recoverySession.restoredCount;
        stopRecovery();
        vscode.window.showInformationMessage(
          `Восстановление кода: остановлено (редактор изменён). Восстановлено ${restored}.`,
        );
      }
    }),
  );
}

export function deactivate(): void {
  stopRecovery();
}
