type ToolLifecyclePhase = "queued" | "started" | "succeeded" | "failed";

type ChatBubble =
  | {
      kind: "user_transcript";
      id: string;
      itemId: string;
      text: string;
      complete: boolean;
      createdAt: string;
    }
  | {
      kind: "assistant_text";
      id: string;
      responseId: string;
      text: string;
      complete: boolean;
      createdAt: string;
    }
  | {
      kind: "tool_call";
      id: string;
      toolCallId: string;
      toolName: string;
      summary: string;
      phase: ToolLifecyclePhase;
      createdAt: string;
    }
  | {
      kind: "context_push";
      id: string;
      summary: string;
      createdAt: string;
    }
  | {
      kind: "error";
      id: string;
      message: string;
      createdAt: string;
    };

type SessionState = "idle" | "starting" | "active" | "stopping";

interface SnapshotMessage
{
  type: "snapshot";
  bubbles: ChatBubble[];
  sessionState: SessionState;
  sessionIdPrefix: string | null;
}

interface VsCodeApi
{
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const g_vscode = acquireVsCodeApi();

function TruncateSessionId(id: string): string
{
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}

function BuildBubbleElement(bubble: ChatBubble): HTMLElement
{
  const el = document.createElement("div");
  el.dataset.bubbleId = bubble.id;

  if (bubble.kind === "user_transcript")
  {
    el.className = `sheaf-bubble sheaf-bubble-user${bubble.complete ? "" : " sheaf-incomplete"}`;
    el.textContent = bubble.text;
  }
  else if (bubble.kind === "assistant_text")
  {
    el.className = `sheaf-bubble sheaf-bubble-assistant${bubble.complete ? "" : " sheaf-incomplete"}`;
    el.textContent = bubble.text;
  }
  else if (bubble.kind === "tool_call")
  {
    el.className = "sheaf-bubble sheaf-bubble-tool";
    el.textContent = `[${bubble.phase}] ${bubble.summary}`;
  }
  else if (bubble.kind === "context_push")
  {
    el.className = "sheaf-bubble sheaf-bubble-context";
    el.textContent = bubble.summary;
  }
  else
  {
    el.className = "sheaf-bubble sheaf-bubble-error";
    el.textContent = bubble.message;
  }

  const meta = document.createElement("div");
  meta.className = "sheaf-meta";
  meta.textContent = `${bubble.kind} · ${bubble.createdAt}`;
  el.appendChild(meta);

  return el;
}

function Render(root: HTMLElement, message: SnapshotMessage): void
{
  root.replaceChildren();

  const header = document.createElement("div");
  header.className = "sheaf-chat-header";

  const sessionLabel = document.createElement("div");
  sessionLabel.className = "sheaf-session-label";
  if (message.sessionState === "active" && message.sessionIdPrefix !== null)
  {
    sessionLabel.textContent = `Session ${TruncateSessionId(message.sessionIdPrefix)} · ${message.sessionState}`;
  }
  else if (message.sessionState === "starting")
  {
    sessionLabel.textContent = "Session starting…";
  }
  else if (message.sessionState === "stopping")
  {
    sessionLabel.textContent = "Session stopping…";
  }
  else
  {
    sessionLabel.textContent = "Session inactive — press F15 to start";
  }

  header.appendChild(sessionLabel);

  const actions = document.createElement("div");
  actions.className = "sheaf-actions";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.textContent =
    message.sessionState === "active" || message.sessionState === "starting"
      ? "Stop session"
      : "Start session";
  toggleBtn.disabled =
    message.sessionState === "starting" || message.sessionState === "stopping";
  toggleBtn.addEventListener("click", () =>
  {
    g_vscode.postMessage({ type: "command", id: "toggleSession" });
  });

  const commitBtn = document.createElement("button");
  commitBtn.type = "button";
  commitBtn.className = "secondary";
  commitBtn.textContent = "Commit / respond";
  commitBtn.disabled = message.sessionState !== "active";
  commitBtn.addEventListener("click", () =>
  {
    g_vscode.postMessage({ type: "command", id: "commitAndRespond" });
  });

  actions.appendChild(toggleBtn);
  actions.appendChild(commitBtn);
  header.appendChild(actions);

  root.appendChild(header);

  if (message.sessionState === "idle" && message.bubbles.length === 0)
  {
    const inactive = document.createElement("div");
    inactive.className = "sheaf-inactive";
    inactive.textContent = "Session inactive — press F15 to start.";
    root.appendChild(inactive);
    return;
  }

  const list = document.createElement("div");
  list.className = "sheaf-bubble-list";
  for (const bubble of message.bubbles)
  {
    list.appendChild(BuildBubbleElement(bubble));
  }

  root.appendChild(list);
}

function Main(): void
{
  const root = document.getElementById("root");
  if (root === null)
  {
    return;
  }

  window.addEventListener("message", (ev: MessageEvent<SnapshotMessage>) =>
  {
    const data = ev.data;
    if (data === undefined || data.type !== "snapshot")
    {
      return;
    }

    Render(root, data);
  });
}

Main();
