type WebviewMessage = {
  type: "state";
  state: {
    paneOpen: boolean;
    file: string | null;
    hunkIndex: number;
    hunkCount: number;
    currentHunk: { header: string; patch: string } | null;
    actions: Record<string, boolean>;
  };
};

declare const acquireVsCodeApi: undefined | (() => { postMessage(message: unknown): void });

const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
const root = document.getElementById("root");

function Button(id: string, label: string, enabled: boolean): string
{
  return `<button data-action="${id}" ${enabled ? "" : "disabled"}>${label}</button>`;
}

function Render(message: WebviewMessage): void
{
  if (root === null)
  {
    return;
  }

  const { state } = message;
  if (!state.paneOpen || state.currentHunk === null)
  {
    root.innerHTML = `<main class="empty">No unstaged hunk</main>`;
    return;
  }

  root.innerHTML = `
    <main>
      <header>
        <strong>${Escape(state.file ?? "")}</strong>
        <span>${state.hunkIndex + 1} / ${state.hunkCount}</span>
      </header>
      <nav>
        ${Button("previousFile", "Prev file", state.actions.canGoPrevFile)}
        ${Button("previousHunk", "Up", state.actions.canGoUp)}
        ${Button("nextHunk", "Down", state.actions.canGoDown)}
        ${Button("nextFile", "Next file", state.actions.canGoNextFile)}
        ${Button("stage", "Stage", state.actions.canStage)}
        ${Button("revert", "Revert", state.actions.canRevert)}
        ${Button("undo", "Undo", state.actions.canUndo)}
      </nav>
      <section class="hunk">
        <div class="header">${Escape(state.currentHunk.header)}</div>
        <pre>${Escape(state.currentHunk.patch)}</pre>
      </section>
    </main>`;
}

function Escape(value: string): string
{
  return value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[ch] ?? ch);
}

window.addEventListener("message", (event: MessageEvent<WebviewMessage>) => {
  if (event.data.type === "state")
  {
    Render(event.data);
  }
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement))
  {
    return;
  }
  const action = target.dataset.action;
  if (action !== undefined)
  {
    vscode?.postMessage({ type: "action", action });
  }
});
