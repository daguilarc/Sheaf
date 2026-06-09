import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { SheafChatConfig } from "../server/config.js";
import {
  ProfileEventLoopDelay,
  ProfilePiEvent,
} from "../server/streamProfiler.js";
import {
  AgentLifecycleState,
  type ModelReference,
  type ProvisionalSession,
  type SessionManifest,
} from "../shared/types.js";
import {
  ManifestExists,
  ReadManifest,
  UpdateManifest,
  WriteInitialManifest,
  x_defaultExtensionVersion,
} from "../storage/index.js";
import type { StoragePaths } from "../storage/paths.js";
import {
  ResolvePileDirectory,
  ResolveProvisionalFilePath,
  ResolveSessionFilePath,
} from "../storage/paths.js";
import { access, readFile } from "node:fs/promises";

import type {
  LifecycleEmitter,
  LifecycleErrorEvent,
  SessionKey,
  UserMessageSubmission,
} from "./lifecycle.js";
import type { PiSessionHandle } from "./piAdapter.js";
import { BuildDeterministicSummary, type SessionSummary, type SessionSummaryGenerator } from "./summarizer.js";

export interface SessionRuntimeContext
{
  config: SheafChatConfig;
  storagePaths: StoragePaths;
  lifecycle: LifecycleEmitter;
  summarizer: SessionSummaryGenerator;
  idleOffloadSeconds: number;
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
}

export interface SessionRuntimeRecord
{
  key: SessionKey;
  state: AgentLifecycleState;
  rootDirectory: string;
  model: ModelReference;
  sessionFilePath: string;
  clients: Map<string, number>;
  piSession?: PiSessionHandle;
  manifest?: SessionManifest;
  provisional?: ProvisionalSession;
  manifestWritten: boolean;
  firstUserMessageSent: boolean;
  firstAssistantCompleted: boolean;
  summaryPromise?: Promise<SessionSummary>;
  summaryResult?: SessionSummary;
  activeRunCount: number;
  activeToolCount: number;
  acceptedMessageIds: Set<string>;
  firstUserMessageText?: string;
  startupPromise?: Promise<void>;
  idleTimer?: ReturnType<typeof setTimeout>;
  unsubscribePi?: () => void;
  lastError?: string;
}

export class SessionRuntime
{
  private readonly m_context: SessionRuntimeContext;
  private readonly m_record: SessionRuntimeRecord;

  constructor(context: SessionRuntimeContext, record: SessionRuntimeRecord)
  {
    this.m_context = context;
    this.m_record = record;
  }

  get Record(): SessionRuntimeRecord
  {
    return this.m_record;
  }

  get Key(): SessionKey
  {
    return this.m_record.key;
  }

  get ConnectedClientCount(): number
  {
    let count = 0;

    for (const references of this.m_record.clients.values())
    {
      count += references;
    }

    return count;
  }

  TransitionState(nextState: AgentLifecycleState): void
  {
    const previousState = this.m_record.state;

    if (previousState === nextState)
    {
      return;
    }

    this.m_record.state = nextState;
    this.m_context.lifecycle.EmitStatus({
      key: this.m_record.key,
      state: nextState,
      previousState,
    });
  }

  ReportError(error: Omit<LifecycleErrorEvent, "key">): void
  {
    this.m_record.lastError = error.message;
    this.m_context.lifecycle.EmitError({
      key: this.m_record.key,
      ...error,
    });
  }

  AttachClient(clientId?: string): void
  {
    if (clientId !== undefined && clientId.length > 0)
    {
      this.m_record.clients.set(clientId, (this.m_record.clients.get(clientId) ?? 0) + 1);
    }

    this.ClearIdleTimer();

    if (
      this.m_record.state === AgentLifecycleState.Idle ||
      this.m_record.state === AgentLifecycleState.Active
    )
    {
      this.TransitionState(AgentLifecycleState.Active);
    }
  }

  DetachClient(clientId?: string): void
  {
    if (clientId !== undefined && clientId.length > 0)
    {
      const references = this.m_record.clients.get(clientId) ?? 0;

      if (references <= 1)
      {
        this.m_record.clients.delete(clientId);
      }
      else
      {
        this.m_record.clients.set(clientId, references - 1);
      }
    }

    if (this.ConnectedClientCount === 0)
    {
      this.ScheduleIdleOffload();
    }
  }

  BindPiSession(piSession: PiSessionHandle): void
  {
    this.m_record.piSession = piSession;
    this.m_record.unsubscribePi?.();
    this.m_record.unsubscribePi = piSession.subscribe((event) =>
    {
      this.HandlePiEvent(event);
    });
  }

  async AcceptUserMessage(message: UserMessageSubmission): Promise<void>
  {
    if (this.m_record.acceptedMessageIds.has(message.messageId))
    {
      return;
    }

    this.m_record.acceptedMessageIds.add(message.messageId);

    this.m_context.lifecycle.EmitUserMessageAccepted({
      key: this.m_record.key,
      message,
    });

    if (!this.m_record.firstUserMessageSent)
    {
      this.m_record.firstUserMessageSent = true;
      this.m_record.firstUserMessageText = message.text;
      this.m_record.summaryPromise = this.m_context.summarizer(message.text);
    }

    const piSession = this.m_record.piSession;

    if (piSession === undefined)
    {
      throw new Error("pi session is not attached");
    }

    try
    {
      if (piSession.isStreaming)
      {
        if (message.steer === true)
        {
          await piSession.steer(message.text);
        }
        else
        {
          await piSession.prompt(message.text, { streamingBehavior: "followUp" });
        }
      }
      else
      {
        await piSession.prompt(message.text);
      }
    }
    catch (error)
    {
      const messageText = error instanceof Error ? error.message : String(error);
      this.ReportError({
        code: "user_message_delivery_failed",
        message: messageText,
        fatal: false,
      });
    }
  }

  async SelectModel(model: ModelReference, applyTo: "next_turn" | "current_turn"): Promise<void>
  {
    const piSession = this.m_record.piSession;

    if (piSession === undefined)
    {
      throw new Error("pi session is not attached");
    }

    await piSession.setModel(model);
    this.m_record.model = model;
    this.m_context.lifecycle.EmitModel({
      key: this.m_record.key,
      model,
      applyTo,
    });

    if (this.m_record.manifestWritten)
    {
      const manifest = await UpdateManifest(
        this.m_context.storagePaths,
        this.m_record.key.pile,
        this.m_record.key.sessionId,
        { model },
      );
      this.m_record.manifest = manifest;
      this.m_context.lifecycle.EmitManifestUpdated({
        key: this.m_record.key,
        manifest,
      });
    }
  }

  async CancelTurn(): Promise<void>
  {
    const piSession = this.m_record.piSession;

    if (piSession === undefined)
    {
      return;
    }

    await piSession.abort();
    this.ReportError({
      code: "cancelled",
      message: "Turn cancelled",
      fatal: false,
    });
  }

  CanOffload(): boolean
  {
    return (
      this.ConnectedClientCount === 0 &&
      this.m_record.activeRunCount === 0 &&
      this.m_record.activeToolCount === 0 &&
      this.m_record.piSession !== undefined &&
      (this.m_record.state === AgentLifecycleState.Idle ||
        this.m_record.state === AgentLifecycleState.Active)
    );
  }

  async Offload(): Promise<void>
  {
    if (!this.CanOffload())
    {
      return;
    }

    this.ClearIdleTimer();
    this.TransitionState(AgentLifecycleState.Stopping);

    const piSession = this.m_record.piSession;

    if (piSession !== undefined)
    {
      this.m_record.unsubscribePi?.();
      this.m_record.unsubscribePi = undefined;
      piSession.dispose();
      this.m_record.piSession = undefined;
    }

    this.TransitionState(AgentLifecycleState.Cold);
  }

  Dispose(): void
  {
    this.ClearIdleTimer();
    this.m_record.unsubscribePi?.();
    this.m_record.unsubscribePi = undefined;
    this.m_record.piSession?.dispose();
    this.m_record.piSession = undefined;
  }

  private ScheduleIdleOffload(): void
  {
    if (this.ConnectedClientCount > 0)
    {
      return;
    }

    if (
      this.m_record.state !== AgentLifecycleState.Active &&
      this.m_record.state !== AgentLifecycleState.Idle
    )
    {
      return;
    }

    this.TransitionState(AgentLifecycleState.Idle);
    this.ClearIdleTimer();

    this.m_record.idleTimer = this.m_context.setTimeoutFn(() =>
    {
      void this.Offload();
    }, this.m_context.idleOffloadSeconds * 1000);
  }

  private ClearIdleTimer(): void
  {
    if (this.m_record.idleTimer !== undefined)
    {
      this.m_context.clearTimeoutFn(this.m_record.idleTimer);
      this.m_record.idleTimer = undefined;
    }
  }

  private HandlePiEvent(event: AgentSessionEvent): void
  {
    ProfilePiEvent("pi_event_received", event);
    this.m_context.lifecycle.EmitAgentEvent({
      key: this.m_record.key,
      event,
    });
    ProfilePiEvent("pi_event_emitted", event);

    if (event.type === "agent_start")
    {
      ProfileEventLoopDelay("agent_start_event_loop_delay");
      this.m_record.activeRunCount += 1;
      this.ClearIdleTimer();
      return;
    }

    if (event.type === "agent_end")
    {
      ProfileEventLoopDelay("agent_end_event_loop_delay");
      this.m_record.activeRunCount = Math.max(0, this.m_record.activeRunCount - 1);

      if (this.ConnectedClientCount === 0)
      {
        this.ScheduleIdleOffload();
      }

      return;
    }

    if (event.type === "tool_execution_start")
    {
      this.m_record.activeToolCount += 1;
      this.ClearIdleTimer();
      return;
    }

    if (event.type === "tool_execution_end")
    {
      this.m_record.activeToolCount = Math.max(0, this.m_record.activeToolCount - 1);

      if (
        this.ConnectedClientCount === 0 &&
        this.m_record.activeRunCount === 0 &&
        this.m_record.activeToolCount === 0
      )
      {
        this.ScheduleIdleOffload();
      }

      return;
    }

    if (event.type === "message_end" && event.message.role === "assistant")
    {
      void this.HandleAssistantMessageCompleted();
    }
  }

  private async HandleAssistantMessageCompleted(): Promise<void>
  {
    if (this.m_record.manifestWritten || this.m_record.firstAssistantCompleted)
    {
      return;
    }

    this.m_record.firstAssistantCompleted = true;

    try
    {
      let summary = this.m_record.summaryResult;

      if (summary === undefined && this.m_record.summaryPromise !== undefined)
      {
        try
        {
          summary = await this.m_record.summaryPromise;
        }
        catch
        {
          summary = undefined;
        }
      }

      if (summary === undefined)
      {
        summary = BuildDeterministicSummary(this.m_record.firstUserMessageText ?? "New chat");
      }

      this.m_record.summaryResult = summary;

      const manifest = await WriteInitialManifest(this.m_context.storagePaths, {
        pile: this.m_record.key.pile,
        sessionId: this.m_record.key.sessionId,
        chatName: summary.chatName,
        description: summary.description,
        rootDirectory: this.m_record.rootDirectory,
        model: this.m_record.model,
        extensionVersion: x_defaultExtensionVersion,
      });

      this.m_record.manifest = manifest;
      this.m_record.manifestWritten = true;
      this.m_context.lifecycle.EmitManifestUpdated({
        key: this.m_record.key,
        manifest,
      });
    }
    catch (error)
    {
      const message = error instanceof Error ? error.message : String(error);
      this.ReportError({
        code: "manifest_write_failed",
        message,
        fatal: false,
      });
    }
  }
}

export async function LoadProvisionalSession(
  storagePaths: StoragePaths,
  pile: string,
  sessionId: string,
): Promise<ProvisionalSession>
{
  const provisionalPath = ResolveProvisionalFilePath(storagePaths, pile, sessionId);
  const raw = await readFile(provisionalPath, "utf8");
  const parsed = JSON.parse(raw) as {
    rootDirectory: string;
    model: ModelReference;
  };

  return {
    rootDirectory: parsed.rootDirectory,
    model: parsed.model,
  };
}

export async function ResolveSessionBootstrap(
  storagePaths: StoragePaths,
  pile: string,
  sessionId: string,
): Promise<{
  rootDirectory: string;
  model: ModelReference;
  sessionFilePath: string;
  manifest?: SessionManifest;
  provisional?: ProvisionalSession;
}>
{
  const sessionFilePath = ResolveSessionFilePath(storagePaths, pile, sessionId);

  try
  {
    await access(sessionFilePath);
  }
  catch
  {
    throw new Error(`session file not found for ${sessionId}`);
  }

  const hasManifest = await ManifestExists(storagePaths, pile, sessionId);

  if (hasManifest)
  {
    const manifest = await ReadManifest(storagePaths, pile, sessionId);

    return {
      rootDirectory: manifest.rootDirectory,
      model: manifest.model,
      sessionFilePath,
      manifest,
    };
  }

  const provisional = await LoadProvisionalSession(storagePaths, pile, sessionId);

  return {
    rootDirectory: provisional.rootDirectory,
    model: provisional.model,
    sessionFilePath,
    provisional,
  };
}

export function CreateRuntimeRecordFromColdResume(
  key: SessionKey,
  bootstrap: Awaited<ReturnType<typeof ResolveSessionBootstrap>>,
): SessionRuntimeRecord
{
  return {
    key,
    state: AgentLifecycleState.Cold,
    rootDirectory: bootstrap.rootDirectory,
    model: bootstrap.model,
    sessionFilePath: bootstrap.sessionFilePath,
    clients: new Map<string, number>(),
    manifest: bootstrap.manifest,
    provisional: bootstrap.provisional,
    manifestWritten: bootstrap.manifest !== undefined,
    firstUserMessageSent: bootstrap.manifest !== undefined,
    firstAssistantCompleted: bootstrap.manifest !== undefined,
    activeRunCount: 0,
    activeToolCount: 0,
    acceptedMessageIds: new Set<string>(),
  };
}

export function ResolvePileDirectoryPath(storagePaths: StoragePaths, pile: string): string
{
  return ResolvePileDirectory(storagePaths, pile);
}
