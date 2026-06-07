import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  GetDefaultRealtimeAgentPaths,
} from "./repo_paths.js";

export interface RuntimeLogEntry
{
  timestamp: string;
  level: "info" | "warn" | "error";
  event: string;
  message?: string;
  fields?: Record<string, unknown>;
}

export interface RuntimeLoggerOptions
{
  logPath?: string;
  repoRoot?: string;
}

export interface RuntimeLogger
{
  Log(event: string, fields?: Record<string, unknown>): void;
  LogWarn(event: string, fields?: Record<string, unknown>): void;
  LogError(event: string, fields?: Record<string, unknown>): void;
  Close(): void;
}

const x_sensitiveFieldPattern = /api[_-]?key|authorization|secret|token|password/i;

function SanitizeFields(
  fields?: Record<string, unknown>,
): Record<string, unknown> | undefined
{
  if (fields === undefined)
  {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(fields))
  {
    if (x_sensitiveFieldPattern.test(key))
    {
      sanitized[key] = "[redacted]";
      continue;
    }

    if (key === "pcmBase64" || key === "audio" || key === "frame")
    {
      sanitized[key] = "[redacted]";
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

function BuildEntry(
  level: RuntimeLogEntry["level"],
  event: string,
  fields?: Record<string, unknown>,
): RuntimeLogEntry
{
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    fields: SanitizeFields(fields),
  };
}

export function CreateRuntimeLogger(options: RuntimeLoggerOptions = {}): RuntimeLogger
{
  const logPath =
    options.logPath ?? GetDefaultRealtimeAgentPaths(options.repoRoot).runtimeLogPath;

  mkdirSync(path.dirname(logPath), { recursive: true });

  const write = (entry: RuntimeLogEntry): void =>
  {
    appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  };

  return {
    Log(event, fields)
    {
      write(BuildEntry("info", event, fields));
    },
    LogWarn(event, fields)
    {
      write(BuildEntry("warn", event, fields));
    },
    LogError(event, fields)
    {
      write(BuildEntry("error", event, fields));
    },
    Close()
    {
    },
  };
}
