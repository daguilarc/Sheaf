import * as vscode from "vscode";

export const CMD_TOGGLE_SESSION = "sheaf.realtime.toggleSession";
export const CMD_COMMIT_AND_RESPOND = "sheaf.realtime.commitAndRespond";

export function RegisterRealtimeCommands(
  context: vscode.ExtensionContext,
  handlers: {
    toggleSession: () => void | Promise<void>;
    commitAndRespond: () => void | Promise<void>;
  },
): void
{
  context.subscriptions.push(
    vscode.commands.registerCommand(CMD_TOGGLE_SESSION, handlers.toggleSession),
    vscode.commands.registerCommand(CMD_COMMIT_AND_RESPOND, handlers.commitAndRespond),
  );
}
