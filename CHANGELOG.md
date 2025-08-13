# Changelog

## [1.0.0] - 2025-08-13

### Added

- First published version of the "Auto Default File Extension" extension.
- Automatic assignment of an extension to new files based on configured preference or the most frequent extension in the workspace (respecting .gitignore).
- Setting `autoDefaultFileExtension.enabled` to enable/disable functionality per workspace.
- Setting `autoDefaultFileExtension.preferredExtension` to force a default extension.
- Setting `autoDefaultFileExtension.autoSaveUntitled` to automatically save "Untitled" files with the dominant extension.
- Command `Create New File with Automatic Extension` (id: `autoDefaultFileExtension.newFile`).
- Activation on `onStartupFinished`.
