import { open, stat } from "node:fs/promises";

import { normalizeRelativeLogPath, validateLogFileForReading } from "./logs.js";

export const DEFAULT_MAX_READ_BYTES = 65536;

export const TRUNCATION_ERROR_MESSAGE =
  "log file was truncated or rotated; reopen the file";

export type ChunkMessage =
{
  type: "chunk";
  file: string;
  start: number;
  end: number;
  text: string;
};

export type AppendMessage =
{
  type: "append";
  file: string;
  start: number;
  end: number;
  text: string;
};

export type ErrorMessage =
{
  type: "error";
  message: string;
};

export type ServerMessage = ChunkMessage | AppendMessage | ErrorMessage;

export type LogStreamSessionOptions =
{
  logRoot: string;
  followPollIntervalMs?: number;
  onMessage: (message: ServerMessage) => void;
};

function clampPositiveInteger(value: unknown, defaultValue: number): number
{
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
  {
    return defaultValue;
  }

  const integerValue = Math.floor(value);

  return Math.min(integerValue, DEFAULT_MAX_READ_BYTES);
}

export async function readByteRange(
  absolutePath: string,
  start: number,
  end: number,
): Promise<string>
{
  const length = end - start;

  if (length <= 0)
  {
    return "";
  }

  const handle = await open(absolutePath, "r");

  try
  {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);

    return buffer.subarray(0, bytesRead).toString("utf-8");
  }
  finally
  {
    await handle.close();
  }
}

export async function getFileSize(absolutePath: string): Promise<number>
{
  const fileStat = await stat(absolutePath);

  return fileStat.size;
}

export function computeTailRange(
  fileSize: number,
  tailBytes: number,
): { start: number; end: number }
{
  const clampedTailBytes = Math.min(tailBytes, DEFAULT_MAX_READ_BYTES);
  const start = Math.max(0, fileSize - clampedTailBytes);
  const end = fileSize;

  return { start, end };
}

export function computeReadBeforeRange(
  before: number,
  maxBytes: number,
  currentFileSize: number,
): { start: number; end: number }
{
  const clampedMaxBytes = Math.min(maxBytes, DEFAULT_MAX_READ_BYTES);
  const start = Math.max(0, before - clampedMaxBytes);
  const end = Math.min(before, currentFileSize);

  return { start, end };
}

export class LogStreamSession
{
  private m_logRoot: string;
  private m_onMessage: (message: ServerMessage) => void;
  private m_followPollIntervalMs: number;
  private m_openRelativeFile: string | null = null;
  private m_openAbsolutePath: string | null = null;
  private m_followOffset = 0;
  private m_followEnabled = false;
  private m_followTimer: ReturnType<typeof setInterval> | null = null;
  private m_followInProgress = false;

  constructor(options: LogStreamSessionOptions)
  {
    this.m_logRoot = options.logRoot;
    this.m_onMessage = options.onMessage;
    this.m_followPollIntervalMs = options.followPollIntervalMs ?? 250;
  }

  HasOpenFile(): boolean
  {
    return this.m_openRelativeFile !== null;
  }

  SendError(message: string): void
  {
    this.m_onMessage({ type: "error", message });
  }

  async HandleOpen(file: string, tailBytes?: number): Promise<void>
  {
    this.StopFollowPolling();

    const validation = await validateLogFileForReading(this.m_logRoot, file);

    if (!validation.ok)
    {
      this.m_onMessage({ type: "error", message: validation.error });
      return;
    }

    const fileSize = await getFileSize(validation.absolutePath);
    const requestedTailBytes = clampPositiveInteger(tailBytes, DEFAULT_MAX_READ_BYTES);
    const { start, end } = computeTailRange(fileSize, requestedTailBytes);
    const text = await readByteRange(validation.absolutePath, start, end);

    const normalizedFile = normalizeRelativeLogPath(file);

    if (normalizedFile === null)
    {
      this.m_onMessage({ type: "error", message: "invalid log file path" });
      return;
    }

    this.m_openRelativeFile = normalizedFile;
    this.m_openAbsolutePath = validation.absolutePath;
    this.m_followOffset = fileSize;
    this.m_followEnabled = false;

    this.m_onMessage({
      type: "chunk",
      file: normalizedFile,
      start,
      end,
      text,
    });
  }

  async HandleReadBefore(before: number, maxBytes?: number): Promise<void>
  {
    if (!this.m_openAbsolutePath || !this.m_openRelativeFile)
    {
      this.m_onMessage({ type: "error", message: "no log file is open" });
      return;
    }

    if (typeof before !== "number" || !Number.isFinite(before) || before < 0)
    {
      this.m_onMessage({ type: "error", message: "read_before requires a non-negative before offset" });
      return;
    }

    const fileSize = await getFileSize(this.m_openAbsolutePath);
    const requestedMaxBytes = clampPositiveInteger(maxBytes, DEFAULT_MAX_READ_BYTES);
    const { start, end } = computeReadBeforeRange(before, requestedMaxBytes, fileSize);
    const text = await readByteRange(this.m_openAbsolutePath, start, end);

    this.m_onMessage({
      type: "chunk",
      file: this.m_openRelativeFile,
      start,
      end,
      text,
    });
  }

  HandleFollow(enabled: boolean): void
  {
    if (!this.m_openAbsolutePath || !this.m_openRelativeFile)
    {
      this.m_onMessage({ type: "error", message: "no log file is open" });
      return;
    }

    this.m_followEnabled = enabled;

    if (enabled)
    {
      this.StartFollowPolling();
      return;
    }

    this.StopFollowPolling();
  }

  Destroy(): void
  {
    this.StopFollowPolling();
    this.m_openRelativeFile = null;
    this.m_openAbsolutePath = null;
    this.m_followOffset = 0;
    this.m_followEnabled = false;
  }

  private StartFollowPolling(): void
  {
    if (this.m_followTimer !== null)
    {
      return;
    }

    this.m_followTimer = setInterval(() =>
    {
      void this.PollForAppends();
    }, this.m_followPollIntervalMs);
  }

  private StopFollowPolling(): void
  {
    if (this.m_followTimer !== null)
    {
      clearInterval(this.m_followTimer);
      this.m_followTimer = null;
    }
  }

  private ResetAfterTruncation(): void
  {
    this.StopFollowPolling();
    this.m_openRelativeFile = null;
    this.m_openAbsolutePath = null;
    this.m_followOffset = 0;
    this.m_followEnabled = false;
    this.m_onMessage({ type: "error", message: TRUNCATION_ERROR_MESSAGE });
  }

  private async PollForAppends(): Promise<void>
  {
    if (!this.m_followEnabled || !this.m_openAbsolutePath || !this.m_openRelativeFile)
    {
      return;
    }

    if (this.m_followInProgress)
    {
      return;
    }

    this.m_followInProgress = true;

    try
    {
      const fileSize = await getFileSize(this.m_openAbsolutePath);

      if (fileSize < this.m_followOffset)
      {
        this.ResetAfterTruncation();
        return;
      }

      if (fileSize > this.m_followOffset)
      {
        const start = this.m_followOffset;
        const end = fileSize;
        const text = await readByteRange(this.m_openAbsolutePath, start, end);

        this.m_followOffset = fileSize;

        this.m_onMessage({
          type: "append",
          file: this.m_openRelativeFile,
          start,
          end,
          text,
        });
      }
    }
    catch
    {
      this.ResetAfterTruncation();
    }
    finally
    {
      this.m_followInProgress = false;
    }
  }
}
