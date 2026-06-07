import { randomBytes } from "node:crypto";

import * as vscode from "vscode";

import { CMD_COMMIT_AND_RESPOND, CMD_TOGGLE_SESSION } from "../commands.js";
import type { SessionController, SessionControllerState } from "../sessionController.js";
import type { ChatBubble } from "./bubbleTypes.js";
import { ChatModel } from "./chatModel.js";

const x_postDebounceMs = 32;

function BuildChatHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
): string
{
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview", "index.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview", "index.css"));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${styleUri}" />
<title>Sheaf Chat</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export class ChatViewProvider implements vscode.WebviewViewProvider
{
  public static readonly viewType = "sheaf.chatView";

  private readonly m_extensionUri: vscode.Uri;
  private readonly m_session: SessionController;
  private readonly m_chatModel: ChatModel;
  private m_webviewView: vscode.WebviewView | undefined;
  private m_postTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(extensionUri: vscode.Uri, session: SessionController, chatModel: ChatModel)
  {
    this.m_extensionUri = extensionUri;
    this.m_session = session;
    this.m_chatModel = chatModel;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void>
  {
    this.m_webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.m_extensionUri, "out", "webview")],
    };

    const nonce = randomBytes(16).toString("base64");
    webviewView.webview.html = BuildChatHtml(webviewView.webview, this.m_extensionUri, nonce);

    webviewView.webview.onDidReceiveMessage((message: { type?: string; id?: string }) =>
    {
      if (message.type !== "command")
      {
        return;
      }

      if (message.id === "toggleSession")
      {
        void vscode.commands.executeCommand(CMD_TOGGLE_SESSION);
        return;
      }

      if (message.id === "commitAndRespond")
      {
        void vscode.commands.executeCommand(CMD_COMMIT_AND_RESPOND);
      }
    });

    const unsubModel = this.m_chatModel.subscribe(() =>
    {
      this.SchedulePostSnapshot();
    });
    const unsubState = this.m_session.OnStateChanged(() =>
    {
      this.SchedulePostSnapshot();
    });

    webviewView.onDidDispose(() =>
    {
      unsubModel();
      unsubState.dispose();
      this.CancelPostSnapshot();
      this.m_webviewView = undefined;
    });

    this.SchedulePostSnapshot();
  }

  private CancelPostSnapshot(): void
  {
    if (this.m_postTimer !== undefined)
    {
      clearTimeout(this.m_postTimer);
      this.m_postTimer = undefined;
    }
  }

  private SchedulePostSnapshot(): void
  {
    if (this.m_postTimer !== undefined)
    {
      clearTimeout(this.m_postTimer);
      this.m_postTimer = undefined;
    }

    this.m_postTimer = setTimeout(() =>
    {
      this.m_postTimer = undefined;
      this.PostSnapshotNow();
    }, x_postDebounceMs);
  }

  private PostSnapshotNow(): void
  {
    const view = this.m_webviewView;
    if (view === undefined)
    {
      return;
    }

    const bubbles: ChatBubble[] = this.m_chatModel.getSnapshot();
    const sessionState: SessionControllerState = this.m_session.GetState();
    const sessionId = this.m_session.GetActiveSessionId() ?? null;

    void view.webview.postMessage({
      type: "snapshot",
      bubbles,
      sessionState,
      sessionIdPrefix: sessionId,
    });
  }
}
