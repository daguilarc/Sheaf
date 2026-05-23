import type { StructuredContextMessage } from "realtime-agent-lib";

export function buildFileChangedMessage(file: string): StructuredContextMessage
{
  return {
    kind: "file_changed_since_last_read",
    source: "vscode",
    payload: { file },
    summary: `${file} changed since last read`,
  };
}

export function buildViewportChangedMessage(file: string): StructuredContextMessage
{
  return {
    kind: "viewport_changed_since_last_check",
    source: "vscode",
    payload: { file },
    summary: "Visible range changed since last check",
  };
}

export function buildCursorChangedMessage(file: string): StructuredContextMessage
{
  return {
    kind: "cursor_changed_since_last_check",
    source: "vscode",
    payload: { file },
    summary: "Cursor position changed since last check",
  };
}
