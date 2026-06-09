import { performance } from "node:perf_hooks";

import type { AgentManager } from "../agents/manager.js";
import {
  FormatSessionKey,
  type SessionKey,
  type UserMessageSubmission,
} from "../agents/lifecycle.js";
import {
  CreatePiToAguiMapper,
  mapPiEventToAgui,
  mapSheafActivityToAgui,
  mapUserMessageToAgui,
  type PiToAguiMapper,
} from "../agui/index.js";
import { RelativizeAbsolutePath } from "../agui/sanitizer.js";
import type { AguiEvent, PiMappableEvent } from "../agui/types.js";
import type { SheafChatConfig } from "../server/config.js";
import {
  ProfileAguiEvent,
  ProfileEnvelope,
  ProfilePiEvent,
  ProfileStreamPoint,
} from "../server/streamProfiler.js";
import type { ChatEnvelope } from "../shared/envelope.js";
import type { ModelReference } from "../shared/types.js";
import { AgentLifecycleState } from "../shared/types.js";
import type { StoragePaths } from "../storage/paths.js";
import { AppendEnvelope, CollectSessionLogEntries } from "../storage/sessionLog.js";

import {
  x_aguiEventKind,
  x_agentStatusKind,
  x_chatUserMessageKind,
  x_modelChangedKind,
  x_serverErrorKind,
  x_sessionUpdatedKind,
} from "./envelopes.js";
import type { ClientUserMessagePayload } from "./clientFrames.js";

export interface SessionPersistenceHubOptions
{
  key: SessionKey;
  config: SheafChatConfig;
  storagePaths: StoragePaths;
  agentManager: AgentManager;
}

export interface HistoryWindow
{
  oldestSequence: number | null;
  newestSequence: number | null;
}

type EnvelopeSubscriber = (envelope: ChatEnvelope) => void;

export class SessionPersistenceHub
{
  private readonly m_key: SessionKey;
  private readonly m_config: SheafChatConfig;
  private readonly m_storagePaths: StoragePaths;
  private readonly m_agentManager: AgentManager;
  private readonly m_acceptedMessageIds = new Set<string>();
  private readonly m_mapper: PiToAguiMapper = CreatePiToAguiMapper();
  private readonly m_subscribers = new Set<EnvelopeSubscriber>();
  private m_userMessageChain: Promise<void> = Promise.resolve();
  private m_latestSequence = 0;
  private m_unsubscribeLifecycle: (() => void)[] = [];
  private m_initialized = false;

  constructor(options: SessionPersistenceHubOptions)
  {
    this.m_key = options.key;
    this.m_config = options.config;
    this.m_storagePaths = options.storagePaths;
    this.m_agentManager = options.agentManager;
  }

  get Key(): SessionKey
  {
    return this.m_key;
  }

  get LatestSequence(): number
  {
    return this.m_latestSequence;
  }

  async Initialize(): Promise<void>
  {
    if (this.m_initialized)
    {
      return;
    }

    const entries = await CollectSessionLogEntries(
      this.m_storagePaths,
      this.m_key.pile,
      this.m_key.sessionId,
    );

    if (entries.length > 0)
    {
      this.m_latestSequence = entries[entries.length - 1].sequence;
    }

    for (const entry of entries)
    {
      if (entry.envelope.kind === x_chatUserMessageKind && entry.envelope.payload !== undefined)
      {
        const payload = entry.envelope.payload as { messageId?: string };

        if (typeof payload.messageId === "string")
        {
          this.m_acceptedMessageIds.add(payload.messageId);
        }
      }
    }

    this.SubscribeLifecycle();
    this.m_initialized = true;
  }

  Subscribe(subscriber: EnvelopeSubscriber): () => void
  {
    this.m_subscribers.add(subscriber);

    return () =>
    {
      this.m_subscribers.delete(subscriber);
    };
  }

  async HistoryWindow(): Promise<HistoryWindow>
  {
    const entries = await CollectSessionLogEntries(
      this.m_storagePaths,
      this.m_key.pile,
      this.m_key.sessionId,
    );

    if (entries.length === 0)
    {
      return {
        oldestSequence: null,
        newestSequence: null,
      };
    }

    return {
      oldestSequence: entries[0].sequence,
      newestSequence: entries[entries.length - 1].sequence,
    };
  }

  async HandleUserMessage(payload: ClientUserMessagePayload): Promise<void>
  {
    if (this.m_acceptedMessageIds.has(payload.messageId))
    {
      return;
    }

    this.m_userMessageChain = this.m_userMessageChain
      .then(() => this.ProcessUserMessage(payload))
      .catch(() => undefined);

    await this.m_userMessageChain;
  }

  Dispose(): void
  {
    for (const unsubscribe of this.m_unsubscribeLifecycle)
    {
      unsubscribe();
    }

    this.m_unsubscribeLifecycle = [];
    this.m_subscribers.clear();
  }

  private Publish(envelope: ChatEnvelope): void
  {
    for (const subscriber of this.m_subscribers)
    {
      subscriber(envelope);
    }
  }

  private MapperContext(): {
    threadId: string;
    canonicalRoot?: string;
    rootDirectory?: string;
  }
  {
    const status = this.m_agentManager.getStatus(this.m_key);
    const rootDirectory = status?.rootDirectory ?? status?.provisionalRootDirectory;

    return {
      threadId: this.m_key.sessionId,
      canonicalRoot: rootDirectory,
      rootDirectory,
    };
  }

  private async ProcessUserMessage(
    payload: ClientUserMessagePayload,
  ): Promise<void>
  {
    if (this.m_acceptedMessageIds.has(payload.messageId))
    {
      return;
    }

    this.m_acceptedMessageIds.add(payload.messageId);

    const userPayload = {
      messageId: payload.messageId,
      text: payload.text,
      attachments: payload.attachments ?? [],
      steer: payload.steer ?? true,
    };

    await this.AppendAndPublish({
      kind: x_chatUserMessageKind,
      payload: userPayload,
    });

    const aguiEvents = mapUserMessageToAgui({
      messageId: payload.messageId,
      text: payload.text,
    });

    for (const event of aguiEvents)
    {
      await this.AppendAndPublish({
        kind: x_aguiEventKind,
        payload: event,
      });
    }

    const submission: UserMessageSubmission = {
      messageId: payload.messageId,
      text: payload.text,
      attachments: payload.attachments,
      steer: payload.steer,
    };

    try
    {
      await this.m_agentManager.submitUserMessage(this.m_key, submission);
    }
    catch (error)
    {
      const message = error instanceof Error ? error.message : String(error);
      await this.AppendAndPublish({
        kind: x_serverErrorKind,
        payload: {
          code: "user_message_delivery_failed",
          message,
          fatal: false,
        },
      });
    }
  }

  private async AppendAndPublish(input: {
    kind: string;
    payload?: unknown;
    clientId?: string;
  }): Promise<ChatEnvelope>
  {
    const appendStartedAt = performance.now();
    ProfileStreamPoint("append_start", {
      kind: input.kind,
      ...(typeof input.payload === "object" && input.payload !== null
        ? { aguiType: (input.payload as { type?: unknown }).type }
        : {}),
    });

    const envelope = await AppendEnvelope(
      this.m_storagePaths,
      this.m_key.pile,
      this.m_key.sessionId,
      {
        kind: input.kind,
        pile: this.m_key.pile,
        sessionId: this.m_key.sessionId,
        clientId: input.clientId,
        payload: input.payload,
      },
    );
    const appendMs = performance.now() - appendStartedAt;

    this.m_latestSequence = envelope.sequence ?? this.m_latestSequence;
    ProfileEnvelope("append_end", envelope);
    ProfileStreamPoint("append_duration", {
      kind: envelope.kind,
      sequence: envelope.sequence,
      appendMs: Math.round(appendMs * 1000) / 1000,
    });
    this.Publish(envelope);
    ProfileEnvelope("broadcast_end", envelope);
    return envelope;
  }

  private async SafeAsync(operation: () => Promise<void>): Promise<void>
  {
    try
    {
      await operation();
    }
    catch
    {
      //
    }
  }

  private SubscribeLifecycle(): void
  {
    const encodedKey = FormatSessionKey(this.m_key);
    const lifecycle = this.m_agentManager.lifecycle;

    this.m_unsubscribeLifecycle.push(
      lifecycle.On("agentEvent", (event) =>
      {
        if (FormatSessionKey(event.key) !== encodedKey)
        {
          return;
        }

        void this.SafeAsync(() => this.HandleAgentEvent(event.event));
      }),
      lifecycle.On("model", (event) =>
      {
        if (FormatSessionKey(event.key) !== encodedKey)
        {
          return;
        }

        void this.SafeAsync(() => this.HandleModelChanged(event.model, event.applyTo));
      }),
      lifecycle.On("status", (event) =>
      {
        if (FormatSessionKey(event.key) !== encodedKey)
        {
          return;
        }

        void this.SafeAsync(() => this.HandleStatusChanged(event.state, event.previousState));
      }),
      lifecycle.On("manifestUpdated", (event) =>
      {
        if (FormatSessionKey(event.key) !== encodedKey)
        {
          return;
        }

        void this.SafeAsync(() => this.HandleManifestUpdated(event.manifest));
      }),
      lifecycle.On("error", (event) =>
      {
        if (FormatSessionKey(event.key) !== encodedKey)
        {
          return;
        }

        void this.SafeAsync(() => this.HandleLifecycleError(event.code, event.message, event.fatal));
      }),
    );
  }

  private async HandleAgentEvent(event: PiMappableEvent): Promise<void>
  {
    ProfilePiEvent("persistence_agent_event_start", event);
    const context = this.MapperContext();
    const aguiEvents = mapPiEventToAgui(event, context, this.m_mapper);
    ProfileStreamPoint("persistence_mapped", {
      aguiEventCount: aguiEvents.length,
    });

    for (const aguiEvent of aguiEvents)
    {
      ProfileAguiEvent("persistence_agui_event_start", aguiEvent);
      await this.AppendAndPublish({
        kind: x_aguiEventKind,
        payload: aguiEvent,
      });
      ProfileAguiEvent("persistence_agui_event_done", aguiEvent);
    }
    ProfilePiEvent("persistence_agent_event_done", event);
  }

  private async HandleModelChanged(
    model: ModelReference,
    applyTo: string,
  ): Promise<void>
  {
    await this.AppendAndPublish({
      kind: x_modelChangedKind,
      payload: {
        model,
        applyTo,
      },
    });

    const aguiEvent = mapSheafActivityToAgui(
      {
        kind: "model_changed",
        model,
        applyTo,
      },
      this.MapperContext(),
    );

    await this.AppendAndPublish({
      kind: x_aguiEventKind,
      payload: aguiEvent,
    });
  }

  private async HandleStatusChanged(
    state: AgentLifecycleState,
    previousState?: AgentLifecycleState,
  ): Promise<void>
  {
    await this.AppendAndPublish({
      kind: x_agentStatusKind,
      payload: {
        state,
        previousState,
      },
    });

    const aguiEvent = mapSheafActivityToAgui(
      {
        kind: "lifecycle_status",
        state,
        previousState,
      },
      this.MapperContext(),
    );

    await this.AppendAndPublish({
      kind: x_aguiEventKind,
      payload: aguiEvent,
    });
  }

  private async HandleManifestUpdated(manifest: import("../shared/types.js").SessionManifest): Promise<void>
  {
    const relativeRoot = RelativizeAbsolutePath(manifest.rootDirectory, this.m_config.repoRoot);

    await this.AppendAndPublish({
      kind: x_sessionUpdatedKind,
      payload: {
        manifest: {
          ...manifest,
          rootDirectory: relativeRoot,
        },
      },
    });
  }

  private async HandleLifecycleError(
    code: string,
    message: string,
    fatal?: boolean,
  ): Promise<void>
  {
    await this.AppendAndPublish({
      kind: x_serverErrorKind,
      payload: {
        code,
        message,
        fatal: fatal === true,
      },
    });

    const aguiEvent = mapSheafActivityToAgui(
      {
        kind: "error",
        code,
        message,
        fatal,
      },
      this.MapperContext(),
    );

    await this.AppendAndPublish({
      kind: x_aguiEventKind,
      payload: aguiEvent,
    });
  }
}

export class SessionPersistenceHubRegistry
{
  private readonly m_hubs = new Map<string, SessionPersistenceHub>();
  private readonly m_initializing = new Map<string, Promise<SessionPersistenceHub>>();

  async GetOrCreate(options: SessionPersistenceHubOptions): Promise<SessionPersistenceHub>
  {
    const encodedKey = FormatSessionKey(options.key);
    const existing = this.m_hubs.get(encodedKey);

    if (existing !== undefined)
    {
      const initializing = this.m_initializing.get(encodedKey);

      if (initializing !== undefined)
      {
        await initializing;
      }

      return existing;
    }

    const hub = new SessionPersistenceHub(options);
    this.m_hubs.set(encodedKey, hub);

    const initializing = hub.Initialize()
      .then(() => hub)
      .finally(() =>
      {
        this.m_initializing.delete(encodedKey);
      });
    this.m_initializing.set(encodedKey, initializing);

    return initializing;
  }

  Get(key: SessionKey): SessionPersistenceHub | undefined
  {
    return this.m_hubs.get(FormatSessionKey(key));
  }

  Dispose(): void
  {
    for (const hub of this.m_hubs.values())
    {
      hub.Dispose();
    }

    this.m_hubs.clear();
    this.m_initializing.clear();
  }
}
