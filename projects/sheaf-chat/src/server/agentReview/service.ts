import { readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import path from "node:path";

import { WebSocket, WebSocketServer } from "ws";

import type { AgentManager } from "../../agents/manager.js";
import { FormatSessionKey, type SessionKey } from "../../agents/lifecycle.js";
import type { FileChangedNotification } from "../../extensions/sheaf-chat/types.js";
import type { SheafChatConfig } from "../config.js";
import {
  ParseChatWebSocketQuery,
  rejectUpgradeWithHttpStatus,
  StorageErrorToHttpStatus,
  type ChatWebSocketConnectParams,
} from "../websocket.js";
import { StorageError } from "../../storage/errors.js";
import {
  ApplyAgentReviewPatch,
  AssertReviewHunkUnderSession,
  LoadAgentReviewGitState,
  ResolveAgentReviewAvailability,
} from "./git.js";
import type {
  AgentReviewAction,
  AgentReviewActions,
  AgentReviewClientFrame,
  AgentReviewCommandResult,
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

function ActionsFor(hunks: AgentReviewHunk[], currentIndex: number, canUndo: boolean): AgentReviewActions
{
  if (hunks.length === 0 || currentIndex < 0)
  {
    return {
      ...EmptyActions(),
      canUndo,
    };
  }

  const current = hunks[currentIndex]!;
  const previous = hunks[currentIndex - 1];
  const next = hunks[currentIndex + 1];

  return {
    canGoUp: currentIndex > 0,
    canGoDown: currentIndex < hunks.length - 1,
    canGoPrevFile: previous !== undefined && previous.file !== current.file,
    canGoNextFile: next !== undefined && next.file !== current.file,
    canStage: true,
    canRevert: true,
    canUndo,
  };
}

function DictatorActionPayload(action: AgentReviewAction): string
{
  return action;
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

function NormalizeCurrentIndex(hunks: AgentReviewHunk[], desiredIndex: number): number
{
  if (hunks.length === 0)
  {
    return -1;
  }

  return Math.min(Math.max(0, desiredIndex), hunks.length - 1);
}

function ParseClientFrame(data: WebSocket.RawData): AgentReviewClientFrame
{
  const parsed = JSON.parse(data.toString()) as Partial<AgentReviewClientFrame>;

  if (parsed.type === "focus")
  {
    return {
      type: "focus",
      hunkId: parsed.hunkId,
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
  private readonly m_key: SessionKey;
  private readonly m_agentManager: AgentManager;
  private readonly m_dictatorEndpoint: DictatorEndpointResolver | null;
  private readonly m_providerId: string;
  private readonly m_sockets = new Set<WebSocket>();
  private readonly m_undoStack: UndoEntry[] = [];
  private m_state: AgentReviewState | null = null;
  private m_currentIndex = -1;
  private m_bridgeConnected = false;
  private m_bridgeLastError: string | null = null;
  private m_pollTimer: NodeJS.Timeout | null = null;
  private m_refreshInFlight: Promise<void> | null = null;

  constructor(
    key: SessionKey,
    agentManager: AgentManager,
    dictatorEndpoint: DictatorEndpointResolver | null,
  )
  {
    this.m_key = key;
    this.m_agentManager = agentManager;
    this.m_dictatorEndpoint = dictatorEndpoint;
    this.m_providerId = `sheaf-chat:${key.pile}:${key.sessionId}`;
  }

  Dispose(): void
  {
    this.ClearPollTimer();

    for (const socket of this.m_sockets)
    {
      socket.close();
    }

    this.m_sockets.clear();
    void this.DisconnectDictator();
  }

  get ClientCount(): number
  {
    return this.m_sockets.size;
  }

  async Attach(socket: WebSocket): Promise<void>
  {
    this.m_sockets.add(socket);
    socket.on("message", (data) =>
    {
      void this.HandleMessage(socket, data);
    });
    socket.on("close", () =>
    {
      this.m_sockets.delete(socket);
      if (this.m_sockets.size === 0)
      {
        this.ClearPollTimer();
        this.m_currentIndex = -1;
        void this.DisconnectDictator();
      }
    });

    await this.Refresh();
    SendFrame(socket, {
      type: "bootstrap",
      state: this.RequireState(),
    });
    this.EnsurePollTimer();
    await this.PublishDictatorState();
  }

  async RefreshAndBroadcast(): Promise<void>
  {
    if (this.m_refreshInFlight !== null)
    {
      await this.m_refreshInFlight;
      return;
    }

    this.m_refreshInFlight = this.Refresh()
      .then(() =>
      {
        this.BroadcastState();
        return this.PublishDictatorState();
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

    void this.RefreshAndBroadcast();
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
    const sessionRoot = await this.m_agentManager.resolveSessionRootDirectory(
      this.m_key.pile,
      this.m_key.sessionId,
    );
    const gitState = await LoadAgentReviewGitState(sessionRoot);
    const priorHunkId = this.m_state?.currentHunk?.hunkId;
    let currentIndex = priorHunkId === undefined
      ? this.m_currentIndex
      : gitState.hunks.findIndex((hunk) => hunk.hunkId === priorHunkId);

    if (currentIndex < 0)
    {
      currentIndex = this.m_currentIndex;
    }

    this.m_currentIndex = NormalizeCurrentIndex(gitState.hunks, currentIndex);
    const actions = ActionsFor(gitState.hunks, this.m_currentIndex, this.m_undoStack.length > 0);
    const currentHunk = this.m_currentIndex >= 0 ? gitState.hunks[this.m_currentIndex]! : null;

    this.m_state = {
      ...gitState.availability,
      currentIndex: this.m_currentIndex,
      currentHunk,
      hunks: gitState.hunks,
      files: gitState.files,
      actions,
      dictatorBridge: {
        connected: this.m_bridgeConnected,
        url: await this.DictatorUrl(),
        lastError: this.m_bridgeLastError,
      },
    };
  }

  private async DictatorUrl(): Promise<string | null>
  {
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

  private async HandleMessage(socket: WebSocket, data: WebSocket.RawData): Promise<void>
  {
    let frame: AgentReviewClientFrame;
    try
    {
      frame = ParseClientFrame(data);
    }
    catch (error)
    {
      SendFrame(socket, {
        type: "error",
        code: error instanceof StorageError ? error.code : "invalid_frame",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (frame.type === "focus")
    {
      await this.FocusHunk(frame.hunkId ?? null);
      this.BroadcastState();
      await this.PublishDictatorState();
      return;
    }

    const result = await this.ExecuteCommand(frame.action, {
      commandId: frame.id,
      hunkId: frame.hunkId,
      patchHash: frame.patchHash,
    });
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

  private async FocusHunk(hunkId: string | null): Promise<void>
  {
    const state = this.RequireState();
    if (hunkId === null)
    {
      this.m_currentIndex = -1;
    }
    else
    {
      const index = state.hunks.findIndex((hunk) => hunk.hunkId === hunkId);
      if (index >= 0)
      {
        this.m_currentIndex = index;
      }
    }

    await this.Refresh();
  }

  private async ExecuteCommand(
    action: AgentReviewAction,
    options: { commandId?: string; hunkId?: string; patchHash?: string },
  ): Promise<AgentReviewCommandResult>
  {
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
    await this.PublishCommandResult(result);
    await this.PublishDictatorState();
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

    if (action === "previousHunk")
    {
      this.m_currentIndex = NormalizeCurrentIndex(state.hunks, this.m_currentIndex - 1);
    }
    else if (action === "nextHunk")
    {
      this.m_currentIndex = NormalizeCurrentIndex(state.hunks, this.m_currentIndex + 1);
    }
    else if (action === "previousFile")
    {
      const current = state.hunks[this.m_currentIndex];
      const target = current === undefined
        ? -1
        : state.hunks
          .slice(0, this.m_currentIndex)
          .map((hunk, index) => ({ hunk, index }))
          .reverse()
          .find((entry) => entry.hunk.file !== current.file)?.index ?? -1;
      if (target >= 0)
      {
        this.m_currentIndex = target;
      }
    }
    else if (action === "nextFile")
    {
      const current = state.hunks[this.m_currentIndex];
      const target = current === undefined
        ? -1
        : state.hunks
          .map((hunk, index) => ({ hunk, index }))
          .find((entry) => entry.index > this.m_currentIndex && entry.hunk.file !== current.file)?.index ?? -1;
      if (target >= 0)
      {
        this.m_currentIndex = target;
      }
    }

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

  private async MutateCurrentHunk(
    action: "stage" | "revert",
    options: { commandId?: string; hunkId?: string; patchHash?: string },
  ): Promise<AgentReviewCommandResult>
  {
    let hunk: AgentReviewHunk;
    try
    {
      hunk = this.ValidateTargetHunk(action, options.hunkId, options.patchHash);
    }
    catch (error)
    {
      return {
        ok: false,
        action,
        commandId: options.commandId,
        error: error instanceof Error ? error.message : String(error),
        stale: error instanceof StorageError && error.code === "stale_hunk",
      };
    }

    const result = await ApplyAgentReviewPatch(
      hunk.repoRoot,
      action === "stage" ? "stage" : "revert",
      hunk.patch,
    );

    if (!result.ok)
    {
      return {
        ok: false,
        action,
        commandId: options.commandId,
        error: result.error,
      };
    }

    this.m_undoStack.push({ action, hunk });
    return {
      ok: true,
      action,
      commandId: options.commandId,
      reviewFacts: action === "revert" ? { revertedHunk: hunk } : undefined,
    };
  }

  private async Undo(commandId?: string): Promise<AgentReviewCommandResult>
  {
    const entry = this.m_undoStack.pop();
    if (entry === undefined)
    {
      return { ok: false, action: "undo", commandId, error: "no undoable hunk mutation" };
    }

    const result = await ApplyAgentReviewPatch(
      entry.hunk.repoRoot,
      entry.action === "stage" ? "unstage" : "restore",
      entry.hunk.patch,
    );

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

    return {
      ok: true,
      action: "undo",
      commandId,
      reviewFacts: entry.action === "revert"
        ? { restoredRevertedHunk: entry.hunk }
        : undefined,
    };
  }

  private async PublishDictatorState(): Promise<void>
  {
    const endpoint = await this.ResolveEndpoint();
    if (endpoint === null)
    {
      this.m_bridgeConnected = false;
      this.m_bridgeLastError = null;
      return;
    }

    const state = this.RequireState();
    const current = state.currentHunk;
    const body = {
      providerId: this.m_providerId,
      focused: this.m_sockets.size > 0 && current !== null,
      paneOpen: this.m_sockets.size > 0 && state.available,
      repoRoot: state.repoRoot,
      file: current?.file ?? null,
      fileIndex: current?.fileIndex ?? 0,
      fileCount: state.files.length,
      hunkIndex: current?.hunkIndex ?? 0,
      hunkCount: state.hunks.length,
      currentHunk: current === null
        ? null
        : {
          id: current.hunkId,
          file: current.file,
          index: current.hunkIndex,
          count: current.hunkCount,
          header: current.header,
          patchHash: current.patchHash,
        },
      currentHunkReview: current,
      actions: state.actions,
    };

    try
    {
      const response = await fetch(`${endpoint.url}/api/hunk-review/state`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      this.m_bridgeConnected = response.ok;
      this.m_bridgeLastError = response.ok ? null : `Dictator state rejected: ${response.status}`;
    }
    catch (error)
    {
      this.m_bridgeConnected = false;
      this.m_bridgeLastError = error instanceof Error ? error.message : String(error);
    }
  }

  private async DisconnectDictator(): Promise<void>
  {
    const endpoint = await this.ResolveEndpoint();
    if (endpoint === null)
    {
      return;
    }

    try
    {
      await fetch(`${endpoint.url}/api/hunk-review/disconnect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: this.m_providerId }),
      });
    }
    catch
    {
    }
  }

  private async PublishCommandResult(result: AgentReviewCommandResult): Promise<void>
  {
    const endpoint = await this.ResolveEndpoint();
    if (endpoint === null || result.commandId === undefined)
    {
      return;
    }

    try
    {
      await fetch(`${endpoint.url}/api/hunk-review/command-result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commandId: result.commandId,
          providerId: this.m_providerId,
          result: {
            ok: result.ok,
            action: DictatorActionPayload(result.action),
            error: result.error ?? null,
            reviewFacts: result.reviewFacts ?? null,
          },
        }),
      });
    }
    catch
    {
    }
  }

  private EnsurePollTimer(): void
  {
    if (this.m_pollTimer !== null)
    {
      return;
    }

    this.m_pollTimer = setInterval(() =>
    {
      void this.PollDictatorCommand();
    }, 250);
  }

  private ClearPollTimer(): void
  {
    if (this.m_pollTimer !== null)
    {
      clearInterval(this.m_pollTimer);
      this.m_pollTimer = null;
    }
  }

  private async PollDictatorCommand(): Promise<void>
  {
    if (this.m_sockets.size === 0)
    {
      this.ClearPollTimer();
      return;
    }

    const endpoint = await this.ResolveEndpoint();
    if (endpoint === null)
    {
      return;
    }

    try
    {
      const response = await fetch(
        `${endpoint.url}/api/hunk-review/command?provider_id=${encodeURIComponent(this.m_providerId)}`,
      );
      if (!response.ok)
      {
        return;
      }
      const command = await response.json() as { id?: unknown; action?: unknown } | null;
      if (
        command === null ||
        typeof command.id !== "string" ||
        typeof command.action !== "string"
      )
      {
        return;
      }

      await this.ExecuteCommand(command.action as AgentReviewAction, {
        commandId: command.id,
      });
    }
    catch
    {
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

  async Availability(pile: string, sessionId: string): Promise<AgentReviewState>
  {
    const sessionRoot = await this.m_agentManager.resolveSessionRootDirectory(pile, sessionId);
    const gitState = await LoadAgentReviewGitState(sessionRoot);
    const currentIndex = NormalizeCurrentIndex(gitState.hunks, 0);

    return {
      ...gitState.availability,
      currentIndex,
      currentHunk: currentIndex >= 0 ? gitState.hunks[currentIndex]! : null,
      hunks: gitState.hunks,
      files: gitState.files,
      actions: ActionsFor(gitState.hunks, currentIndex, false),
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

  async Attach(socket: WebSocket, params: ChatWebSocketConnectParams): Promise<void>
  {
    const key = {
      pile: params.pile,
      sessionId: params.sessionId,
    };
    const session = this.GetOrCreateSession(key);
    await session.Attach(socket);
  }

  ReleaseIdle(): void
  {
    for (const [key, session] of this.m_sessions.entries())
    {
      if (session.ClientCount === 0)
      {
        session.Dispose();
        this.m_sessions.delete(key);
      }
    }
  }

  Dispose(): void
  {
    for (const session of this.m_sessions.values())
    {
      session.Dispose();
    }
    this.m_sessions.clear();
  }

  private GetOrCreateSession(key: SessionKey): AgentReviewSession
  {
    const encoded = FormatSessionKey(key);
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
): Promise<ChatWebSocketConnectParams | null>
{
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (!MatchAgentReviewWebSocketPath(url.pathname))
  {
    return null;
  }

  const params = ParseChatWebSocketQuery(url);
  await agentReviewService.Availability(params.pile, params.sessionId);
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
