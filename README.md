# Auto Default File Extension

Automatically assigns a file extension when creating new files.

## Decision order

1. **`autoDefaultFileExtension.enabled`** — default `true`.  
   If `false`, the extension does nothing (workspace settings > user settings).

2. **`autoDefaultFileExtension.preferredExtension`** — if set, always use it  
   (workspace settings > user settings).

3. **`autoDefaultFileExtension.autoSaveUntitled`** — default `true`.  
   When you create an `Untitled-X` file, it will be saved as `Untitled-X.[extension]` at the workspace root (workspace settings > user settings).

4. **Dominant extension in the workspace** — if no preferred extension is set, the extension scans the workspace (respecting `.gitignore`) and uses the most frequent extension.

> Note: Filenames that already contain a dot (including dotfiles like `.gitignore`) are **not** modified.

## How to use

- **Explorer → right-click a folder → “Create New File with Automatic Extension”.**
- Or run the command via **Ctrl+Alt+N** (command: `autoDefaultFileExtension.newFile`).
- If you create a new file in the Explorer **without an extension**, the extension will rename it right after creation.
- If you create an **Untitled** file (e.g., via `workbench.action.files.insertIntoNewFile` or double-click in the tab bar):
  - With `autoSaveUntitled: true`, it’s saved as `Untitled-X.[extension]` in the workspace root.
  - With `autoSaveUntitled: false`, the editor’s **language** is set based on the preferred/dominant extension, but the file remains unsaved/untitled.

## Settings

Example:

```json
{
  "autoDefaultFileExtension.enabled": true,
  "autoDefaultFileExtension.preferredExtension": ".ts",
  "autoDefaultFileExtension.autoSaveUntitled": true
}
```
