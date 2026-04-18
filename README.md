# VS-Code-plagin

## Code Recovery Extension

A VS Code extension that restores deleted code **character by character** using the last git commit. Each keypress you make recovers the next deleted character — no matter which key you press.

### How it works

1. You accidentally delete some code (e.g. a whole function).
2. Activate recovery mode with **Ctrl+Shift+R** (⌘+Shift+R on Mac).
3. Start pressing **any keys** on the keyboard. Each keypress inserts the next deleted character back into the file — instead of whatever key you pressed.
4. Keep pressing until your code is fully restored, or press **Ctrl+Shift+R** again to stop.

The extension compares the current file with the last committed version in git and computes the missing characters using a diff algorithm. Characters are restored in the order they appeared in the committed file.

### Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| **Toggle Code Recovery Mode** | Ctrl+Shift+R / ⌘+Shift+R | Start or stop recovery mode |
| **Start Code Recovery** | — | Start recovery for the active file |
| **Stop Code Recovery** | — | Stop recovery mode |

All commands are available via the Command Palette (`Ctrl+Shift+P`) under the **Code Recovery** category.

### Status bar

While recovery mode is active, the status bar shows how many characters have been restored and how many remain:

```
⟳ Recovery: 10 restored, 42 remaining
```

Clicking the status bar item toggles recovery mode.

### Requirements

- The file must belong to a git repository.
- The file must have been committed at least once (`git commit`).

### Development

```bash
npm install
npm run compile   # Compile TypeScript
npm test          # Run unit tests
npm run watch     # Watch mode
```
