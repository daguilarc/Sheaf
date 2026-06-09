import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import type { WebSocket } from "ws";
import { WebSocket as WebSocketStatic } from "ws";

import type { AgentManager } from "../agents/manager.js";
import {
  FormatSessionKey,
  type SessionKey,
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
}

export interface SessionBroadcasterOptions
{
  key: SessionKey;
  storagePaths: StoragePaths;
  agentManager: AgentManager;
  persistenceHub: SessionPersistenceHub;
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
  private readonly m_key: SessionKey;
  private readonly m_storagePaths: StoragePaths;
  private readonly m_persistenceHub: SessionPersistenceHub;
  private readonly m_clients = new Map<string, ConnectedClient>();
  private readonly m_unsubscribePersistedEnvelope: () => void;

  constructor(options: SessionBroadcasterOptions)
  {
    this.m_key = options.key;
    this.m_storagePaths = options.storagePaths;
    this.m_persistenceHub = options.persistenceHub;
    this.m_unsubscribePersistedEnvelope = this.m_persistenceHub.Subscribe((envelope) =>
    {
      this.Broadcast(envelope);
    });
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
    return this.m_persistenceHub.LatestSequence;
  }

  async HistoryWindow(): Promise<HistoryWindow>
  {
    return this.m_persistenceHub.HistoryWindow();
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
    this.m_unsubscribePersistedEnvelope();
    this.m_clients.clear();
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
