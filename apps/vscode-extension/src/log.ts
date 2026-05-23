import * as vscode from "vscode";

export interface LogSink
{
  Line(message: string): void;
  Error(message: string, err?: unknown): void;
}

export class Log implements LogSink
{
  constructor(private readonly m_channel: vscode.OutputChannel) {}

  Line(message: string): void
  {
    this.m_channel.appendLine(message);
  }

  Error(message: string, err?: unknown): void
  {
    const detail = err instanceof Error ? err.stack ?? err.message : String(err);
    this.m_channel.appendLine(`${message}${detail ? `: ${detail}` : ""}`);
  }

  Show(): void
  {
    this.m_channel.show(true);
  }
}
