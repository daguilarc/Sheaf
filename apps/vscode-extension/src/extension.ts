import * as vscode from "vscode";

import { RegisterRealtimeCommands } from "./commands.js";
import { ChatModel } from "./chat/chatModel.js";
import { ChatViewProvider } from "./chat/chatViewProvider.js";
import { FreshnessCoordinator } from "./freshness/freshnessCoordinator.js";
import { Log } from "./log.js";
import { SessionController } from "./sessionController.js";
import {
  CreateSessionHostFromExtensionContext,
  CreateSessionSecretsFromContext,
  CreateVscodeSessionUi,
  CreateWorkspaceSessionPreferences,
} from "./sessionWiring.js";
import { CreateSheafRealtimeStatusBar, UpdateSheafRealtimeStatusBar } from "./statusBar.js";
import { BuildVscodeToolCallSet } from "./tools/callSetBuilder.js";
import { CreateVscodeEditorAccess } from "./tools/editorAccess.js";

export { CMD_COMMIT_AND_RESPOND, CMD_TOGGLE_SESSION } from "./commands.js";

let g_session: SessionController | undefined;
let g_statusBar: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void
{
  const channel = vscode.window.createOutputChannel("Sheaf Realtime");
  const log = new Log(channel);
  context.subscriptions.push(channel);

  const statusBar = CreateSheafRealtimeStatusBar();
  g_statusBar = statusBar;
  context.subscriptions.push(statusBar);

  const host = CreateSessionHostFromExtensionContext(context);
  const secrets = CreateSessionSecretsFromContext(context);
  const prefs = CreateWorkspaceSessionPreferences();
  const ui = CreateVscodeSessionUi();

  const chatModel = new ChatModel();
  const freshnessCoordinator = new FreshnessCoordinator();
  const editorAccess = CreateVscodeEditorAccess();
  const vscodeToolCallSet = BuildVscodeToolCallSet({
    editorAccess,
    freshness: freshnessCoordinator.hooks,
  });

  const session = new SessionController(
    host,
    log,
    secrets,
    prefs,
    ui,
    {
      chatModel,
      freshnessCoordinator,
      buildVscodeToolCallSet: () => vscodeToolCallSet,
    },
    (state) =>
    {
      UpdateSheafRealtimeStatusBar(statusBar, state);
    },
  );
  g_session = session;
  UpdateSheafRealtimeStatusBar(statusBar, session.GetState());

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      new ChatViewProvider(context.extensionUri, session, chatModel),
    ),
  );

  RegisterRealtimeCommands(context, {
    toggleSession: () => session.ToggleSession(),
    commitAndRespond: () => session.CommitAndRespond(),
  });
}

export async function deactivate(): Promise<void>
{
  if (g_session !== undefined)
  {
    await g_session.Dispose();
    g_session = undefined;
  }

  g_statusBar = undefined;
}
