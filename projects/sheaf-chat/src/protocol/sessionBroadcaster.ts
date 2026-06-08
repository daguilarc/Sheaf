import { randomUUID } from "node:crypto";

import type { WebSocket } from "ws";
import { WebSocket as WebSocketStatic } from "ws";

import type { AgentManager } from "../agents/manager.js";
import {
  FormatSessionKey,
  type SessionKey,
  type UserMessageSubmission,
} from "../agents/lifecycle.js";
import {
  CreatePiToAguiMapper,
  eventsToSnapshots,
  mapPiEventToAgui,
  mapSheafActivityToAgui,
  mapUserMessageToAgui,
  type PiToAguiMapper,
} from "../agui/index.js";
import type { AguiEvent, PiMappableEvent } from "../agui/types.js";
import { RelativizeAbsolutePath } from "../agui/sanitizer.js";
import type { SheafChatConfig } from "../server/config.js";
import type { ChatEnvelope } from "../shared/envelope.js";
import type { HistoryPageRequest, ModelReference } from "../shared/types.js";
import { AgentLifecycleState } from "../shared/types.js";
import { ReadHistoryPage } from "../storage/history.js";
import type { StoragePaths } from "../storage/paths.js";
import { AppendEnvelope, CollectSessionLogEntries } from "../storage/sessionLog.js";

import {
  CreateChatEnvelope,
  x_aguiEventKind,
  x_agentStatusKind,
  x_chatUserMessageKind,
  x_historyPageKind,
  x_modelChangedKind,
  x_serverErrorKind,
  x_sessionUpdatedKind,
} from "./envelopes.js";
import type { ClientHistoryRequestPayload, ClientUserMessagePayload } from "./clientFrames.js";

export interface ConnectedClient
{
  connectionId: string;
  clientId?: string;
  socket: WebSocket;
  lastAckSequence?: number;
}

export interface SessionBroadcasterOptions
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

function SendEnvelope(socket: WebSocket, envelope: ChatEnvelope): void
{
  if (socket.readyState === WebSocketStatic.OPEN)
  {
    socket.send(JSON.stringify(envelope));
  }
}

function ExtractAguiEvents(envelopes: ChatEnvelope[]): AguiEvent[]
{
  const messageIdsWithStoredAguiEvents = new Set<string>();
  const events: AguiEvent[] = [];

  for (const envelope of envelopes)
  {
    if (envelope.kind !== x_aguiEventKind || envelope.payload === undefined)
    {
      continue;
    }

    if (typeof envelope.payload !== "object" || envelope.payload === null)
    {
      continue;
    }

    const messageId = (envelope.payload as { messageId?: unknown }).messageId;

    if (typeof messageId === "string")
    {
      messageIdsWithStoredAguiEvents.add(messageId);
    }
  }

  for (const envelope of envelopes)
  {
    if (envelope.kind === x_aguiEventKind && envelope.payload !== undefined)
    {
      if (typeof envelope.payload === "object" && envelope.payload !== null)
      {
        events.push(envelope.payload as AguiEvent);
      }

      continue;
    }

    if (envelope.kind === x_chatUserMessageKind && envelope.payload !== undefined)
    {
      const payload = envelope.payload as { messageId?: string; text?: string };

      if (typeof payload.messageId === "string" && typeof payload.text === "string")
      {
        if (messageIdsWithStoredAguiEvents.has(payload.messageId))
        {
          continue;
        }

        events.push(...mapUserMessageToAgui({
          messageId: payload.messageId,
          text: payload.text,
        }));
      }
    }
  }

  return events;
}

export class SessionBroadcaster
{
  private readonly m_key: SessionKey;
  private readonly m_config: SheafChatConfig;
  private readonly m_storagePaths: StoragePaths;
  private readonly m_agentManager: AgentManager;
  private readonly m_clients = new Map<string, ConnectedClient>();
  private readonly m_acceptedMessageIds = new Set<string>();
  private readonly m_mapper: PiToAguiMapper = CreatePiToAguiMapper();
  private m_userMessageChain: Promise<void> = Promise.resolve();
  private m_latestSequence = 0;
  private m_unsubscribeLifecycle: (() => void)[] = [];

  constructor(options: SessionBroadcasterOptions)
  {
    this.m_key = options.key;
    this.m_config = options.config;
    this.m_storagePaths = options.storagePaths;
    this.m_agentManager = options.agentManager;
    this.SubscribeLifecycle();
  }

  get Key(): SessionKey
  {
    return this.m_key;
  }

  get ClientCount(): number
  {
    return this.m_clients.size;
  }

  get LatestSequence(): number
  {
    return this.m_latestSequence;
  }

  async InitializeSequence(): Promise<void>
  {
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

  RegisterClient(socket: WebSocket, clientId?: string): ConnectedClient
  {
    const connectionId = randomUUID();

    return {
      connectionId,
      socket,
      clientId,
    };
  }

  ActivateClient(client: ConnectedClient): void
  {
    this.m_clients.set(client.connectionId, client);
  }

  RemoveClient(connectionId: string): void
  {
    this.m_clients.delete(connectionId);
  }

  SendDirect(connectionId: string, envelope: ChatEnvelope): void
  {
    const client = this.m_clients.get(connectionId);

    if (client === undefined)
    {
      return;
    }

    SendEnvelope(client.socket, envelope);
  }

  Broadcast(envelope: ChatEnvelope): void
  {
    for (const client of this.m_clients.values())
    {
      SendEnvelope(client.socket, envelope);
    }
  }

  async ReplayAfter(
    client: ConnectedClient,
    after: number,
    throughSequence = Number.MAX_SAFE_INTEGER,
  ): Promise<void>
  {
    const entries = await CollectSessionLogEntries(
      this.m_storagePaths,
      this.m_key.pile,
      this.m_key.sessionId,
    );

    for (const entry of entries)
    {
      if (entry.sequence > after && entry.sequence <= throughSequence)
      {
        SendEnvelope(client.socket, entry.envelope);
      }
    }
  }

  async HandleUserMessage(
    connectionId: string,
    payload: ClientUserMessagePayload,
  ): Promise<void>
  {
    if (this.m_acceptedMessageIds.has(payload.messageId))
    {
      return;
    }

    this.m_userMessageChain = this.m_userMessageChain
      .then(() => this.ProcessUserMessage(connectionId, payload))
      .catch(() => undefined);

    await this.m_userMessageChain;
  }

  async HandleHistoryRequest(
    connectionId: string,
    requestId: string,
    request: ClientHistoryRequestPayload,
  ): Promise<void>
  {
    const pagePromise = ReadHistoryPage(
      this.m_storagePaths,
      this.m_key.pile,
      this.m_key.sessionId,
      request as HistoryPageRequest,
    );

    const page = await pagePromise;
    const prefer = request.prefer ?? "snapshots";
    const events = ExtractAguiEvents(page.envelopes);
    const payload: Record<string, unknown> = {
      requestId,
      direction: page.direction,
      oldestSequence: page.oldestSequence,
      newestSequence: page.newestSequence,
      hasMoreBefore: page.hasMoreBefore,
      hasMoreAfter: page.hasMoreAfter,
    };

    if (prefer === "snapshots")
    {
      payload.messages = eventsToSnapshots(events);
      payload.events = [];
    }
    else
    {
      payload.events = events;
      payload.messages = [];
    }

    const envelope = CreateChatEnvelope({
      kind: x_historyPageKind,
      pile: this.m_key.pile,
      sessionId: this.m_key.sessionId,
      payload,
    });

    this.SendDirect(connectionId, envelope);
  }

  RecordAck(connectionId: string, sequence: number): void
  {
    const client = this.m_clients.get(connectionId);

    if (client === undefined)
    {
      return;
    }

    client.lastAckSequence = sequence;
  }

  Dispose(): void
  {
    for (const unsubscribe of this.m_unsubscribeLifecycle)
    {
      unsubscribe();
    }

    this.m_unsubscribeLifecycle = [];
    this.m_clients.clear();
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
    _connectionId: string,
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

    await this.AppendAndBroadcast({
      kind: x_chatUserMessageKind,
      payload: userPayload,
    });

    const aguiEvents = mapUserMessageToAgui({
      messageId: payload.messageId,
      text: payload.text,
    });

    for (const event of aguiEvents)
    {
      await this.AppendAndBroadcast({
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
      await this.AppendAndBroadcast({
        kind: x_serverErrorKind,
        payload: {
          code: "user_message_delivery_failed",
          message,
          fatal: false,
        },
      });
    }
  }

  private async AppendAndBroadcast(input: {
    kind: string;
    payload?: unknown;
    clientId?: string;
  }): Promise<ChatEnvelope>
  {
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

    this.m_latestSequence = envelope.sequence ?? this.m_latestSequence;
    this.Broadcast(envelope);
    return envelope;
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
    const context = this.MapperContext();
    const aguiEvents = mapPiEventToAgui(event, context, this.m_mapper);

    for (const aguiEvent of aguiEvents)
    {
      await this.AppendAndBroadcast({
        kind: x_aguiEventKind,
        payload: aguiEvent,
      });
    }
  }

  private async HandleModelChanged(
    model: ModelReference,
    applyTo: string,
  ): Promise<void>
  {
    await this.AppendAndBroadcast({
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

    await this.AppendAndBroadcast({
      kind: x_aguiEventKind,
      payload: aguiEvent,
    });
  }

  private async HandleStatusChanged(
    state: AgentLifecycleState,
    previousState?: AgentLifecycleState,
  ): Promise<void>
  {
    await this.AppendAndBroadcast({
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

    await this.AppendAndBroadcast({
      kind: x_aguiEventKind,
      payload: aguiEvent,
    });
  }

  private async HandleManifestUpdated(manifest: import("../shared/types.js").SessionManifest): Promise<void>
  {
    const relativeRoot = RelativizeAbsolutePath(manifest.rootDirectory, this.m_config.repoRoot);

    await this.AppendAndBroadcast({
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
    await this.AppendAndBroadcast({
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

    await this.AppendAndBroadcast({
      kind: x_aguiEventKind,
      payload: aguiEvent,
    });
  }
}

export class SessionBroadcasterRegistry
{
  private readonly m_broadcasters = new Map<string, SessionBroadcaster>();

  async GetOrCreate(options: SessionBroadcasterOptions): Promise<SessionBroadcaster>
  {
    const encodedKey = FormatSessionKey(options.key);
    let broadcaster = this.m_broadcasters.get(encodedKey);

    if (broadcaster === undefined)
    {
      broadcaster = new SessionBroadcaster(options);
      await broadcaster.InitializeSequence();
      this.m_broadcasters.set(encodedKey, broadcaster);
    }

    return broadcaster;
  }

  Get(key: SessionKey): SessionBroadcaster | undefined
  {
    return this.m_broadcasters.get(FormatSessionKey(key));
  }

  Remove(key: SessionKey): void
  {
    const encodedKey = FormatSessionKey(key);
    const broadcaster = this.m_broadcasters.get(encodedKey);

    if (broadcaster !== undefined)
    {
      broadcaster.Dispose();
      this.m_broadcasters.delete(encodedKey);
    }
  }

  ReleaseIfIdle(key: SessionKey): void
  {
    const broadcaster = this.Get(key);

    if (broadcaster === undefined || broadcaster.ClientCount > 0)
    {
      return;
    }

    this.Remove(key);
  }

  Dispose(): void
  {
    for (const broadcaster of this.m_broadcasters.values())
    {
      broadcaster.Dispose();
    }

    this.m_broadcasters.clear();
  }
}
