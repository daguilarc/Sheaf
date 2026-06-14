import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import type { WebSocket } from "ws";
import { WebSocket as WebSocketStatic } from "ws";

import type { AgentManager } from "../agents/manager.js";
import {
  IsPathWithinRoot,
  ToRootRelativePathFromCanonical,
} from "../extensions/sheaf-chat/pathPolicy.js";
import type { FileChangedNotification } from "../extensions/sheaf-chat/types.js";
import {
  FormatChatKey,
  KeyChatId,
  KeyRepoId,
  KeyWorkspaceId,
  type ChatKey,
} from "../agents/lifecycle.js";
import {
  eventsToSnapshots,
  mapUserMessageToAgui,
} from "../agui/index.js";
import type { AguiEvent } from "../agui/types.js";
import {
  IsStreamProfilerEnabled,
  ProfileStreamPoint,
} from "../server/streamProfiler.js";
import type { ChatEnvelope } from "../shared/envelope.js";
import type { HistoryPageRequest } from "../shared/types.js";
import { ReadHistoryPage } from "../storage/history.js";
import type { StoragePaths } from "../storage/paths.js";
import { CollectSessionLogEntries } from "../storage/sessionLog.js";

import {
  CreateChatEnvelope,
  x_aguiEventKind,
  x_chatUserMessageKind,
  x_fileChangedKind,
  x_historyPageKind,
} from "./envelopes.js";
import type { ClientHistoryRequestPayload, ClientUserMessagePayload } from "./clientFrames.js";
import type { HistoryWindow, SessionPersistenceHub } from "./sessionPersistenceHub.js";

export interface ConnectedClient
{
  connectionId: string;
  clientId?: string;
  socket: WebSocket;
  lastAckSequence?: number;
  // While "catching_up", live broadcasts are buffered rather than sent, so that a
  // connection can subscribe before it replays history without losing or
  // reordering envelopes that arrive during the replay. On ActivateClient the
  // buffer is flushed (deduped by sequence) and the client goes "live".
  state: "catching_up" | "live";
  liveBuffer: ChatEnvelope[];
  lastDeliveredSequence: number;
}

export interface SessionBroadcasterOptions
{
  key: ChatKey;
  storagePaths: StoragePaths;
  agentManager: AgentManager;
  persistenceHub: SessionPersistenceHub;
  canonicalRootDirectory?: string;
}

export interface FileChangedBroadcastPayload
{
  eventType: "fileChanged";
  path: string;
  fileId: string;
  changedAt: string;
  source: "edit_tool";
}

function SendEnvelope(socket: WebSocket, envelope: ChatEnvelope): void
{
  if (socket.readyState === WebSocketStatic.OPEN)
  {
    const startedAt = performance.now();
    socket.send(JSON.stringify(envelope));

    if (IsStreamProfilerEnabled())
    {
      ProfileStreamPoint("websocket_send_called", {
        kind: envelope.kind,
        sequence: envelope.sequence,
        bufferedAmount: socket.bufferedAmount,
        sendCallMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      });
    }
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
  private readonly m_key: ChatKey;
  private readonly m_storagePaths: StoragePaths;
  private readonly m_persistenceHub: SessionPersistenceHub;
  private readonly m_clients = new Map<string, ConnectedClient>();
  private readonly m_unsubscribePersistedEnvelope: () => void;
  private m_canonicalRootDirectory?: string;

  constructor(options: SessionBroadcasterOptions)
  {
    this.m_key = options.key;
    this.m_storagePaths = options.storagePaths;
    this.m_persistenceHub = options.persistenceHub;
    this.m_canonicalRootDirectory = options.canonicalRootDirectory;
    this.m_unsubscribePersistedEnvelope = this.m_persistenceHub.Subscribe((envelope) =>
    {
      this.Broadcast(envelope);
    });
  }

  get Key(): ChatKey
  {
    return this.m_key;
  }

  get ClientCount(): number
  {
    return this.m_clients.size;
  }

  get CanonicalRootDirectory(): string | undefined
  {
    return this.m_canonicalRootDirectory;
  }

  SetCanonicalRootDirectory(canonicalRootDirectory: string): void
  {
    this.m_canonicalRootDirectory = canonicalRootDirectory;
  }

  get LatestSequence(): number
  {
    return this.m_persistenceHub.LatestSequence;
  }

  async HistoryWindow(): Promise<HistoryWindow>
  {
    return this.m_persistenceHub.HistoryWindow();
  }

  RegisterClient(socket: WebSocket, clientId?: string): ConnectedClient
  {
    const connectionId = randomUUID();
    const client: ConnectedClient = {
      connectionId,
      socket,
      clientId,
      state: "catching_up",
      liveBuffer: [],
      lastDeliveredSequence: 0,
    };

    // Subscribe immediately so no broadcast is missed while the connection
    // replays history; broadcasts are buffered until ActivateClient.
    this.m_clients.set(connectionId, client);
    return client;
  }

  // Flush any envelopes that arrived during catch-up (deduped against what the
  // replay already delivered) and switch the client to live delivery.
  ActivateClient(client: ConnectedClient): void
  {
    const buffered = client.liveBuffer;
    client.liveBuffer = [];
    client.state = "live";

    for (const envelope of buffered)
    {
      this.DeliverTracked(client, envelope);
    }
  }

  RemoveClient(connectionId: string): void
  {
    this.m_clients.delete(connectionId);
  }

  // Send an envelope to a client, deduped by sequence so an envelope delivered by
  // both the history replay and the live stream reaches the client exactly once.
  private DeliverTracked(client: ConnectedClient, envelope: ChatEnvelope): void
  {
    if (
      envelope.sequence !== undefined &&
      envelope.sequence <= client.lastDeliveredSequence
    )
    {
      return;
    }

    SendEnvelope(client.socket, envelope);

    if (envelope.sequence !== undefined)
    {
      client.lastDeliveredSequence = Math.max(client.lastDeliveredSequence, envelope.sequence);
    }
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
      if (client.state === "catching_up")
      {
        client.liveBuffer.push(envelope);
        continue;
      }

      this.DeliverTracked(client, envelope);
    }
  }

  BroadcastFileChanged(changedCanonicalPath: string, changedAt: string): void
  {
    const canonicalRootDirectory = this.m_canonicalRootDirectory;

    if (canonicalRootDirectory === undefined)
    {
      return;
    }

    if (!IsPathWithinRoot(changedCanonicalPath, canonicalRootDirectory))
    {
      return;
    }

    const rootRelativePath = ToRootRelativePathFromCanonical(
      canonicalRootDirectory,
      changedCanonicalPath,
    );
    const payload: FileChangedBroadcastPayload = {
      eventType: "fileChanged",
      path: rootRelativePath,
      fileId: rootRelativePath,
      changedAt,
      source: "edit_tool",
    };
    const envelope = CreateChatEnvelope({
      kind: x_fileChangedKind,
      repoId: KeyRepoId(this.m_key),
      workspaceId: KeyWorkspaceId(this.m_key),
      chatId: KeyChatId(this.m_key),
      payload,
    });

    this.Broadcast(envelope);
  }

  async ReplayAfter(
    client: ConnectedClient,
    after: number,
    throughSequence = Number.MAX_SAFE_INTEGER,
  ): Promise<void>
  {
    const entries = await CollectSessionLogEntries(
      this.m_storagePaths,
      KeyRepoId(this.m_key),
      KeyWorkspaceId(this.m_key),
      KeyChatId(this.m_key),
    );

    for (const entry of entries)
    {
      if (entry.sequence > after && entry.sequence <= throughSequence)
      {
        this.DeliverTracked(client, entry.envelope);
      }
    }
  }

  async HandleUserMessage(
    connectionId: string,
    payload: ClientUserMessagePayload,
  ): Promise<void>
  {
    await this.m_persistenceHub.HandleUserMessage(payload);
  }

  async HandleHistoryRequest(
    connectionId: string,
    requestId: string,
    request: ClientHistoryRequestPayload,
  ): Promise<void>
  {
    const pagePromise = ReadHistoryPage(
      this.m_storagePaths,
      KeyRepoId(this.m_key),
      KeyWorkspaceId(this.m_key),
      KeyChatId(this.m_key),
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
      repoId: KeyRepoId(this.m_key),
      workspaceId: KeyWorkspaceId(this.m_key),
      chatId: KeyChatId(this.m_key),
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
    this.m_unsubscribePersistedEnvelope();
    this.m_clients.clear();
  }
}

export class SessionBroadcasterRegistry
{
  private readonly m_broadcasters = new Map<string, SessionBroadcaster>();

  async GetOrCreate(options: SessionBroadcasterOptions): Promise<SessionBroadcaster>
  {
    const encodedKey = FormatChatKey(options.key);
    let broadcaster = this.m_broadcasters.get(encodedKey);

    if (broadcaster === undefined)
    {
      broadcaster = new SessionBroadcaster(options);
      this.m_broadcasters.set(encodedKey, broadcaster);
    }
    else if (options.canonicalRootDirectory !== undefined)
    {
      broadcaster.SetCanonicalRootDirectory(options.canonicalRootDirectory);
    }

    return broadcaster;
  }

  async BroadcastFileChanged(event: FileChangedNotification): Promise<void>
  {
    let changedCanonicalPath = path.resolve(event.absolutePath);

    try
    {
      changedCanonicalPath = await realpath(changedCanonicalPath);
    }
    catch
    {
    }

    const changedAt = new Date().toISOString();

    for (const broadcaster of this.m_broadcasters.values())
    {
      broadcaster.BroadcastFileChanged(changedCanonicalPath, changedAt);
    }
  }

  Get(key: ChatKey): SessionBroadcaster | undefined
  {
    return this.m_broadcasters.get(FormatChatKey(key));
  }

  Remove(key: ChatKey): void
  {
    const encodedKey = FormatChatKey(key);
    const broadcaster = this.m_broadcasters.get(encodedKey);

    if (broadcaster !== undefined)
    {
      broadcaster.Dispose();
      this.m_broadcasters.delete(encodedKey);
    }
  }

  ReleaseIfIdle(key: ChatKey): void
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
