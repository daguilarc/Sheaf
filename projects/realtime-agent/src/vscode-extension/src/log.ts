import * as vscode from "vscode";

import { CreateRuntimeLogger, type RuntimeLogger } from "realtime-agent-lib";

import { ResolveExtensionRuntimeLogPath } from "./repoConfig.js";

export interface LogSink
{
  Line(message: string): void;
  Error(message: string, err?: unknown): void;
  LogEvent(event: string, fields?: Record<string, unknown>): void;
  LogEventError(event: string, fields?: Record<string, unknown>, err?: unknown): void;
}

export interface CreateExtensionLogOptions
{
  channel: vscode.OutputChannel;
  repoRoot?: string;
  runtimeLogPath?: string;
  createRuntimeLogger?: typeof CreateRuntimeLogger;
}

function FormatErrorDetail(err?: unknown): string
{
  if (err === undefined)
  {
    return "";
  }

  return err instanceof Error ? err.stack ?? err.message : String(err);
}

export function CreateExtensionLog(options: CreateExtensionLogOptions): LogSink
{
  const createRuntimeLogger = options.createRuntimeLogger ?? CreateRuntimeLogger;
  const runtimeLogPath =
    options.runtimeLogPath ??
    (options.repoRoot !== undefined
      ? ResolveExtensionRuntimeLogPath(options.repoRoot)
      : undefined);

  let runtimeLogger: RuntimeLogger | undefined;
  if (runtimeLogPath !== undefined)
  {
    runtimeLogger = createRuntimeLogger({ logPath: runtimeLogPath });
  }

  const channel = options.channel;

  return {
    Line(message: string): void
    {
      channel.appendLine(message);
    },

    Error(message: string, err?: unknown): void
    {
      const detail = FormatErrorDetail(err);
      channel.appendLine(`${message}${detail ? `: ${detail}` : ""}`);
    },

    LogEvent(event: string, fields?: Record<string, unknown>): void
    {
      channel.appendLine(`[${event}]`);
      runtimeLogger?.Log(event, fields);
    },

    LogEventError(event: string, fields?: Record<string, unknown>, err?: unknown): void
    {
      const detail = FormatErrorDetail(err);
      channel.appendLine(`[${event}]${detail ? `: ${detail}` : ""}`);
      runtimeLogger?.LogError(event, {
        ...fields,
        ...(detail ? { error: detail } : {}),
      });
    },
  };
}
