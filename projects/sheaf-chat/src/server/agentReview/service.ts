import { readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import path from "node:path";

import { WebSocket, WebSocketServer } from "ws";

import type { AgentManager } from "../../agents/manager.js";
import type { FileChangedNotification } from "../../extensions/sheaf-chat/types.js";
import type { SheafChatConfig } from "../config.js";
import { LogHandledServerError } from "../logging.js";
import {
  ParseAgentReviewWebSocketQuery,
  rejectUpgradeWithHttpStatus,
  StorageErrorToHttpStatus,
  type WorkspaceWebSocketConnectParams,
} from "../websocket.js";

// Agent Review is scoped to a workspace (worktree), not a chat.
interface WorkspaceReviewKey
{
  repoId: string;
  workspaceId: string;
}

function FormatWorkspaceReviewKey(key: WorkspaceReviewKey): string
{
  return `${key.repoId}/${key.workspaceId}`;
}
import { StorageError } from "../../storage/errors.js";
import {
  ApplyAgentReviewPatch,
  AssertReviewHunkUnderSession,
  LoadAgentReviewGitState,
  ReadAgentReviewIndexFile,
  ResolveAgentReviewAvailability,
} from "./git.js";
import type {
  AgentReviewAction,
  AgentReviewActions,
  AgentReviewClientFrame,
  AgentReviewCommandResult,
  AgentReviewDraftEntry,
  AgentReviewDraftState,
  AgentReviewHunk,
  AgentReviewServerFrame,
  AgentReviewState,
} from "./types.js";

interface AgentReviewServiceOptions
{
  config: SheafChatConfig;
  agentManager: AgentManager;
}

interface UndoEntry
{
  action: "stage" | "revert";
  hunk: AgentReviewHunk;
}

interface DictatorEndpoint
{
  url: string;
}

interface DictatorEndpointResolver
{
  resolve: () => Promise<DictatorEndpoint | null>;
}

interface DictatorRPCEnvelope
{
  id?: string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: string; message?: string };
}

type ReviewCellColor = "off" | "grey" | "blue" | "green";

class DictatorRPCError extends Error
{
  readonly code: string | null;

  constructor(message: string, code: string | null = null)
  {
    super(message);
    this.name = "DictatorRPCError";
    this.code = code;
  }
}

function IsStaleDictatorRPCSession(error: unknown): boolean
{
  if (!(error instanceof Error))
  {
    return false;
  }
  return /client session not found/i.test(error.message);
}

function DictatorRPCHeartbeatIntervalMS(): number
{
  const raw = process.env.SHEAF_CHAT_AGENT_REVIEW_RPC_HEARTBEAT_MS;
  if (raw !== undefined)
  {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 10)
    {
      return parsed;
    }
  }
  return 10_000;
}

const REVIEW_CELL = { x: 3, y: 3 } as const;

const REVIEW_CELL_COLORS: Record<ReviewCellColor, { r: number; g: number; b: number } | { off: true }> = {
  off: { off: true },
  grey: { r: 90, g: 90, b: 90 },
  blue: { r: 0, g: 0, b: 255 },
  green: { r: 0, g: 255, b: 0 },
};

interface NavCell
{
  x: number;
  y: number;
  action: AgentReviewAction;
  availability: keyof AgentReviewActions;
  color: { r: number; g: number; b: number };
}

// Hunk navigation and mutation cells, preserving the positions and colors the
// old Dictator-owned HunkReviewLaunchpadControlLayer rendered. Sheaf Chat now
// owns these over the generic RPC; Dictator only renders the supplied colors and
// forwards generic press events. Each cell lights only when its action is
// currently available and is off otherwise.
const NAV_CELLS: readonly NavCell[] = [
  { x: 0, y: 2, action: "revert", availability: "canRevert", color: { r: 255, g: 0, b: 0 } },
  { x: 1, y: 2, action: "previousHunk", availability: "canGoUp", color: { r: 255, g: 255, b: 0 } },
  { x: 2, y: 2, action: "stage", availability: "canStage", color: { r: 0, g: 255, b: 0 } },
  { x: 3, y: 2, action: "undo", availability: "canUndo", color: { r: 255, g: 255, b: 255 } },
  { x: 0, y: 3, action: "previousFile", availability: "canGoPrevFile", color: { r: 255, g: 255, b: 0 } },
  { x: 1, y: 3, action: "nextHunk", availability: "canGoDown", color: { r: 255, g: 255, b: 0 } },
  { x: 2, y: 3, action: "nextFile", availability: "canGoNextFile", color: { r: 255, g: 255, b: 0 } },
];

function ReportBackgroundError(context: string, error: unknown): void
{
  // Background work failures must be observed, not silently swallowed. They are
  // not re-thrown because the work is dispatched outside any request lifecycle.
  console.error(`[agent-review] ${context}:`, error);
}

type AgentReviewTraceScalar = string | number | boolean | null;

function TraceAgentReview(
  event: string,
  fields: Record<string, AgentReviewTraceScalar | undefined> = {},
): void
{
  if (process.env.SHEAF_CHAT_AGENT_REVIEW_TRACE !== "1")
  {
    return;
  }
  const entry: Record<string, AgentReviewTraceScalar> = {
    service: "sheaf-chat",
    feature: "agent-review",
    event,
  };
  for (const [key, value] of Object.entries(fields))
  {
    if (value !== undefined)
    {
      entry[key] = value;
    }
  }
  console.log(JSON.stringify(entry));
}

function SendFrame(socket: WebSocket, frame: AgentReviewServerFrame): void
{
  if (socket.readyState === WebSocket.OPEN)
  {
    socket.send(JSON.stringify(frame));
  }
}

function EmptyActions(): AgentReviewActions
{
  return {
    canGoUp: false,
    canGoDown: false,
    canGoPrevFile: false,
    canGoNextFile: false,
    canStage: false,
    canRevert: false,
    canUndo: false,
  };
}

interface ChangedLineOccurrence
{
  kind: "addition" | "deletion";
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

function ParseHunkRange(
  header: string,
): { oldStart: number; oldCount: number; newStart: number; newCount: number } | null
{
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (match === null)
  {
    return null;
  }
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function HunkChangedOccurrences(hunk: AgentReviewHunk): ChangedLineOccurrence[]
{
  const lines = hunk.patch.split("\n");
  const headerIndex = lines.findIndex((line) => line.startsWith("@@ "));
  const range = headerIndex >= 0 ? ParseHunkRange(lines[headerIndex]!) : null;
  if (range === null)
  {
    return [];
  }

  let oldLineNumber = range.oldStart;
  let newLineNumber = range.newStart;
  const occurrences: ChangedLineOccurrence[] = [];

  for (const line of lines.slice(headerIndex + 1))
  {
    if (line.length === 0 || line.startsWith("\\"))
    {
      continue;
    }

    const prefix = line.slice(0, 1);
    const text = line.slice(1);
    if (prefix === " ")
    {
      oldLineNumber += 1;
      newLineNumber += 1;
    }
    else if (prefix === "-")
    {
      occurrences.push({
        kind: "deletion",
        text,
        oldLineNumber,
      });
      oldLineNumber += 1;
    }
    else if (prefix === "+")
    {
      occurrences.push({
        kind: "addition",
        text,
        newLineNumber,
      });
      newLineNumber += 1;
    }
  }

  return occurrences;
}

function ChangedOccurrenceKey(occurrence: ChangedLineOccurrence): string
{
  return [
    occurrence.kind,
    occurrence.oldLineNumber ?? "",
    occurrence.newLineNumber ?? "",
    occurrence.text,
  ].join("\0");
}

function HunkChangedContentLines(hunk: AgentReviewHunk): string[]
{
  const additions = new Map<string, number>();
  const deletions = new Map<string, number>();
  for (const occurrence of HunkChangedOccurrences(hunk))
  {
    const counts = occurrence.kind === "addition" ? additions : deletions;
    counts.set(occurrence.text, (counts.get(occurrence.text) ?? 0) + 1);
  }

  const result: string[] = [];
  const texts = new Set([...additions.keys(), ...deletions.keys()]);
  for (const text of texts)
  {
    const additionCount = additions.get(text) ?? 0;
    const deletionCount = deletions.get(text) ?? 0;
    const cancelCount = Math.min(additionCount, deletionCount);
    for (let i = cancelCount; i < additionCount; i += 1)
    {
      result.push(`+${text}`);
    }
    for (let i = cancelCount; i < deletionCount; i += 1)
    {
      result.push(`-${text}`);
    }
  }
  return result;
}

function CountChangedOccurrences(hunks: AgentReviewHunk[]): Map<string, number>
{
  const counts = new Map<string, number>();
  for (const hunk of hunks)
  {
    for (const occurrence of HunkChangedOccurrences(hunk))
    {
      const key = ChangedOccurrenceKey(occurrence);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function CountChangedContentLines(hunks: AgentReviewHunk[]): Map<string, number>
{
  const additions = new Map<string, number>();
  const deletions = new Map<string, number>();
  for (const hunk of hunks)
  {
    for (const occurrence of HunkChangedOccurrences(hunk))
    {
      const counts = occurrence.kind === "addition" ? additions : deletions;
      counts.set(occurrence.text, (counts.get(occurrence.text) ?? 0) + 1);
    }
  }

  const counts = new Map<string, number>();
  const texts = new Set([...additions.keys(), ...deletions.keys()]);
  for (const text of texts)
  {
    const additionCount = additions.get(text) ?? 0;
    const deletionCount = deletions.get(text) ?? 0;
    const cancelCount = Math.min(additionCount, deletionCount);
    const remainingAdditions = additionCount - cancelCount;
    const remainingDeletions = deletionCount - cancelCount;
    if (remainingAdditions > 0)
    {
      counts.set(`+${text}`, remainingAdditions);
    }
    if (remainingDeletions > 0)
    {
      counts.set(`-${text}`, remainingDeletions);
    }
  }
  return counts;
}

function SubtractHunkOccurrences(
  counts: Map<string, number>,
  hunk: AgentReviewHunk,
): Map<string, number>
{
  const result = new Map(counts);
  for (const occurrence of HunkChangedOccurrences(hunk))
  {
    const key = ChangedOccurrenceKey(occurrence);
    const next = (result.get(key) ?? 0) - 1;
    if (next > 0)
    {
      result.set(key, next);
    }
    else
    {
      result.delete(key);
    }
  }
  return result;
}

function SubtractHunkContentLines(
  counts: Map<string, number>,
  hunk: AgentReviewHunk,
): Map<string, number>
{
  const result = new Map(counts);
  for (const line of HunkChangedContentLines(hunk))
  {
    const next = (result.get(line) ?? 0) - 1;
    if (next > 0)
    {
      result.set(line, next);
    }
    else
    {
      result.delete(line);
    }
  }
  return result;
}

function SplitTextLines(content: string): { lines: string[]; trailingNewline: boolean }
{
  const trailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (trailingNewline)
  {
    lines.pop();
  }
  return { lines, trailingNewline };
}

function JoinTextLines(lines: string[], trailingNewline: boolean): string
{
  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}

function ApplyHunkToContent(
  content: string,
  hunk: AgentReviewHunk,
  direction: "forward" | "reverse",
): string
{
  const patchLines = hunk.patch.split("\n");
  const headerIndex = patchLines.findIndex((line) => line.startsWith("@@ "));
  const range = headerIndex >= 0 ? ParseHunkRange(patchLines[headerIndex]!) : null;
  if (range === null)
  {
    throw new Error("hunk patch has no parseable range");
  }

  const { lines, trailingNewline } = SplitTextLines(content);
  const start = direction === "forward" ? range.oldStart : range.newStart;
  const count = direction === "forward" ? range.oldCount : range.newCount;
  const cursorStart = count === 0 ? start : Math.max(0, start - 1);
  if (cursorStart > lines.length)
  {
    throw new Error("hunk range starts after index file end");
  }

  let cursor = cursorStart;
  const result = lines.slice(0, cursorStart);
  let hunkOutputTrailingNewline: boolean | null = null;
  let lastPatchLineEmittedOutput = false;
  for (const line of patchLines.slice(headerIndex + 1))
  {
    if (line.length === 0)
    {
      continue;
    }
    if (line.startsWith("\\"))
    {
      if (lastPatchLineEmittedOutput)
      {
        hunkOutputTrailingNewline = false;
      }
      lastPatchLineEmittedOutput = false;
      continue;
    }

    const prefix = line.slice(0, 1);
    const text = line.slice(1);
    if (prefix === " ")
    {
      if (lines[cursor] !== text)
      {
        throw new Error("hunk context does not match index file");
      }
      result.push(text);
      cursor += 1;
      hunkOutputTrailingNewline = true;
      lastPatchLineEmittedOutput = true;
    }
    else if (prefix === "-")
    {
      if (direction === "forward")
      {
        if (lines[cursor] !== text)
        {
          throw new Error("hunk deletion does not match target file");
        }
        cursor += 1;
        lastPatchLineEmittedOutput = false;
      }
      else
      {
        result.push(text);
        hunkOutputTrailingNewline = true;
        lastPatchLineEmittedOutput = true;
      }
    }
    else if (prefix === "+")
    {
      if (direction === "forward")
      {
        result.push(text);
        hunkOutputTrailingNewline = true;
        lastPatchLineEmittedOutput = true;
      }
      else
      {
        if (lines[cursor] !== text)
        {
          throw new Error("hunk addition does not match target file");
        }
        cursor += 1;
        lastPatchLineEmittedOutput = false;
      }
    }
  }
  result.push(...lines.slice(cursor));
  const nextTrailingNewline = cursor === lines.length
    ? hunkOutputTrailingNewline ?? result.length > 0
    : trailingNewline;
  return JoinTextLines(result, nextTrailingNewline);
}

function ApplyHunkToIndexedContent(indexContent: string, hunk: AgentReviewHunk): string
{
  return ApplyHunkToContent(indexContent, hunk, "forward");
}

function ApplyReverseHunkToWorktreeContent(worktreeContent: string, hunk: AgentReviewHunk): string
{
  return ApplyHunkToContent(worktreeContent, hunk, "reverse");
}

function ApplyRestoreHunkToWorktreeContent(worktreeContent: string, hunk: AgentReviewHunk): string
{
  return ApplyHunkToContent(worktreeContent, hunk, "forward");
}

function FirstHunkIndexAfterFile(hunks: AgentReviewHunk[], file: string): number
{
  return hunks.findIndex((hunk) => hunk.file > file);
}

function LastHunkIndexBeforeFile(hunks: AgentReviewHunk[], file: string): number
{
  for (let index = hunks.length - 1; index >= 0; index -= 1)
  {
    const hunk = hunks[index]!;
    if (hunk.file < file)
    {
      return index;
    }
  }
  return -1;
}

function ActionsFor(
  hunks: AgentReviewHunk[],
  currentIndex: number,
  canUndo: boolean,
  fileNavigationAnchor: string | null = null,
): AgentReviewActions
{
  if (hunks.length === 0)
  {
    return {
      ...EmptyActions(),
      canUndo,
    };
  }

  if (currentIndex < 0)
  {
    return {
      ...EmptyActions(),
      canGoPrevFile: fileNavigationAnchor !== null
        ? LastHunkIndexBeforeFile(hunks, fileNavigationAnchor) >= 0
        : false,
      canGoNextFile: fileNavigationAnchor !== null
        ? FirstHunkIndexAfterFile(hunks, fileNavigationAnchor) >= 0
        : hunks.length > 0,
      canUndo,
    };
  }

  const current = hunks[currentIndex]!;

  // Hunk navigation loops within the current file, so it is available whenever
  // that file has more than one hunk and unavailable for a single-hunk file.
  const [fileStart, fileEnd] = FileHunkRange(hunks, currentIndex);
  const fileHasMultipleHunks = fileEnd > fileStart;

  return {
    canGoUp: fileHasMultipleHunks,
    canGoDown: fileHasMultipleHunks,
    // File navigation is available whenever another file with unstaged hunks
    // exists in that direction, regardless of which hunk in the current file is
    // selected.
    canGoPrevFile: current.fileIndex > 0,
    canGoNextFile: current.fileIndex < current.fileCount - 1,
    canStage: true,
    canRevert: true,
    canUndo,
  };
}

function IsPathWithinRoot(root: string, candidate: string): boolean
{
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function CreateDictatorEndpointResolver(config: SheafChatConfig): DictatorEndpointResolver
{
  async function ReadServices(): Promise<DictatorEndpoint | null>
  {
    try
    {
      const raw = await readFile(config.paths.servicesJsonFile, "utf8");
      const services = JSON.parse(raw) as Array<{ name?: unknown; host?: unknown; port?: unknown }>;
      const dictator = services.find((service) => service.name === "dictator");

      if (dictator === undefined || typeof dictator.port !== "number")
      {
        return null;
      }

      const host = typeof dictator.host === "string" && dictator.host !== "0.0.0.0"
        ? dictator.host
        : "127.0.0.1";

      return {
        url: `http://${host}:${dictator.port}`,
      };
    }
    catch
    {
      return null;
    }
  }

  let cached: DictatorEndpoint | null | undefined;
  return {
    async resolve(): Promise<DictatorEndpoint | null>
    {
      if (cached === undefined)
      {
        cached = await ReadServices();
      }
      return cached ?? { url: "http://127.0.0.1:9003" };
    },
  };
}

function DictatorRPCUrl(endpoint: DictatorEndpoint, providerId: string): string
{
  const url = new URL(endpoint.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/rpc";
  url.search = "";
  url.searchParams.set("client", providerId);
  return url.toString();
}

class DictatorRPCClient
{
  private readonly m_endpointResolver: DictatorEndpointResolver;
  private readonly m_providerId: string;
  private readonly m_onCellPressed: (x: number, y: number) => void;
  private readonly m_onStatusChanged: () => void;
  private m_socket: WebSocket | null = null;
  private m_connecting: Promise<void> | null = null;
  private m_nextRequestID = 1;
  private m_pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private m_connected = false;
  private m_url: string | null = null;
  private m_lastError: string | null = null;
  private m_heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    endpointResolver: DictatorEndpointResolver,
    providerId: string,
    onCellPressed: (x: number, y: number) => void,
    onStatusChanged: () => void,
  )
  {
    this.m_endpointResolver = endpointResolver;
    this.m_providerId = providerId;
    this.m_onCellPressed = onCellPressed;
    this.m_onStatusChanged = onStatusChanged;
  }

  get connected(): boolean
  {
    return this.m_connected;
  }

  get url(): string | null
  {
    return this.m_url;
  }

  get lastError(): string | null
  {
    return this.m_lastError;
  }

  async ensureConnected(): Promise<boolean>
  {
    if (this.m_connected && this.m_socket?.readyState === WebSocket.OPEN)
    {
      return true;
    }

    if (this.m_connecting !== null)
    {
      await this.m_connecting;
      return this.m_connected;
    }

    this.m_connecting = this.connect();
    try
    {
      await this.m_connecting;
    }
    finally
    {
      this.m_connecting = null;
    }
    return this.m_connected;
  }

  disconnect(): void
  {
    const socket = this.m_socket;
    this.m_socket = null;
    this.stopHeartbeat();
    this.setStatus(false, this.m_url, null);
    for (const pending of this.m_pending.values())
    {
      pending.reject(new Error("Dictator RPC disconnected"));
    }
    this.m_pending.clear();
    socket?.close();
  }

  async setCells(reviewColor: ReviewCellColor, actions: AgentReviewActions): Promise<void>
  {
    const cells: Array<Record<string, unknown>> = NAV_CELLS.map((cell) =>
      actions[cell.availability]
        ? { x: cell.x, y: cell.y, ...cell.color }
        : { x: cell.x, y: cell.y, off: true },
    );
    cells.push({ ...REVIEW_CELL, ...REVIEW_CELL_COLORS[reviewColor] });
    await this.call("launchpad.setCells", { cells });
  }

  async setCellsWithStaleSessionRetry(reviewColor: ReviewCellColor, actions: AgentReviewActions): Promise<void>
  {
    try
    {
      await this.setCells(reviewColor, actions);
    }
    catch (error)
    {
      if (!IsStaleDictatorRPCSession(error))
      {
        throw error;
      }
      this.invalidateConnection(error);
      await this.setCells(reviewColor, actions);
    }
  }

  async insertText(text: string): Promise<void>
  {
    await this.call("cursor.insertText", { text });
  }

  async ping(): Promise<void>
  {
    await this.call("rpc.ping", {});
  }

  async pushContext(hunk: AgentReviewHunk): Promise<void>
  {
    await this.call("dictationContext.push", {
      id: `comment:${hunk.hunkId}`,
      title: `Review hunk: ${hunk.file}`,
      metadata: {
        file: hunk.file,
        hunkId: hunk.hunkId,
        patchHash: hunk.patchHash,
      },
      body: [
        hunk.header,
        "",
        hunk.patch,
      ].join("\n"),
    });
  }

  async popContext(hunkId: string): Promise<void>
  {
    await this.call("dictationContext.pop", { id: `comment:${hunkId}` });
  }

  private async connect(): Promise<void>
  {
    const endpoint = await this.m_endpointResolver.resolve();
    if (endpoint === null)
    {
      TraceAgentReview("dictator_rpc.unavailable", {
        providerId: this.m_providerId,
        reason: "no endpoint",
      });
      this.setStatus(false, null, null);
      return;
    }

    const url = DictatorRPCUrl(endpoint, this.m_providerId);
    this.m_url = endpoint.url;
    TraceAgentReview("dictator_rpc.connect.start", {
      providerId: this.m_providerId,
      url: endpoint.url,
    });

    await new Promise<void>((resolve) =>
    {
      const socket = new WebSocket(url);
      let settled = false;
      let opened = false;
      const settle = (): void =>
      {
        if (!settled)
        {
          settled = true;
          resolve();
        }
      };

      socket.on("open", () =>
      {
        opened = true;
        this.m_socket = socket;
        TraceAgentReview("dictator_rpc.connect.open", {
          providerId: this.m_providerId,
          url: endpoint.url,
        });
        this.setStatus(true, endpoint.url, null);
        this.startHeartbeat();
        settle();
      });
      socket.on("message", (raw) =>
      {
        this.handleMessage(raw);
      });
      socket.on("close", () =>
      {
        TraceAgentReview("dictator_rpc.connect.close", {
          providerId: this.m_providerId,
          url: endpoint.url,
          opened,
        });
        if (opened && this.m_socket !== socket)
        {
          settle();
          return;
        }
        if (this.m_socket === socket)
        {
          this.m_socket = null;
          this.stopHeartbeat();
        }
        this.setStatus(false, endpoint.url, this.m_connected ? "Dictator RPC closed" : this.m_lastError);
        for (const pending of this.m_pending.values())
        {
          pending.reject(new Error("Dictator RPC closed"));
        }
        this.m_pending.clear();
        settle();
      });
      socket.on("error", (error) =>
      {
        TraceAgentReview("dictator_rpc.connect.error", {
          providerId: this.m_providerId,
          url: endpoint.url,
          message: error instanceof Error ? error.message : String(error),
        });
        if (opened && this.m_socket !== socket)
        {
          settle();
          return;
        }
        if (this.m_socket === socket)
        {
          this.stopHeartbeat();
        }
        this.setStatus(false, endpoint.url, error instanceof Error ? error.message : String(error));
        settle();
      });
    });
  }

  private startHeartbeat(): void
  {
    if (this.m_heartbeatTimer !== null)
    {
      return;
    }
    this.m_heartbeatTimer = setInterval(() =>
    {
      void this.ping().catch((error: unknown) =>
      {
        this.invalidateConnection(error);
      });
    }, DictatorRPCHeartbeatIntervalMS());
    this.m_heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void
  {
    if (this.m_heartbeatTimer === null)
    {
      return;
    }
    clearInterval(this.m_heartbeatTimer);
    this.m_heartbeatTimer = null;
  }

  private invalidateConnection(error: unknown): void
  {
    const message = error instanceof Error ? error.message : String(error);
    const socket = this.m_socket;
    this.m_socket = null;
    this.stopHeartbeat();
    this.setStatus(false, this.m_url, message);
    for (const pending of this.m_pending.values())
    {
      pending.reject(error instanceof Error ? error : new Error(message));
    }
    this.m_pending.clear();
    socket?.close();
  }

  private async call(method: string, params: Record<string, unknown>): Promise<unknown>
  {
    const connected = await this.ensureConnected();
    if (!connected || this.m_socket === null || this.m_socket.readyState !== WebSocket.OPEN)
    {
      throw new Error(this.m_lastError ?? "Dictator RPC unavailable");
    }

    const id = String(this.m_nextRequestID++);
    const envelope: DictatorRPCEnvelope = { id, method, params };
    return new Promise((resolve, reject) =>
    {
      this.m_pending.set(id, { resolve, reject });
      this.m_socket!.send(JSON.stringify(envelope), (error) =>
      {
        if (error != null)
        {
          this.m_pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private handleMessage(raw: WebSocket.RawData): void
  {
    let envelope: DictatorRPCEnvelope;
    try
    {
      envelope = JSON.parse(raw.toString()) as DictatorRPCEnvelope;
    }
    catch
    {
      return;
    }

    if (envelope.id !== undefined)
    {
      const pending = this.m_pending.get(envelope.id);
      if (pending === undefined)
      {
        return;
      }
      this.m_pending.delete(envelope.id);
      if (envelope.error !== undefined)
      {
        const error = new DictatorRPCError(
          envelope.error.message ?? envelope.error.code ?? "Dictator RPC error",
          envelope.error.code ?? null,
        );
        if (IsStaleDictatorRPCSession(error))
        {
          this.invalidateConnection(error);
        }
        pending.reject(error);
      }
      else
      {
        pending.resolve(envelope.result);
      }
      return;
    }

    if (envelope.method === "rpc.hello")
    {
      this.setStatus(true, this.m_url, null);
    }
    else if (envelope.method === "launchpad.cellPressed")
    {
      const params = envelope.params ?? {};
      if (typeof params.x === "number" && typeof params.y === "number")
      {
        TraceAgentReview("dictator_rpc.cell_pressed", {
          providerId: this.m_providerId,
          x: params.x,
          y: params.y,
        });
        this.m_onCellPressed(params.x, params.y);
      }
    }
  }

  private setStatus(connected: boolean, url: string | null, lastError: string | null): void
  {
    const changed =
      this.m_connected !== connected ||
      this.m_url !== url ||
      this.m_lastError !== lastError;
    this.m_connected = connected;
    this.m_url = url;
    this.m_lastError = lastError;
    if (changed)
    {
      this.m_onStatusChanged();
    }
  }
}

function NormalizeCurrentIndex(hunks: AgentReviewHunk[], desiredIndex: number): number
{
  if (hunks.length === 0)
  {
    return -1;
  }

  return Math.min(Math.max(0, desiredIndex), hunks.length - 1);
}

// Hunks are grouped contiguously by file (see BuildHunks in git.ts), so the
// current file occupies a single [start, end] run. Returns the inclusive index
// bounds of the run containing `index`.
function FileHunkRange(hunks: AgentReviewHunk[], index: number): [number, number]
{
  const file = hunks[index]!.file;
  let start = index;
  while (start > 0 && hunks[start - 1]!.file === file)
  {
    start -= 1;
  }
  let end = index;
  while (end < hunks.length - 1 && hunks[end + 1]!.file === file)
  {
    end += 1;
  }
  return [start, end];
}

function ParseClientFrame(data: WebSocket.RawData): AgentReviewClientFrame
{
  const parsed = JSON.parse(data.toString()) as Partial<AgentReviewClientFrame>;

  if (parsed.type === "focus")
  {
    return {
      type: "focus",
      hunkId: parsed.hunkId,
      file: typeof parsed.file === "string" ? parsed.file : null,
    };
  }

  if (
    parsed.type === "comment" &&
    typeof parsed.hunkId === "string" &&
    typeof parsed.text === "string"
  )
  {
    return {
      type: "comment",
      hunkId: parsed.hunkId,
      text: parsed.text,
    };
  }

  if (
    (parsed.type === "comment_focus" || parsed.type === "comment_blur") &&
    typeof parsed.hunkId === "string"
  )
  {
    return {
      type: parsed.type,
      hunkId: parsed.hunkId,
    };
  }

  if (parsed.type === "presence" && typeof parsed.focused === "boolean")
  {
    return {
      type: "presence",
      focused: parsed.focused,
    };
  }

  if (
    parsed.type === "command" &&
    typeof parsed.action === "string" &&
    [
      "previousHunk",
      "nextHunk",
      "previousFile",
      "nextFile",
      "stage",
      "revert",
      "undo",
    ].includes(parsed.action)
  )
  {
    return {
      type: "command",
      id: parsed.id,
      action: parsed.action as AgentReviewAction,
      hunkId: parsed.hunkId,
      patchHash: parsed.patchHash,
    };
  }

  throw new StorageError("invalid_frame", "unsupported Agent Review frame");
}

class AgentReviewSession
{
  private readonly m_key: WorkspaceReviewKey;
  private readonly m_agentManager: AgentManager;
  private readonly m_dictatorEndpoint: DictatorEndpointResolver | null;
  private readonly m_providerId: string;
  private readonly m_dictatorRPC: DictatorRPCClient | null;
  private readonly m_sockets = new Set<WebSocket>();
  private readonly m_socketClientIds = new Map<WebSocket, string | undefined>();
  // Subset of m_sockets whose browser tab is currently focused (visible and
  // window-focused). The Launchpad is lit while any attached client is focused
  // and dark when none are. Sockets default to focused on attach.
  private readonly m_focusedSockets = new Set<WebSocket>();
  private readonly m_undoStack: UndoEntry[] = [];
  private readonly m_reviewEntries: AgentReviewDraftEntry[] = [];
  private m_state: AgentReviewState | null = null;
  private m_currentIndex = -1;
  private m_focusClearedExplicitly = false;
  private m_postMutationFile: string | null = null;
  private m_postMutationTargetPatchHash: string | null = null;
  private m_postMutationPreferNoCrossFile = false;
  private m_fileNavigationAnchor: string | null = null;
  private m_visibleCommentHunkId: string | null = null;
  private m_pushedContextHunkId: string | null = null;
  private m_refreshInFlight: Promise<void> | null = null;
  private m_closing = false;
  private m_launchpadCommandSequence = 0;
  private readonly m_backgroundWork = new Set<Promise<unknown>>();

  constructor(
    key: WorkspaceReviewKey,
    agentManager: AgentManager,
    dictatorEndpoint: DictatorEndpointResolver | null,
  )
  {
    this.m_key = key;
    this.m_agentManager = agentManager;
    this.m_dictatorEndpoint = dictatorEndpoint;
    this.m_providerId = `sheaf-chat:${key.repoId}:${key.workspaceId}`;
    this.m_dictatorRPC = dictatorEndpoint === null
      ? null
      : new DictatorRPCClient(
        dictatorEndpoint,
        this.m_providerId,
        (x, y) => { this.RunBackground("cell press", () => this.HandleCellPressed(x, y)); },
        () => { this.RunBackground("status refresh", () => this.RefreshAndBroadcast()); },
      );
  }

  // Dispatch fire-and-forget work so teardown can drain it and so a failure
  // surfaces as a logged error rather than an unhandled rejection. New work is
  // refused once teardown has begun.
  private RunBackground(context: string, run: () => Promise<void>): void
  {
    if (this.m_closing)
    {
      return;
    }
    const operation = run().catch((error: unknown) =>
    {
      ReportBackgroundError(context, error);
    });
    this.m_backgroundWork.add(operation);
    void operation.finally(() =>
    {
      this.m_backgroundWork.delete(operation);
    });
  }

  // Wait for all in-flight background and refresh work to settle. New work is
  // suppressed once m_closing is set, so this loop terminates.
  private async DrainInFlight(): Promise<void>
  {
    while (this.m_backgroundWork.size > 0 || this.m_refreshInFlight !== null)
    {
      const pending: Array<Promise<unknown>> = [...this.m_backgroundWork];
      if (this.m_refreshInFlight !== null)
      {
        pending.push(this.m_refreshInFlight);
      }
      await Promise.allSettled(pending);
    }
  }

  async Dispose(): Promise<void>
  {
    this.m_closing = true;
    // Dictator releases this client's pushed context and owned cells on
    // disconnect, so teardown only clears local state and never issues a new
    // RPC pop that could outlive the connection.
    this.m_pushedContextHunkId = null;

    for (const socket of this.m_sockets)
    {
      socket.terminate();
    }
    this.m_sockets.clear();
    this.m_focusedSockets.clear();

    await this.DrainInFlight();
    this.m_dictatorRPC?.disconnect();
  }

  get ClientCount(): number
  {
    return this.m_sockets.size;
  }

  private AnyClientFocused(): boolean
  {
    return this.m_focusedSockets.size > 0;
  }

  async Attach(socket: WebSocket, params: WorkspaceWebSocketConnectParams): Promise<void>
  {
    this.m_sockets.add(socket);
    this.m_socketClientIds.set(socket, params.clientId);
    this.m_focusedSockets.add(socket);
    TraceAgentReview("session.attach", {
      repoId: this.m_key.repoId,
      workspaceId: this.m_key.workspaceId,
      clientId: params.clientId,
      clients: this.m_sockets.size,
      focusedClients: this.m_focusedSockets.size,
    });
    socket.on("message", (data) =>
    {
      this.RunBackground("client message", () => this.HandleMessage(socket, data));
    });
    socket.on("close", () =>
    {
      this.m_sockets.delete(socket);
      this.m_socketClientIds.delete(socket);
      this.m_focusedSockets.delete(socket);
      TraceAgentReview("session.detach", {
        repoId: this.m_key.repoId,
        workspaceId: this.m_key.workspaceId,
        clients: this.m_sockets.size,
        focusedClients: this.m_focusedSockets.size,
      });
      if (this.m_sockets.size === 0)
      {
        // Last client gone: clear local state and disconnect. Disconnect makes
        // Dictator release pushed context, so we do not issue an RPC pop here.
        this.PopActiveContext();
        this.m_currentIndex = -1;
        this.m_visibleCommentHunkId = null;
        this.m_dictatorRPC?.disconnect();
      }
    });

    await this.Refresh();
    SendFrame(socket, {
      type: "bootstrap",
      state: this.RequireState(),
    });
    await this.UpdateDictatorCells();
  }

  async RefreshAndBroadcast(): Promise<void>
  {
    // No git/broadcast work once teardown has begun or when no client is
    // attached — there is nothing to broadcast to and it must not race teardown.
    if (this.m_closing || this.m_sockets.size === 0)
    {
      return;
    }

    if (this.m_refreshInFlight !== null)
    {
      await this.m_refreshInFlight;
      return;
    }

    this.m_refreshInFlight = this.Refresh()
      .then(() =>
      {
        this.BroadcastState();
        return this.UpdateDictatorCells();
      })
      .finally(() =>
      {
        this.m_refreshInFlight = null;
      });
    await this.m_refreshInFlight;
  }

  MaybeRefreshForChangedPath(absolutePath: string): void
  {
    const state = this.m_state;
    if (
      state === null ||
      state.sessionRoot === null ||
      !IsPathWithinRoot(state.sessionRoot, absolutePath)
    )
    {
      return;
    }

    this.RunBackground("file-change refresh", () => this.RefreshAndBroadcast());
  }

  private RequireState(): AgentReviewState
  {
    if (this.m_state === null)
    {
      throw new StorageError("connection_failed", "Agent Review state not loaded");
    }

    return this.m_state;
  }

  private async Refresh(): Promise<void>
  {
    const sessionRoot = await this.m_agentManager.resolveWorkspaceRootDirectory(
      this.m_key.repoId,
      this.m_key.workspaceId,
    );
    const gitState = await LoadAgentReviewGitState(sessionRoot);
    const hadState = this.m_state !== null;
    const priorHunk = this.m_state?.currentHunk;
    const priorHunkId = priorHunk?.hunkId;
    let currentIndex = hadState && this.m_currentIndex < 0 && this.m_focusClearedExplicitly
      ? -1
      : priorHunkId === undefined
        ? this.m_currentIndex
        : gitState.hunks.findIndex((hunk) => hunk.hunkId === priorHunkId);

    if (currentIndex < 0 && this.m_currentIndex >= 0)
    {
      currentIndex = this.m_currentIndex;
    }

    this.m_currentIndex = this.SelectCurrentIndexAfterRefresh(
      gitState.hunks,
      currentIndex,
      priorHunk,
      hadState,
    );
    const actions = ActionsFor(
      gitState.hunks,
      this.m_currentIndex,
      this.m_undoStack.length > 0,
      this.m_fileNavigationAnchor,
    );
    const currentHunk = this.m_currentIndex >= 0 ? gitState.hunks[this.m_currentIndex]! : null;

    this.m_state = {
      ...gitState.availability,
      currentIndex: this.m_currentIndex,
      currentHunk,
      hunks: gitState.hunks,
      files: gitState.files,
      inlineFiles: gitState.inlineFiles,
      actions,
      reviewDraft: this.ReviewDraftState(),
      dictatorBridge: {
        connected: this.m_dictatorRPC?.connected ?? false,
        url: await this.DictatorUrl(),
        lastError: this.m_dictatorRPC?.lastError ?? null,
      },
    };
  }

  private SelectCurrentIndexAfterRefresh(
    hunks: AgentReviewHunk[],
    proposedIndex: number,
    priorHunk: AgentReviewHunk | null | undefined,
    hadState: boolean,
  ): number
  {
    if (this.m_postMutationPreferNoCrossFile && this.m_postMutationFile !== null)
    {
      const postMutationFile = this.m_postMutationFile;
      const targetPatchHash = this.m_postMutationTargetPatchHash;
      this.m_postMutationFile = null;
      this.m_postMutationTargetPatchHash = null;
      this.m_postMutationPreferNoCrossFile = false;

      if (targetPatchHash !== null)
      {
        const restoredTargetIndex = hunks.findIndex(
          (hunk) => hunk.file === postMutationFile && hunk.patchHash === targetPatchHash,
        );
        if (restoredTargetIndex >= 0)
        {
          return restoredTargetIndex;
        }
      }

      const sameFileIndex = hunks.findIndex((hunk) => hunk.file === postMutationFile);
      if (sameFileIndex >= 0)
      {
        this.m_fileNavigationAnchor = null;
        return sameFileIndex;
      }

      this.m_fileNavigationAnchor = postMutationFile;
      return -1;
    }

    if (!hadState)
    {
      this.m_fileNavigationAnchor = null;
      return NormalizeCurrentIndex(hunks, proposedIndex);
    }

    if (proposedIndex < 0 && this.m_focusClearedExplicitly)
    {
      return -1;
    }

    if (proposedIndex < 0 && this.m_fileNavigationAnchor !== null)
    {
      const anchoredFileIndex = hunks.findIndex((hunk) => hunk.file === this.m_fileNavigationAnchor);
      if (anchoredFileIndex >= 0)
      {
        this.m_fileNavigationAnchor = null;
        return anchoredFileIndex;
      }

      return -1;
    }

    if (proposedIndex < 0 && priorHunk != null)
    {
      const sameFileIndex = hunks.findIndex((hunk) => hunk.file === priorHunk.file);
      if (sameFileIndex >= 0)
      {
        return sameFileIndex;
      }
    }

    return NormalizeCurrentIndex(hunks, proposedIndex);
  }

  private async DictatorUrl(): Promise<string | null>
  {
    if (this.m_dictatorRPC?.url !== null && this.m_dictatorRPC?.url !== undefined)
    {
      return this.m_dictatorRPC.url;
    }
    const endpoint = await this.ResolveEndpoint();
    return endpoint?.url ?? null;
  }

  private async ResolveEndpoint(): Promise<DictatorEndpoint | null>
  {
    return this.m_dictatorEndpoint?.resolve() ?? null;
  }

  private BroadcastState(): void
  {
    const state = this.RequireState();
    for (const socket of this.m_sockets)
    {
      SendFrame(socket, {
        type: "state",
        state,
      });
    }
  }

  private BroadcastCommandResult(result: AgentReviewCommandResult): void
  {
    const state = this.RequireState();
    for (const client of this.m_sockets)
    {
      SendFrame(client, {
        type: "command_result",
        result,
        state,
      });
    }
  }

  private NextLaunchpadCommandId(): string
  {
    this.m_launchpadCommandSequence += 1;
    return `launchpad:${this.m_launchpadCommandSequence}`;
  }

  private ReviewDraftState(): AgentReviewDraftState
  {
    return {
      entries: this.m_reviewEntries.map((entry) => ({
        kind: entry.kind,
        hunk: entry.hunk,
        text: entry.text,
      })),
      visibleCommentHunkId: this.m_visibleCommentHunkId,
      hasSerializedContent: this.SerializedReview() !== null,
    };
  }

  private FindReviewEntryIndex(kind: AgentReviewDraftEntry["kind"], hunkId: string): number
  {
    return this.m_reviewEntries.findIndex(
      (entry) => entry.kind === kind && entry.hunk.hunkId === hunkId,
    );
  }

  private CommentForHunk(hunkId: string): string | null
  {
    const entry = this.m_reviewEntries.find(
      (candidate) => candidate.kind === "comment" && candidate.hunk.hunkId === hunkId,
    );
    return entry?.text ?? null;
  }

  private UpsertComment(hunk: AgentReviewHunk, text: string): void
  {
    const trimmed = text.trim();
    const index = this.FindReviewEntryIndex("comment", hunk.hunkId);
    if (trimmed.length === 0)
    {
      if (index >= 0)
      {
        this.m_reviewEntries.splice(index, 1);
      }
      return;
    }

    const entry: AgentReviewDraftEntry = { kind: "comment", hunk, text };
    if (index >= 0)
    {
      this.m_reviewEntries[index] = entry;
    }
    else
    {
      this.m_reviewEntries.push(entry);
    }
  }

  private AddRejectedMarker(hunk: AgentReviewHunk): void
  {
    if (this.FindReviewEntryIndex("rejected", hunk.hunkId) >= 0)
    {
      return;
    }
    this.m_reviewEntries.push({ kind: "rejected", hunk });
  }

  private RemoveRejectedMarker(hunk: AgentReviewHunk): void
  {
    const index = this.FindReviewEntryIndex("rejected", hunk.hunkId);
    if (index >= 0)
    {
      this.m_reviewEntries.splice(index, 1);
    }
  }

  private SerializedReview(): string | null
  {
    const serializable = this.m_reviewEntries.filter((entry) =>
      entry.kind === "rejected" ||
      (entry.text?.trim().length ?? 0) > 0
    );
    if (serializable.length === 0)
    {
      return null;
    }

    return serializable.map((entry, index) =>
    {
      const hunk = entry.hunk;
      const content = entry.kind === "rejected"
        ? "Rejected this hunk. Do not reintroduce it in the next turn."
        : entry.text!.trim();
      return [
        `${index + 1}. ${hunk.sourceProvider} ${hunk.file} ${hunk.header} [${hunk.patchHash}]`,
        content,
        "",
        "```diff",
        hunk.patch.trimEnd(),
        "```",
      ].join("\n");
    }).join("\n\n");
  }

  private ClearReviewDraftAfterSuccessfulInsert(): void
  {
    this.m_reviewEntries.length = 0;
    this.m_visibleCommentHunkId = null;
  }

  private ReviewCellColor(): ReviewCellColor
  {
    const state = this.RequireState();
    const current = state.currentHunk;
    if (current !== null)
    {
      return this.CommentForHunk(current.hunkId) !== null ||
        this.m_visibleCommentHunkId === current.hunkId
        ? "blue"
        : "grey";
    }
    return this.SerializedReview() === null ? "off" : "green";
  }

  private async HandleMessage(socket: WebSocket, data: WebSocket.RawData): Promise<void>
  {
    if (this.m_closing)
    {
      return;
    }

    let frame: AgentReviewClientFrame;
    try
    {
      frame = ParseClientFrame(data);
    }
    catch (error)
    {
      const code = error instanceof StorageError ? error.code : "invalid_frame";
      const message = error instanceof Error ? error.message : String(error);
      this.LogHandledError({
        socket,
        code,
        message,
      });
      SendFrame(socket, {
        type: "error",
        code,
        message,
      });
      return;
    }

    if (frame.type === "focus")
    {
      await this.FocusHunk(frame.hunkId ?? null, frame.file ?? null);
      this.BroadcastState();
      await this.UpdateDictatorCells();
      return;
    }

    if (frame.type === "comment")
    {
      await this.UpdateComment(frame.hunkId, frame.text);
      this.BroadcastState();
      await this.UpdateDictatorCells();
      return;
    }

    if (frame.type === "comment_focus")
    {
      await this.PushCommentContext(frame.hunkId);
      return;
    }

    if (frame.type === "comment_blur")
    {
      await this.PopCommentContext(frame.hunkId);
      return;
    }

    if (frame.type === "presence")
    {
      const wasAnyFocused = this.AnyClientFocused();
      if (frame.focused)
      {
        this.m_focusedSockets.add(socket);
      }
      else
      {
        this.m_focusedSockets.delete(socket);
      }
      // Only touch the Launchpad when the aggregate focus state flips: clear it
      // on going fully dark, restore it on the first focused client returning.
      if (wasAnyFocused !== this.AnyClientFocused())
      {
        TraceAgentReview("presence.focus_changed", {
          repoId: this.m_key.repoId,
          workspaceId: this.m_key.workspaceId,
          focused: this.AnyClientFocused(),
          focusedClients: this.m_focusedSockets.size,
        });
        await this.UpdateDictatorCells();
      }
      return;
    }

    TraceAgentReview("client.command.received", {
      repoId: this.m_key.repoId,
      workspaceId: this.m_key.workspaceId,
      action: frame.action,
      commandId: frame.id,
      hunkId: frame.hunkId,
      patchHash: frame.patchHash,
      clients: this.m_sockets.size,
      focusedClients: this.m_focusedSockets.size,
    });
    const result = await this.ExecuteCommand(frame.action, {
      commandId: frame.id,
      hunkId: frame.hunkId,
      patchHash: frame.patchHash,
    });
    if (!result.ok)
    {
      this.LogHandledError({
        socket,
        action: result.action,
        commandId: result.commandId,
        message: result.error ?? "Agent Review command failed",
        stale: result.stale,
      });
    }
    this.BroadcastCommandResult(result);
  }

  private LogHandledError(fields: {
    message: string;
    socket?: WebSocket;
    code?: string;
    action?: AgentReviewAction;
    commandId?: string;
    stale?: boolean;
  }): void
  {
    LogHandledServerError({
      feature: "agent-review",
      code: fields.code,
      action: fields.action,
      commandId: fields.commandId,
      message: fields.message,
      stale: fields.stale,
      repoId: this.m_key.repoId,
      workspaceId: this.m_key.workspaceId,
      clientId: fields.socket !== undefined ? this.m_socketClientIds.get(fields.socket) : undefined,
    });
  }

  private async FocusHunk(hunkId: string | null, file: string | null = null): Promise<void>
  {
    const previousVisible = this.m_visibleCommentHunkId;
    const state = this.RequireState();
    if (hunkId === null)
    {
      this.m_currentIndex = -1;
      this.m_focusClearedExplicitly = true;
      this.m_fileNavigationAnchor = file;
      this.m_state = {
        ...state,
        currentIndex: -1,
        currentHunk: null,
        actions: ActionsFor(
          state.hunks,
          -1,
          this.m_undoStack.length > 0,
          this.m_fileNavigationAnchor,
        ),
      };
    }
    else
    {
      const index = state.hunks.findIndex((hunk) => hunk.hunkId === hunkId);
      if (index >= 0)
      {
        this.m_currentIndex = index;
        this.m_focusClearedExplicitly = false;
        this.m_fileNavigationAnchor = null;
      }
    }

    await this.Refresh();
    const current = this.RequireState().currentHunk;
    if (current === null || current.hunkId !== previousVisible)
    {
      this.m_visibleCommentHunkId = current !== null && this.CommentForHunk(current.hunkId) !== null
        ? current.hunkId
        : null;
      this.PopActiveContext();
      await this.Refresh();
    }
  }

  private async UpdateComment(hunkId: string, text: string): Promise<void>
  {
    const state = this.RequireState();
    const hunk = state.hunks.find((candidate) => candidate.hunkId === hunkId);
    if (hunk === undefined)
    {
      return;
    }
    this.UpsertComment(hunk, text);
    this.m_visibleCommentHunkId = hunkId;
    await this.Refresh();
  }

  private async PushCommentContext(hunkId: string): Promise<void>
  {
    const state = this.RequireState();
    const hunk = state.currentHunk?.hunkId === hunkId
      ? state.currentHunk
      : state.hunks.find((candidate) => candidate.hunkId === hunkId) ?? null;
    if (hunk === null)
    {
      return;
    }

    if (this.m_pushedContextHunkId !== null && this.m_pushedContextHunkId !== hunkId)
    {
      await this.PopCommentContext(this.m_pushedContextHunkId);
    }

    try
    {
      await this.m_dictatorRPC?.pushContext(hunk);
      this.m_pushedContextHunkId = hunkId;
    }
    catch
    {
    }
  }

  private async PopCommentContext(hunkId: string): Promise<void>
  {
    if (this.m_pushedContextHunkId !== hunkId)
    {
      return;
    }
    this.m_pushedContextHunkId = null;
    try
    {
      await this.m_dictatorRPC?.popContext(hunkId);
    }
    catch
    {
    }
  }

  private PopActiveContext(): void
  {
    // Local-only: callers disconnect the RPC immediately afterward, and Dictator
    // releases pushed context on disconnect. Issuing an RPC pop here would be a
    // fire-and-forget call that could outlive the connection.
    this.m_pushedContextHunkId = null;
  }

  private async ExecuteCommand(
    action: AgentReviewAction,
    options: { commandId?: string; hunkId?: string; patchHash?: string },
  ): Promise<AgentReviewCommandResult>
  {
    TraceAgentReview("command.start", {
      repoId: this.m_key.repoId,
      workspaceId: this.m_key.workspaceId,
      action,
      commandId: options.commandId,
      hunkId: options.hunkId,
      patchHash: options.patchHash,
      currentIndex: this.m_currentIndex,
      hunkCount: this.m_state?.hunks.length,
      clients: this.m_sockets.size,
      focusedClients: this.m_focusedSockets.size,
    });
    let result: AgentReviewCommandResult;
    if (
      action === "previousHunk" ||
      action === "nextHunk" ||
      action === "previousFile" ||
      action === "nextFile"
    )
    {
      result = await this.Navigate(action, options.commandId);
    }
    else if (action === "undo")
    {
      result = await this.Undo(options.commandId);
    }
    else
    {
      result = await this.MutateCurrentHunk(action, options);
    }

    await this.Refresh();
    this.BroadcastState();
    await this.UpdateDictatorCells();
    TraceAgentReview("command.end", {
      repoId: this.m_key.repoId,
      workspaceId: this.m_key.workspaceId,
      action,
      commandId: options.commandId,
      ok: result.ok,
      error: result.error,
      stale: result.stale,
      currentIndex: this.m_currentIndex,
      hunkCount: this.m_state?.hunks.length,
    });
    return result;
  }

  private async Navigate(
    action: AgentReviewAction,
    commandId?: string,
  ): Promise<AgentReviewCommandResult>
  {
    const state = this.RequireState();
    if (state.hunks.length === 0)
    {
      return { ok: false, action, commandId, error: "no hunks available" };
    }

    if (action === "previousHunk" || action === "nextHunk")
    {
      // Loop within the current file's contiguous run: next-hunk wraps from the
      // last hunk to the first, previous-hunk wraps from the first to the last.
      // File boundaries are crossed only by the file commands.
      if (this.m_currentIndex < 0)
      {
        this.m_currentIndex = NormalizeCurrentIndex(state.hunks, 0);
      }
      else
      {
        const [start, end] = FileHunkRange(state.hunks, this.m_currentIndex);
        this.m_currentIndex = action === "nextHunk"
          ? (this.m_currentIndex >= end ? start : this.m_currentIndex + 1)
          : (this.m_currentIndex <= start ? end : this.m_currentIndex - 1);
      }
    }
    else if (action === "previousFile")
    {
      // Land on the first hunk of the previous file, regardless of which hunk in
      // the current file is selected.
      const current = state.hunks[this.m_currentIndex];
      if (current === undefined && this.m_fileNavigationAnchor !== null)
      {
        const target = LastHunkIndexBeforeFile(state.hunks, this.m_fileNavigationAnchor);
        if (target >= 0)
        {
          const targetFile = state.hunks[target]!.file;
          this.m_currentIndex = state.hunks.findIndex((hunk) => hunk.file === targetFile);
        }
      }
      else if (current !== undefined && current.fileIndex > 0)
      {
        const target = state.hunks.findIndex((hunk) => hunk.fileIndex === current.fileIndex - 1);
        if (target >= 0)
        {
          this.m_currentIndex = target;
        }
      }
    }
    else if (action === "nextFile")
    {
      // Land on the first hunk of the next file, regardless of which hunk in the
      // current file is selected.
      const current = state.hunks[this.m_currentIndex];
      if (current === undefined && this.m_fileNavigationAnchor !== null)
      {
        const target = FirstHunkIndexAfterFile(state.hunks, this.m_fileNavigationAnchor);
        if (target >= 0)
        {
          this.m_currentIndex = target;
        }
      }
      else if (current === undefined)
      {
        this.m_currentIndex = 0;
      }
      else if (current.fileIndex < current.fileCount - 1)
      {
        const target = state.hunks.findIndex((hunk) => hunk.fileIndex === current.fileIndex + 1);
        if (target >= 0)
        {
          this.m_currentIndex = target;
        }
      }
    }

    if (this.m_currentIndex >= 0)
    {
      this.m_fileNavigationAnchor = null;
      this.m_focusClearedExplicitly = false;
    }

    // Reflect the new focus in the cached state. Refresh() re-pins focus by the
    // current hunk's id (to preserve it across external changes); without this,
    // navigation — which does not mutate the worktree — would be undone because
    // the prior hunk is still present and Refresh would restore it.
    this.m_state = {
      ...state,
      currentIndex: this.m_currentIndex,
      currentHunk: this.m_currentIndex >= 0 ? state.hunks[this.m_currentIndex]! : null,
    };

    return { ok: true, action, commandId };
  }

  private ValidateTargetHunk(
    action: AgentReviewAction,
    hunkId?: string,
    patchHash?: string,
  ): AgentReviewHunk
  {
    const state = this.RequireState();
    const hunk = state.currentHunk;

    if (hunk === null)
    {
      throw new StorageError("invalid_request", `cannot ${action}: no focused hunk`);
    }

    if (hunkId !== undefined && hunk.hunkId !== hunkId)
    {
      throw new StorageError("stale_hunk", "focused hunk changed");
    }

    if (patchHash !== undefined && hunk.patchHash !== patchHash)
    {
      throw new StorageError("stale_hunk", "focused hunk patch changed");
    }

    AssertReviewHunkUnderSession(hunk);
    return hunk;
  }

  private async VerifyTargetMutation(
    action: "stage" | "revert",
    hunk: AgentReviewHunk,
    expectedIndexContent?: string,
    expectedWorktreeContent?: string,
  ): Promise<string | null>
  {
    const priorState = this.RequireState();
    const priorSameFile = priorState.hunks.filter((candidate) => candidate.file === hunk.file);
    const priorOccurrenceCounts = CountChangedOccurrences(priorSameFile);
    const expectedOccurrenceCounts = SubtractHunkOccurrences(priorOccurrenceCounts, hunk);
    const priorContentCounts = CountChangedContentLines(priorSameFile);
    const expectedContentCounts = SubtractHunkContentLines(priorContentCounts, hunk);

    let refreshed;
    try
    {
      refreshed = await LoadAgentReviewGitState(hunk.sessionRoot);
    }
    catch (error)
    {
      return error instanceof Error ? error.message : String(error);
    }

    const refreshedSameFile = refreshed.hunks.filter((candidate) => candidate.file === hunk.file);
    const refreshedOccurrenceCounts = CountChangedOccurrences(refreshedSameFile);
    for (const occurrence of HunkChangedOccurrences(hunk))
    {
      const key = ChangedOccurrenceKey(occurrence);
      if ((refreshedOccurrenceCounts.get(key) ?? 0) > (expectedOccurrenceCounts.get(key) ?? 0))
      {
        return "selected hunk is still unstaged after mutation";
      }
    }

    const refreshedContentCounts = CountChangedContentLines(refreshedSameFile);
    for (const [signature, expectedCount] of expectedContentCounts)
    {
      if ((refreshedContentCounts.get(signature) ?? 0) < expectedCount)
      {
        return "a sibling hunk changed while mutating the selected hunk";
      }
    }
    for (const [signature, refreshedCount] of refreshedContentCounts)
    {
      if (refreshedCount > (expectedContentCounts.get(signature) ?? 0))
      {
        return "a sibling hunk changed while mutating the selected hunk";
      }
    }

    if (action === "stage")
    {
      if (expectedIndexContent === undefined)
      {
        return "selected hunk was not staged into the Git index: missing expected index snapshot";
      }
      let actualIndexContent: string;
      try
      {
        actualIndexContent = await ReadAgentReviewIndexFile(hunk.repoRoot, hunk.file);
      }
      catch (error)
      {
        return error instanceof Error ? error.message : String(error);
      }
      if (actualIndexContent !== expectedIndexContent)
      {
        return "selected hunk was not staged into the Git index";
      }
    }
    else if (expectedWorktreeContent !== undefined)
    {
      let actualWorktreeContent: string;
      try
      {
        actualWorktreeContent = await readFile(path.resolve(hunk.repoRoot, hunk.file), "utf8");
      }
      catch (error)
      {
        return error instanceof Error ? error.message : String(error);
      }
      if (actualWorktreeContent !== expectedWorktreeContent)
      {
        return "selected hunk was not reverted from the worktree";
      }
    }

    return null;
  }

  private async MutateCurrentHunk(
    action: "stage" | "revert",
    options: { commandId?: string; hunkId?: string; patchHash?: string },
  ): Promise<AgentReviewCommandResult>
  {
    let hunk: AgentReviewHunk;
    try
    {
      if (options.hunkId !== undefined || options.patchHash !== undefined)
      {
        await this.Refresh();
      }
      hunk = this.ValidateTargetHunk(action, options.hunkId, options.patchHash);
    }
    catch (error)
    {
      TraceAgentReview("mutation.validate_failed", {
        repoId: this.m_key.repoId,
        workspaceId: this.m_key.workspaceId,
        action,
        commandId: options.commandId,
        hunkId: options.hunkId,
        patchHash: options.patchHash,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        action,
        commandId: options.commandId,
        error: error instanceof Error ? error.message : String(error),
        stale: error instanceof StorageError && error.code === "stale_hunk",
      };
    }

    let expectedIndexContent: string | undefined;
    let originalWorktreeContent: string | undefined;
    let expectedWorktreeContent: string | undefined;
    if (action === "stage")
    {
      try
      {
        expectedIndexContent = ApplyHunkToIndexedContent(
          await ReadAgentReviewIndexFile(hunk.repoRoot, hunk.file),
          hunk,
        );
      }
      catch (error)
      {
        return {
          ok: false,
          action,
          commandId: options.commandId,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    else
    {
      try
      {
        originalWorktreeContent = await readFile(path.resolve(hunk.repoRoot, hunk.file), "utf8");
        expectedWorktreeContent = ApplyReverseHunkToWorktreeContent(originalWorktreeContent, hunk);
      }
      catch (error)
      {
        return {
          ok: false,
          action,
          commandId: options.commandId,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const result = action === "stage"
      ? await ApplyAgentReviewPatch(hunk.repoRoot, "stage", hunk.patch)
      : await (async (): Promise<{ ok: boolean; error?: string }> =>
        {
          try
          {
            await writeFile(path.resolve(hunk.repoRoot, hunk.file), expectedWorktreeContent!, "utf8");
            return { ok: true };
          }
          catch (error)
          {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        })();
    TraceAgentReview("mutation.apply_result", {
      repoId: this.m_key.repoId,
      workspaceId: this.m_key.workspaceId,
      action,
      commandId: options.commandId,
      hunkId: hunk.hunkId,
      patchHash: hunk.patchHash,
      file: hunk.file,
      ok: result.ok,
      error: result.error,
    });

    if (!result.ok)
    {
      return {
        ok: false,
        action,
        commandId: options.commandId,
        error: result.error,
      };
    }

    const verificationError = await this.VerifyTargetMutation(
      action,
      hunk,
      expectedIndexContent,
      expectedWorktreeContent,
    );
    if (verificationError !== null)
    {
      TraceAgentReview("mutation.verify_failed", {
        repoId: this.m_key.repoId,
        workspaceId: this.m_key.workspaceId,
        action,
        commandId: options.commandId,
        hunkId: hunk.hunkId,
        message: verificationError,
      });
      const rollback = action === "stage"
        ? await ApplyAgentReviewPatch(hunk.repoRoot, "unstage", hunk.patch)
        : await (async (): Promise<{ ok: boolean; error?: string }> =>
          {
            try
            {
              await writeFile(path.resolve(hunk.repoRoot, hunk.file), originalWorktreeContent!, "utf8");
              return { ok: true };
            }
            catch (error)
            {
              return { ok: false, error: error instanceof Error ? error.message : String(error) };
            }
          })();
      return {
        ok: false,
        action,
        commandId: options.commandId,
        error: rollback.ok
          ? verificationError
          : `${verificationError}; rollback failed: ${rollback.error ?? "unknown error"}`,
      };
    }

    this.m_postMutationFile = hunk.file;
    this.m_postMutationTargetPatchHash = null;
    this.m_postMutationPreferNoCrossFile = true;
    this.m_undoStack.push({ action, hunk });
    if (action === "revert")
    {
      this.AddRejectedMarker(hunk);
    }
    return {
      ok: true,
      action,
      commandId: options.commandId,
    };
  }

  private async Undo(commandId?: string): Promise<AgentReviewCommandResult>
  {
    const entry = this.m_undoStack.pop();
    if (entry === undefined)
    {
      return { ok: false, action: "undo", commandId, error: "no undoable hunk mutation" };
    }

    const result = entry.action === "stage"
      ? await ApplyAgentReviewPatch(entry.hunk.repoRoot, "unstage", entry.hunk.patch)
      : await (async (): Promise<{ ok: boolean; error?: string }> =>
        {
          try
          {
            const currentWorktreeContent = await readFile(path.resolve(entry.hunk.repoRoot, entry.hunk.file), "utf8");
            const restoredWorktreeContent = ApplyRestoreHunkToWorktreeContent(
              currentWorktreeContent,
              entry.hunk,
            );
            await writeFile(path.resolve(entry.hunk.repoRoot, entry.hunk.file), restoredWorktreeContent, "utf8");
            return { ok: true };
          }
          catch (error)
          {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        })();

    if (!result.ok)
    {
      this.m_undoStack.push(entry);
      return {
        ok: false,
        action: "undo",
        commandId,
        error: result.error,
      };
    }

    this.m_postMutationFile = entry.hunk.file;
    this.m_postMutationTargetPatchHash = entry.hunk.patchHash;
    this.m_postMutationPreferNoCrossFile = true;
    if (entry.action === "revert")
    {
      this.RemoveRejectedMarker(entry.hunk);
    }

    return {
      ok: true,
      action: "undo",
      commandId,
    };
  }

  private async UpdateDictatorCells(): Promise<void>
  {
    if (this.m_dictatorRPC === null || this.m_sockets.size === 0 || this.m_state === null)
    {
      return;
    }

    try
    {
      // While no attached client is focused, keep navigation/mutation cells off
      // regardless of action availability. The review cell may stay armed for
      // pasting a serialized draft after focus has deliberately been cleared.
      if (!this.AnyClientFocused())
      {
        const reviewColor =
          this.m_state.currentHunk === null && this.SerializedReview() !== null
            ? "green"
            : "off";
        await this.m_dictatorRPC.setCellsWithStaleSessionRetry(reviewColor, EmptyActions());
      }
      else
      {
        await this.m_dictatorRPC.setCellsWithStaleSessionRetry(this.ReviewCellColor(), this.m_state.actions);
      }
    }
    catch (error)
    {
      TraceAgentReview("dictator_cells.update_failed", {
        repoId: this.m_key.repoId,
        workspaceId: this.m_key.workspaceId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async HandleCellPressed(x: number, y: number): Promise<void>
  {
    TraceAgentReview("launchpad.cell.dispatch", {
      repoId: this.m_key.repoId,
      workspaceId: this.m_key.workspaceId,
      x,
      y,
      closing: this.m_closing,
      clients: this.m_sockets.size,
      focusedClients: this.m_focusedSockets.size,
      hasState: this.m_state !== null,
      currentIndex: this.m_currentIndex,
    });
    // Ignore presses once teardown has begun. When no client is focused,
    // navigation/mutation cells remain inert, but an armed review cell can still
    // paste the serialized draft.
    if (this.m_closing)
    {
      TraceAgentReview("launchpad.cell.ignored", {
        repoId: this.m_key.repoId,
        workspaceId: this.m_key.workspaceId,
        x,
        y,
        reason: "closing",
      });
      return;
    }

    if (x === REVIEW_CELL.x && y === REVIEW_CELL.y)
    {
      if (
        !this.AnyClientFocused() &&
        (this.m_state?.currentHunk !== null || this.SerializedReview() === null)
      )
      {
        TraceAgentReview("launchpad.cell.ignored", {
          repoId: this.m_key.repoId,
          workspaceId: this.m_key.workspaceId,
          x,
          y,
          reason: "review_cell_unfocused",
        });
        return;
      }
      await this.HandleReviewCellPressed();
      return;
    }

    if (!this.AnyClientFocused())
    {
      TraceAgentReview("launchpad.cell.ignored", {
        repoId: this.m_key.repoId,
        workspaceId: this.m_key.workspaceId,
        x,
        y,
        reason: "no_focused_client",
      });
      return;
    }

    const cell = NAV_CELLS.find((candidate) => candidate.x === x && candidate.y === y);
    if (cell === undefined || this.m_state === null)
    {
      TraceAgentReview("launchpad.cell.ignored", {
        repoId: this.m_key.repoId,
        workspaceId: this.m_key.workspaceId,
        x,
        y,
        reason: cell === undefined ? "unmapped_cell" : "no_state",
      });
      return;
    }
    if (!this.m_state.actions[cell.availability])
    {
      TraceAgentReview("launchpad.cell.ignored", {
        repoId: this.m_key.repoId,
        workspaceId: this.m_key.workspaceId,
        x,
        y,
        action: cell.action,
        reason: "action_unavailable",
      });
      return;
    }

    TraceAgentReview("launchpad.command.start", {
      repoId: this.m_key.repoId,
      workspaceId: this.m_key.workspaceId,
      x,
      y,
      action: cell.action,
      availability: cell.availability,
    });
    const target = cell.action === "stage" || cell.action === "revert"
      ? this.m_state.currentHunk
      : null;
    const result = await this.ExecuteCommand(cell.action, {
      commandId: this.NextLaunchpadCommandId(),
      hunkId: target?.hunkId,
      patchHash: target?.patchHash,
    });
    TraceAgentReview("launchpad.command.end", {
      repoId: this.m_key.repoId,
      workspaceId: this.m_key.workspaceId,
      x,
      y,
      action: cell.action,
      ok: result.ok,
      commandId: result.commandId,
      error: result.error,
    });
    if (!result.ok)
    {
      this.LogHandledError({
        action: result.action,
        commandId: result.commandId,
        message: result.error ?? "Agent Review command failed",
        stale: result.stale,
      });
    }
    this.BroadcastCommandResult(result);
  }

  private async HandleReviewCellPressed(): Promise<void>
  {
    if (this.m_state === null)
    {
      return;
    }

    const current = this.m_state.currentHunk;
    if (current !== null)
    {
      this.m_visibleCommentHunkId = current.hunkId;
      await this.Refresh();
      this.BroadcastState();
      for (const socket of this.m_sockets)
      {
        SendFrame(socket, { type: "focus_comment", hunkId: current.hunkId });
      }
      await this.UpdateDictatorCells();
      return;
    }

    const serialized = this.SerializedReview();
    if (serialized === null)
    {
      return;
    }

    try
    {
      await this.m_dictatorRPC?.insertText(serialized);
      this.ClearReviewDraftAfterSuccessfulInsert();
      if (this.m_state !== null)
      {
        this.m_state = {
          ...this.m_state,
          reviewDraft: this.ReviewDraftState(),
        };
      }
      try
      {
        await this.Refresh();
      }
      catch
      {
      }
      this.BroadcastState();
      await this.UpdateDictatorCells();
    }
    catch
    {
      await this.UpdateDictatorCells();
    }
  }
}

export class AgentReviewService
{
  private readonly m_config: SheafChatConfig;
  private readonly m_agentManager: AgentManager;
  private readonly m_sessions = new Map<string, AgentReviewSession>();
  private readonly m_dictatorEndpoint: DictatorEndpointResolver | null;

  constructor(options: AgentReviewServiceOptions)
  {
    this.m_config = options.config;
    this.m_agentManager = options.agentManager;
    this.m_dictatorEndpoint = CreateDictatorEndpointResolver(options.config);
  }

  CreateWebSocketServer(): WebSocketServer
  {
    return new WebSocketServer({ noServer: true });
  }

  async Availability(
    repoId: string,
    workspaceId: string,
  ): Promise<AgentReviewState>
  {
    const sessionRoot = await this.m_agentManager.resolveWorkspaceRootDirectory(
      repoId,
      workspaceId,
    );
    const gitState = await LoadAgentReviewGitState(sessionRoot);
    const currentIndex = NormalizeCurrentIndex(gitState.hunks, 0);

    return {
      ...gitState.availability,
      currentIndex,
      currentHunk: currentIndex >= 0 ? gitState.hunks[currentIndex]! : null,
      hunks: gitState.hunks,
      files: gitState.files,
      inlineFiles: gitState.inlineFiles,
      actions: ActionsFor(gitState.hunks, currentIndex, false),
      reviewDraft: {
        entries: [],
        visibleCommentHunkId: null,
        hasSerializedContent: false,
      },
      dictatorBridge: {
        connected: false,
        url: (await this.m_dictatorEndpoint?.resolve())?.url ?? null,
        lastError: null,
      },
    };
  }

  async NotifyFileChanged(event: FileChangedNotification): Promise<void>
  {
    const absolute = path.resolve(event.absolutePath);
    for (const session of this.m_sessions.values())
    {
      session.MaybeRefreshForChangedPath(absolute);
    }
  }

  async Attach(socket: WebSocket, params: WorkspaceWebSocketConnectParams): Promise<void>
  {
    const key = {
      repoId: params.repoId,
      workspaceId: params.workspaceId,
    };
    const session = this.GetOrCreateSession(key);
    await session.Attach(socket, params);
  }

  async ReleaseIdle(): Promise<void>
  {
    const idle: AgentReviewSession[] = [];
    for (const [key, session] of this.m_sessions.entries())
    {
      if (session.ClientCount === 0)
      {
        idle.push(session);
        this.m_sessions.delete(key);
      }
    }
    await Promise.all(idle.map((session) => session.Dispose()));
  }

  async Dispose(): Promise<void>
  {
    const sessions = [...this.m_sessions.values()];
    this.m_sessions.clear();
    await Promise.all(sessions.map((session) => session.Dispose()));
  }

  private GetOrCreateSession(key: WorkspaceReviewKey): AgentReviewSession
  {
    const encoded = FormatWorkspaceReviewKey(key);
    let session = this.m_sessions.get(encoded);

    if (session === undefined)
    {
      session = new AgentReviewSession(key, this.m_agentManager, this.m_dictatorEndpoint);
      this.m_sessions.set(encoded, session);
    }

    return session;
  }
}

export function MatchAgentReviewWebSocketPath(pathname: string): boolean
{
  return pathname === "/ws/agent-review";
}

export async function ResolveAgentReviewWebSocketUpgrade(
  agentReviewService: AgentReviewService,
  request: IncomingMessage,
): Promise<WorkspaceWebSocketConnectParams | null>
{
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (!MatchAgentReviewWebSocketPath(url.pathname))
  {
    return null;
  }

  const params = ParseAgentReviewWebSocketQuery(url);
  await agentReviewService.Availability(params.repoId, params.workspaceId);
  return params;
}

export async function HandleAgentReviewUpgrade(
  agentReviewService: AgentReviewService,
  webSocketServer: WebSocketServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<boolean>
{
  try
  {
    const params = await ResolveAgentReviewWebSocketUpgrade(agentReviewService, request);
    if (params === null)
    {
      return false;
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) =>
    {
      webSocketServer.emit("connection", webSocket, request);
      void agentReviewService.Attach(webSocket, params);
    });
    return true;
  }
  catch (error)
  {
    if (error instanceof StorageError)
    {
      rejectUpgradeWithHttpStatus(socket, StorageErrorToHttpStatus(error), error.message);
      return true;
    }

    rejectUpgradeWithHttpStatus(socket, 400, error instanceof Error ? error.message : "bad request");
    return true;
  }
}
