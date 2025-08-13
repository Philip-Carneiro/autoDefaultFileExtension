import * as vscode from "vscode";
import * as path from "path";
import ignore from "ignore";
import type { Ignore } from "ignore";

type ExtCount = Map<string, number>;

const MAX_SCAN_FILES = 5000;
const DEFAULT_IGNORES = [".git", "node_modules", "dist", "build", "out"];

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".json": "json",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sh": "shellscript",
  ".ps1": "powershell",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".md": "markdown",
  ".sql": "sql",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".xml": "xml",
  ".toml": "toml",
  ".ini": "ini",
  ".q": "q",
};

async function getNextUntitledBase(root: vscode.Uri): Promise<string> {
  // Read the workspace root and find the smallest free N for "Untitled-N"
  const entries = await vscode.workspace.fs.readDirectory(root);
  const used = new Set<number>();

  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File) continue;
    const m = name.match(/^Untitled-(\d+)(?:\.[^/]+)?$/i);
    if (m) used.add(Number(m[1]));
  }

  let n = 1;
  while (used.has(n)) n++;
  return `Untitled-${n}`;
}

function getSetting<T>(
  key: string,
  defaultValue: T,
  contextUri?: vscode.Uri
): T {
  const section = vscode.workspace.getConfiguration(
    "autoDefaultFileExtension",
    contextUri
  );
  const inspected = section.inspect<T>(key);

  if (inspected) {
    const levels: (keyof typeof inspected)[] = [
      "workspaceFolderValue",
      "workspaceValue",
      "globalValue",
      "defaultValue",
    ];

    for (const level of levels) {
      const val = inspected[level] as unknown as T | undefined;
      if (val === undefined) continue;

      // Extra rule: ignore empty strings and continue fallback
      if (typeof val === "string") {
        if (val.trim() === "") continue;
      }

      return val;
    }
  }

  // Final fallback (includes case everything was empty)
  const value = section.get<T>(key, defaultValue);

  if (typeof value === "string" && value.trim() === "") {
    return defaultValue;
  }
  return value;
}

function isFeatureEnabled(contextUri?: vscode.Uri): boolean {
  return getSetting<boolean>("enabled", true, contextUri);
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(async (e) => {
      for (const file of e.files) {
        if (!isFeatureEnabled(file)) continue;
        try {
          await maybeAppendExtensionOnDisk(file);
        } catch (err) {
          console.error("rename error", err);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if (!doc.isUntitled) return;
      if (!isFeatureEnabled(doc.uri)) return;

      const autoSaveUntitled = getSetting<boolean>(
        "autoSaveUntitled",
        true,
        doc.uri
      );

      const ext = await resolveDesiredExtension();
      if (!ext) return;

      if (autoSaveUntitled) {
        // Automatically save in the workspace root
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!root) return;

        // Compute next global index in the root: Untitled-N
        const base = await getNextUntitledBase(root);
        const target = vscode.Uri.joinPath(root, `${base}${ext}`);

        // Write contents (if any)
        const encoder = new TextEncoder();
        const contents = encoder.encode(doc.getText());
        await vscode.workspace.fs.writeFile(target, contents);

        // 1) Close the specific Untitled doc (ensures focus on correct doc)
        await vscode.window.showTextDocument(doc, { preview: false });
        await vscode.commands.executeCommand(
          "workbench.action.closeActiveEditor"
        );

        // 2) Open the saved file
        const savedDoc = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(savedDoc, { preview: false });

        vscode.window.setStatusBarMessage(
          `AutoDefaultFileExtension: created ${path.posix.basename(
            target.path
          )}`,
          2500
        );
        return;
      }

      // Without auto-save mode: just set the language of the Untitled editor
      const lang = EXT_TO_LANG[ext.toLowerCase()];
      if (lang) {
        try {
          await vscode.languages.setTextDocumentLanguage(doc, lang);
          vscode.window.setStatusBarMessage(
            `AutoDefaultFileExtension: language applied (${lang})`,
            2500
          );
        } catch {
          /* ignore */
        }
      } else {
        vscode.window.setStatusBarMessage(
          `AutoDefaultFileExtension: suggested extension ${ext}`,
          2500
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "autoDefaultFileExtension.newFile",
      async (resource?: vscode.Uri) => {
        if (!isFeatureEnabled(resource)) {
          return;
        }
        const folder = await pickBaseFolder(resource);
        if (!folder) {
          vscode.window.showWarningMessage("No workspace is open.");
          return;
        }
        const name = await vscode.window.showInputBox({
          placeHolder: "File name (leave extension blank for auto application)",
          value: "Untitled",
        });
        if (!name) return;

        const ext = await resolveDesiredExtension();
        const finalName = hasExtension(name) ? name : ext ? name + ext : name;
        const target = vscode.Uri.joinPath(folder, finalName);

        const edit = new vscode.WorkspaceEdit();
        edit.createFile(target, {
          ignoreIfExists: false,
          overwrite: false,
          contents: new Uint8Array(),
        });
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) {
          vscode.window.showErrorMessage(`Failed to create: ${finalName}`);
          return;
        }
        const doc = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(doc);
        vscode.window.setStatusBarMessage(`Created ${finalName}`, 2500);
      }
    )
  );
}

async function maybeAppendExtensionOnDisk(file: vscode.Uri) {
  const basename = path.posix.basename(file.path);
  if (hasExtension(basename)) return;

  const ext = await resolveDesiredExtension(file);
  if (!ext) return;

  const newUri = file.with({ path: file.path + ext });
  try {
    await vscode.workspace.fs.rename(file, newUri, { overwrite: false });
    const doc = await vscode.workspace.openTextDocument(newUri);
    await vscode.window.showTextDocument(doc, { preview: false });
    vscode.window.setStatusBarMessage(`Applied extension: ${ext}`, 2000);
  } catch (err: any) {
    // If it already exists, try incremental suffix
    if (err?.code === "FileExists") {
      for (let i = 1; i < 50; i++) {
        const candidate = file.with({ path: `${file.path}-${i}${ext}` });
        try {
          await vscode.workspace.fs.rename(file, candidate, {
            overwrite: false,
          });
          const doc = await vscode.workspace.openTextDocument(candidate);
          await vscode.window.showTextDocument(doc, { preview: false });
          vscode.window.setStatusBarMessage(`Applied extension: ${ext}`, 2000);
          return;
        } catch {
          /* try next */
        }
      }
    }
  }
}

async function resolveDesiredExtension(
  contextUri?: vscode.Uri
): Promise<string | undefined> {
  // workspace > user
  const prefRaw = getSetting<string>("preferredExtension", "", contextUri);
  const pref = sanitizeExt(prefRaw || "");
  if (pref) return pref;

  // No preference -> determine dominant
  const folder =
    pickWorkspaceFolder(contextUri) ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;

  try {
    return await detectDominantExtension(folder.uri);
  } catch {
    return undefined;
  }
}

async function detectDominantExtension(
  root: vscode.Uri
): Promise<string | undefined> {
  const ig = ignore();
  for (const d of DEFAULT_IGNORES) ig.add(d);

  try {
    const giUri = vscode.Uri.joinPath(root, ".gitignore");
    const bytes = await vscode.workspace.fs.readFile(giUri);
    const text = Buffer.from(bytes).toString("utf8");
    ig.add(text.split(/\r?\n/).filter(Boolean));
  } catch {
    // No .gitignore, that's fine
  }

  const counts: ExtCount = new Map();
  let scanned = 0;
  await walk(root, "", ig, counts, () => scanned++ >= MAX_SCAN_FILES);

  if (counts.size === 0) return undefined;

  let bestExt = "";
  let bestCount = -1;
  for (const [ext, count] of counts) {
    if (count > bestCount || (count === bestCount && ext < bestExt)) {
      bestExt = ext;
      bestCount = count;
    }
  }
  return bestExt || undefined;
}

async function walk(
  base: vscode.Uri,
  rel: string,
  ig: Ignore,
  counts: ExtCount,
  abort: () => boolean
): Promise<void> {
  if (abort()) return;
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(
      rel ? vscode.Uri.joinPath(base, rel) : base
    );
  } catch {
    return;
  }

  for (const [name, type] of entries) {
    if (abort()) return;

    const relPath = rel ? `${rel}/${name}` : name;
    if (ig.ignores(relPath)) continue;

    if (type === vscode.FileType.File) {
      const ext = path.posix.extname(name);
      if (ext) counts.set(ext, (counts.get(ext) ?? 0) + 1);
    } else if (type === vscode.FileType.Directory) {
      await walk(base, relPath, ig, counts, abort);
    } else {
      // symlink/unknown: skip
    }
  }
}

function hasExtension(filename: string): boolean {
  return filename.includes(".");
}

function sanitizeExt(ext: string): string {
  ext = (ext || "").trim();
  if (!ext) return "";
  if (!ext.startsWith(".")) ext = "." + ext;
  return ext.toLowerCase();
}

function pickWorkspaceFolder(
  uri?: vscode.Uri
): vscode.WorkspaceFolder | undefined {
  if (uri) return vscode.workspace.getWorkspaceFolder(uri) || undefined;
  return vscode.workspace.workspaceFolders?.[0];
}

async function pickBaseFolder(
  resource?: vscode.Uri
): Promise<vscode.Uri | undefined> {
  // If triggered from the Explorer tree (folder), use it
  if (resource) {
    let stat: vscode.FileStat | undefined;
    try {
      stat = await vscode.workspace.fs.stat(resource);
    } catch {
      stat = undefined;
    }
    if (stat?.type === vscode.FileType.Directory) return resource;
    const parent = vscode.Uri.joinPath(resource, "..");
    return parent;
  }
  const wf = pickWorkspaceFolder()?.uri;
  return wf;
}

export function deactivate() {}
