import * as vscode from "vscode";
import { randomUUID } from "node:crypto";

import { DictatorClient } from "./dictatorClient.js";
import { CliGitAdapter, ToRepoRelative } from "./gitAdapter.js";
import { HunkModel, type ActiveFile, type HunkModelHost } from "./hunkModel.js";
import { HunkPane } from "./pane.js";
import type { HunkAction, PaneState } from "./types.js";

const COMMANDS: Array<[string, HunkAction]> = [
  ["sheaf.hunks.previousHunk", "previousHunk"],
  ["sheaf.hunks.nextHunk", "nextHunk"],
  ["sheaf.hunks.previousFile", "previousFile"],
  ["sheaf.hunks.nextFile", "nextFile"],
  ["sheaf.hunks.stageCurrentHunk", "stage"],
  ["sheaf.hunks.revertCurrentHunk", "revert"],
  ["sheaf.hunks.undo", "undo"],
];

export function activate(context: vscode.ExtensionContext): void
{
  const windowId = context.globalState.get<string>("sheaf.hunks.windowId") ?? randomUUID();
  void context.globalState.update("sheaf.hunks.windowId", windowId);

  let model: HunkModel;
  let client: DictatorClient;
  let debounce: ReturnType<typeof setTimeout> | undefined;

  const pane = new HunkPane(context.extensionUri, (action) => {
    void RunAction(action);
  });

  const host: HunkModelHost = {
    async getActiveFile(): Promise<ActiveFile | null>
    {
      const editor = vscode.window.activeTextEditor;
      if (editor === undefined || editor.document.uri.scheme !== "file")
      {
        return null;
      }
      const git = new CliGitAdapter();
      const repoRoot = await git.findRepositoryRoot(editor.document.uri.fsPath);
      if (repoRoot === null)
      {
        return null;
      }
      return {
        absPath: editor.document.uri.fsPath,
        relativePath: ToRepoRelative(repoRoot, editor.document.uri.fsPath),
      };
    },
    async openFile(repoRoot: string, relativePath: string): Promise<void>
    {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(`${repoRoot}/${relativePath}`));
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    },
    publishState(state: PaneState): void
    {
      pane.postState(state);
      void client.publishState(state);
    },
    showPane(state: PaneState): void
    {
      pane.show(state);
    },
    hidePane(state: PaneState): void
    {
      pane.hide(state);
    },
  };

  model = new HunkModel(windowId, new CliGitAdapter(), host);
  const baseUrl = vscode.workspace.getConfiguration("sheaf.hunks").get<string>("dictatorBaseUrl") ?? "http://127.0.0.1:9003";
  client = new DictatorClient(baseUrl, windowId, async (command) => RunAction(command.action));
  client.start();

  function RefreshSoon(): void
  {
    if (debounce !== undefined)
    {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
      void model.recompute(vscode.window.state.focused);
    }, 50);
  }

  async function RunAction(action: HunkAction)
  {
    const result = await model.run(action);
    await model.recompute(vscode.window.state.focused);
    return result;
  }

  const watcher = vscode.workspace.createFileSystemWatcher("**/*");
  const gitIndexWatcher = vscode.workspace.createFileSystemWatcher("**/.git/index");

  context.subscriptions.push(
    watcher,
    gitIndexWatcher,
    vscode.window.onDidChangeWindowState(() => RefreshSoon()),
    vscode.window.onDidChangeActiveTextEditor(() => RefreshSoon()),
    vscode.workspace.onDidChangeTextDocument(() => RefreshSoon()),
    watcher.onDidChange(() => RefreshSoon()),
    watcher.onDidCreate(() => RefreshSoon()),
    watcher.onDidDelete(() => RefreshSoon()),
    gitIndexWatcher.onDidChange(() => RefreshSoon()),
    gitIndexWatcher.onDidCreate(() => RefreshSoon()),
    gitIndexWatcher.onDidDelete(() => RefreshSoon()),
  );

  for (const [command, action] of COMMANDS)
  {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, () => RunAction(action)),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("sheaf.hunks.getCurrentHunk", () => {
      return model.getState().currentHunk;
    }),
    { dispose: () => client.stop() },
  );

  RefreshSoon();
}

export function deactivate(): void
{
}
