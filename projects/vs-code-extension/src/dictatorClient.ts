import type { CommandResult, HunkAction, PaneState } from "./types.js";

export interface DictatorCommand
{
  id: string;
  action: HunkAction;
}

export class DictatorClient
{
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private lastState: PaneState | undefined;
  private running = false;

  constructor(
    private readonly baseUrl: string,
    private readonly windowId: string,
    private readonly onCommand: (command: DictatorCommand) => Promise<CommandResult>,
  )
  {
  }

  start(): void
  {
    if (this.running)
    {
      return;
    }
    this.running = true;
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 1_000);
    this.pollTimer = setInterval(() => void this.pollCommand(), 200);
    void this.heartbeat();
  }

  stop(): void
  {
    this.running = false;
    if (this.pollTimer !== undefined)
    {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    if (this.heartbeatTimer !== undefined)
    {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    void this.post("/api/vscode-hunk/disconnect", { windowId: this.windowId });
  }

  async publishState(state: PaneState): Promise<void>
  {
    this.lastState = state;
    await this.post("/api/vscode-hunk/state", state);
  }

  private async heartbeat(): Promise<void>
  {
    await this.post("/api/vscode-hunk/heartbeat", {
      windowId: this.windowId,
      focused: this.lastState?.focused ?? false,
    });
  }

  private async pollCommand(): Promise<void>
  {
    try
    {
      const response = await fetch(`${this.baseUrl}/api/vscode-hunk/command?window_id=${encodeURIComponent(this.windowId)}`);
      if (!response.ok || response.status === 204)
      {
        return;
      }
      const command = await response.json() as DictatorCommand | null;
      if (command === null)
      {
        return;
      }
      const result = await this.onCommand(command);
      await this.post("/api/vscode-hunk/command-result", { commandId: command.id, windowId: this.windowId, result });
    }
    catch
    {
      // Dictator may not be running; keep the extension local-first.
    }
  }

  private async post(path: string, body: unknown): Promise<void>
  {
    try
    {
      await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    catch
    {
      // Dictator is optional; state will be sent again on the next change/heartbeat.
    }
  }
}
