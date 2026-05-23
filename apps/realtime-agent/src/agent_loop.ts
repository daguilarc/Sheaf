import { classifyIncomingEvent, EventRouter } from "./event_router.js";
import type { RealtimeAgentDb } from "./persistence/db.js";
import { EventsRepo } from "./persistence/events_repo.js";
import { SessionsRepo } from "./persistence/sessions_repo.js";
import { RealtimeClient } from "./realtime_client.js";
import { buildSessionUpdateEvent } from "./session_config.js";
import {
  DuplicateToolNameError,
  ExtractedToolCall,
  ToolDispatcher,
  ToolRegistry,
} from "./tooling.js";
import {
  DEFAULT_REALTIME_MODEL,
  type AgentSessionDeps,
  type AgentStartConfig,
  type ConversationEventCallback,
  type ConversationEventInfo,
  type RealtimeAgentSession,
  type RealtimeEvent,
  type SessionEndedCallback,
  type SessionRow,
} from "./types.js";

export { DuplicateToolNameError } from "./tooling.js";
export type { AgentSessionDeps, RealtimeAgentSession };

const x_connectionLostReason = "connection_lost";
const x_audioBufferAppendType = "input_audio_buffer.append";

interface FunctionCallAccumulatorEntry
{
  name?: string;
  arguments: string;
}

function DefaultConversationEventCallback(
  event: RealtimeEvent,
  info: ConversationEventInfo,
): void
{
  if (event.type === x_audioBufferAppendType)
  {
    return;
  }

  console.log(`[${info.sessionId}] ${info.direction} ${event.type}`);
}

function BuildStartupConversationEvents(
  systemPrompt: string,
  initialContext: string,
): RealtimeEvent[]
{
  return [
    {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [
          {
            type: "input_text",
            text: systemPrompt,
          },
        ],
      },
    },
    {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: initialContext,
          },
        ],
      },
    },
  ];
}

function BuildInitialResponseCreateEvent(): RealtimeEvent
{
  return {
    type: "response.create",
  };
}

function ReadStringField(event: RealtimeEvent, field: string): string | undefined
{
  const value = event[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function ExtractFunctionCallsFromResponseDone(event: RealtimeEvent): ExtractedToolCall[]
{
  if (event.type !== "response.done")
  {
    return [];
  }

  const response = event.response;
  if (typeof response !== "object" || response === null)
  {
    return [];
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output))
  {
    return [];
  }

  const extracted: ExtractedToolCall[] = [];

  for (const item of output)
  {
    if (typeof item !== "object" || item === null)
    {
      continue;
    }

    const record = item as {
      type?: unknown;
      call_id?: unknown;
      name?: unknown;
      arguments?: unknown;
    };

    if (record.type !== "function_call")
    {
      continue;
    }

    const callId = typeof record.call_id === "string" ? record.call_id : undefined;
    const name = typeof record.name === "string" ? record.name : undefined;
    const argumentsJson =
      typeof record.arguments === "string" ? record.arguments : undefined;

    if (callId === undefined || name === undefined || argumentsJson === undefined)
    {
      continue;
    }

    extracted.push({
      callId,
      name,
      argumentsJson,
      metadata: {
        sourceEventType: event.type,
      },
    });
  }

  return extracted;
}

class FunctionCallArgumentAccumulator
{
  private m_entries = new Map<string, FunctionCallAccumulatorEntry>();

  ApplyDelta(event: RealtimeEvent): void
  {
    const callId = ReadStringField(event, "call_id");
    if (callId === undefined)
    {
      return;
    }

    const entry = this.m_entries.get(callId) ?? { arguments: "" };
    const name = ReadStringField(event, "name");
    if (name !== undefined)
    {
      entry.name = name;
    }

    const delta = ReadStringField(event, "delta");
    if (delta !== undefined)
    {
      entry.arguments += delta;
    }

    this.m_entries.set(callId, entry);
  }

  TakeCompletedCall(event: RealtimeEvent): ExtractedToolCall | null
  {
    if (event.type !== "response.function_call_arguments.done")
    {
      return null;
    }

    const callId = ReadStringField(event, "call_id");
    if (callId === undefined)
    {
      return null;
    }

    const name = ReadStringField(event, "name") ?? this.m_entries.get(callId)?.name;
    const argumentsJson =
      ReadStringField(event, "arguments") ?? this.m_entries.get(callId)?.arguments;

    this.m_entries.delete(callId);

    if (name === undefined || argumentsJson === undefined)
    {
      return null;
    }

    return {
      callId,
      name,
      argumentsJson,
      metadata: {
        sourceEventType: event.type,
      },
    };
  }
}

class RealtimeAgentSessionImpl implements RealtimeAgentSession
{
  private m_sessionId: string;
  private m_client: RealtimeClient;
  private m_router: EventRouter;
  private m_dispatcher: ToolDispatcher;
  private m_sessionsRepo: SessionsRepo;
  private m_onSessionEnded?: SessionEndedCallback;
  private m_argumentAccumulator = new FunctionCallArgumentAccumulator();
  private m_dispatchedCallIds = new Set<string>();
  private m_ended = false;
  private m_gracefulStop = false;

  constructor(
    sessionId: string,
    client: RealtimeClient,
    router: EventRouter,
    dispatcher: ToolDispatcher,
    sessionsRepo: SessionsRepo,
    onSessionEnded?: SessionEndedCallback,
  )
  {
    this.m_sessionId = sessionId;
    this.m_client = client;
    this.m_router = router;
    this.m_dispatcher = dispatcher;
    this.m_sessionsRepo = sessionsRepo;
    this.m_onSessionEnded = onSessionEnded;

    this.m_client.onEvent((event) =>
    {
      this.HandleIncomingEvent(event);
    });

    this.m_client.onClose(() =>
    {
      if (this.m_gracefulStop || this.m_ended)
      {
        return;
      }

      void this.FinalizeSession(x_connectionLostReason);
    });
  }

  get sessionId(): string
  {
    return this.m_sessionId;
  }

  sendAudioFrame(pcmBase64OrBuffer: string | Buffer): void
  {
    const audio =
      typeof pcmBase64OrBuffer === "string"
        ? pcmBase64OrBuffer
        : pcmBase64OrBuffer.toString("base64");

    this.SendOutgoing({
      type: "input_audio_buffer.append",
      audio,
    });
  }

  async stop(reason: string): Promise<SessionRow>
  {
    this.m_gracefulStop = true;
    this.m_client.close();
    return this.FinalizeSession(reason);
  }

  private HandleIncomingEvent(event: RealtimeEvent): void
  {
    this.m_router.routeIncomingEvent(event);
    this.HandleToolCallExtraction(event);
  }

  private HandleToolCallExtraction(event: RealtimeEvent): void
  {
    if (event.type === "response.function_call_arguments.delta")
    {
      this.m_argumentAccumulator.ApplyDelta(event);
      return;
    }

    if (event.type === "response.function_call_arguments.done")
    {
      const extracted = this.m_argumentAccumulator.TakeCompletedCall(event);
      if (extracted !== null)
      {
        this.DispatchToolCall(extracted);
      }
      return;
    }

    if (event.type === "response.done")
    {
      for (const extracted of ExtractFunctionCallsFromResponseDone(event))
      {
        this.DispatchToolCall(extracted);
      }
    }
  }

  private DispatchToolCall(extracted: ExtractedToolCall): void
  {
    if (this.m_dispatchedCallIds.has(extracted.callId))
    {
      return;
    }

    this.m_dispatchedCallIds.add(extracted.callId);
    this.m_dispatcher.Enqueue(extracted);
  }

  SendOutgoing(event: RealtimeEvent): void
  {
    this.m_client.send(event);
    this.m_router.routeOutgoingEvent(event);
  }

  private async FinalizeSession(reason: string): Promise<SessionRow>
  {
    if (this.m_ended)
    {
      const existing = this.m_sessionsRepo.getSession(this.m_sessionId);
      if (existing === null)
      {
        throw new Error(`Session not found: ${this.m_sessionId}`);
      }

      return existing;
    }

    this.m_ended = true;
    const endedSession = this.m_sessionsRepo.endSession(this.m_sessionId, reason);
    this.m_onSessionEnded?.({
      sessionId: this.m_sessionId,
      reason,
      session: endedSession,
    });
    return endedSession;
  }
}

export async function startAgentSession(
  config: AgentStartConfig,
  deps: AgentSessionDeps,
): Promise<RealtimeAgentSession>
{
  const registry = ToolRegistry.FromToolCallSet(config.toolCallSet);
  const model = config.model ?? DEFAULT_REALTIME_MODEL;
  const sessionUpdateEvent = buildSessionUpdateEvent(config.toolCallSet);
  const sessionConfig = sessionUpdateEvent.session as Record<string, unknown>;

  if (deps.database === undefined)
  {
    throw new Error("startAgentSession requires deps.database");
  }

  const sessionsRepo = new SessionsRepo(deps.database);
  const eventsRepo = new EventsRepo(deps.database);

  const session = sessionsRepo.createSession({
    systemPrompt: config.systemPrompt,
    initialContext: config.initialContext,
    toolCallSetName: config.toolCallSet.name ?? null,
    toolNames: registry.GetToolNames(),
    model,
    sessionConfig,
  });

  const conversationCallback = BuildConversationCallback(config.onConversationEvent);

  const router = new EventRouter({
    sessionId: session.id,
    eventsRepo,
    onConversationEvent: conversationCallback,
    onEvent: config.onEvent,
  });

  const client = new RealtimeClient({
    apiKey: deps.apiKey,
    model,
    safetyIdentifier: deps.safetyIdentifier,
    baseUrl: deps.baseUrl,
    webSocketFactory: deps.webSocketFactory,
  });

  const dispatcher = new ToolDispatcher({
    sessionId: session.id,
    registry,
    sendContext: {
      sendOutgoingEvent: (event) =>
      {
        client.send(event);
        router.routeOutgoingEvent(event);
      },
    },
    onToolLifecycle: config.onToolLifecycle,
  });

  const agentSession = new RealtimeAgentSessionImpl(
    session.id,
    client,
    router,
    dispatcher,
    sessionsRepo,
    config.onSessionEnded,
  );

  await client.connect();

  const impl = agentSession as RealtimeAgentSessionImpl;
  impl.SendOutgoing(sessionUpdateEvent);

  for (const startupEvent of BuildStartupConversationEvents(
    config.systemPrompt,
    config.initialContext,
  ))
  {
    impl.SendOutgoing(startupEvent);
  }

  impl.SendOutgoing(BuildInitialResponseCreateEvent());

  return agentSession;
}

function BuildConversationCallback(
  userCallback: ConversationEventCallback | undefined,
): ConversationEventCallback
{
  if (userCallback !== undefined)
  {
    return userCallback;
  }

  return (event, info) =>
  {
    const eventClass = classifyIncomingEvent(event);
    if (eventClass === "tool_call")
    {
      return;
    }

    DefaultConversationEventCallback(event, info);
  };
}
