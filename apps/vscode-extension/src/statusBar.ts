import * as vscode from "vscode";

import { CMD_TOGGLE_SESSION } from "./commands.js";
import type { SessionControllerState } from "./sessionController.js";

export function CreateSheafRealtimeStatusBar(): vscode.StatusBarItem
{
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = CMD_TOGGLE_SESSION;
  item.show();
  return item;
}

export function UpdateSheafRealtimeStatusBar(
  item: vscode.StatusBarItem,
  state: SessionControllerState,
): void
{
  if (state === "idle")
  {
    item.text = "$(circle-large-outline) Sheaf";
    item.tooltip = "Sheaf realtime: idle. Click or press F15 to start.";
  }
  else if (state === "active")
  {
    item.text = "$(record) Sheaf Listening";
    item.tooltip = "Sheaf realtime: listening. Click or F15 to stop. F19 to commit audio and request a response.";
  }
  else
  {
    item.text = "$(sync~spin) Sheaf";
    item.tooltip = `Sheaf realtime: ${state}…`;
  }
}
