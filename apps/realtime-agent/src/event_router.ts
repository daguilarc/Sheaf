import { EventsRepo } from "./persistence/events_repo.js";
import type {
  ClassifiedIncomingEvent,
  ClassifiedOutgoingEvent,
  ConversationEventInfo,
  EventRouterCallbacks,
  EventRouterOptions,
  EventRow,
  IncomingEventClass,
  OutgoingEventClass,
  RealtimeEvent,
} from "./types.js";

const x_sessionLifecycleTypes = new Set(["session.created", "session.updated"]);

const x_inputAudioTurnTypes = new Set([
  "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped",
  "input_audio_buffer.committed",
]);

const x_transcriptionTypes = new Set([
  "conversation.item.input_audio_transcription.delta",
  "conversation.item.input_audio_transcription.completed",
]);

const x_textOutputTypes = new Set([
  "response.output_text.delta",
  "response.output_text.done",
]);

const x_toolCallTypes = new Set([
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
]);

const x_sessionConfigTypes = new Set(["session.update"]);

const x_responseTriggerTypes = new Set(["response.create"]);

const x_audioBufferAppendType = "input_audio_buffer.append";

function IsFunctionCallOutputEvent(event: RealtimeEvent): boolean
{
  if (event.type !== "conversation.item.create")
  {
    return false;
  }

  const item = event.item;
  if (typeof item !== "object" || item === null)
  {
    return false;
  }

  return (item as { type?: string }).type === "function_call_output";
}

function IsResponseDoneWithFunctionCall(event: RealtimeEvent): boolean
{
  if (event.type !== "response.done")
  {
    return false;
  }

  const response = event.response;
  if (typeof response !== "object" || response === null)
  {
    return false;
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output))
  {
    return false;
  }

  return output.some((item) =>
  {
    if (typeof item !== "object" || item === null)
    {
      return false;
    }

    return (item as { type?: unknown }).type === "function_call";
  });
}

export function classifyIncomingEvent(event: RealtimeEvent): IncomingEventClass
{
  if (x_sessionLifecycleTypes.has(event.type))
  {
    return "session_lifecycle";
  }

  if (x_inputAudioTurnTypes.has(event.type))
  {
    return "input_audio_turn";
  }

  if (x_transcriptionTypes.has(event.type))
  {
    return "transcription";
  }

  if (x_textOutputTypes.has(event.type))
  {
    return "text_output";
  }

  if (x_toolCallTypes.has(event.type) || IsResponseDoneWithFunctionCall(event))
  {
    return "tool_call";
  }

  if (event.type === "error")
  {
    return "error";
  }

  return "unknown";
}

export function classifyOutgoingEvent(event: RealtimeEvent): OutgoingEventClass
{
  if (event.type === x_audioBufferAppendType)
  {
    return "audio_buffer_append";
  }

  if (x_sessionConfigTypes.has(event.type))
  {
    return "session_config";
  }

  if (x_responseTriggerTypes.has(event.type))
  {
    return "response_trigger";
  }

  if (IsFunctionCallOutputEvent(event))
  {
    return "tool_output";
  }

  if (event.type === "conversation.item.create")
  {
    return "conversation_input";
  }

  return "unknown";
}

export class EventRouter
{
  private m_sessionId: string;
  private m_eventsRepo: EventsRepo;
  private m_callbacks: EventRouterCallbacks;

  constructor(options: EventRouterOptions)
  {
    this.m_sessionId = options.sessionId;
    this.m_eventsRepo = options.eventsRepo;
    this.m_callbacks = options;
  }

  routeIncomingEvent(event: RealtimeEvent): EventRow
  {
    const persisted = this.m_eventsRepo.persistIncomingEvent(this.m_sessionId, event);
    const classified = classifyIncomingEvent(event);
    this.EmitIncomingCallbacks(event, classified);
    return persisted;
  }

  routeOutgoingEvent(event: RealtimeEvent): EventRow | null
  {
    const classified = classifyOutgoingEvent(event);
    const persisted = this.m_eventsRepo.persistEvent({
      sessionId: this.m_sessionId,
      direction: "outgoing",
      event,
    });

    this.EmitOutgoingCallbacks(event, classified);
    return persisted;
  }

  classifyIncoming(event: RealtimeEvent): ClassifiedIncomingEvent
  {
    return {
      event,
      eventClass: classifyIncomingEvent(event),
    };
  }

  classifyOutgoing(event: RealtimeEvent): ClassifiedOutgoingEvent
  {
    return {
      event,
      eventClass: classifyOutgoingEvent(event),
    };
  }

  private EmitIncomingCallbacks(event: RealtimeEvent, eventClass: IncomingEventClass): void
  {
    const info = this.BuildEventInfo("incoming");

    this.m_callbacks.onEvent?.(event, info);
    this.m_callbacks.onConversationEvent?.(event, info);

    switch (eventClass)
    {
      case "session_lifecycle":
        this.m_callbacks.onSessionLifecycle?.(event);
        break;
      case "input_audio_turn":
        this.m_callbacks.onInputAudioTurn?.(event);
        break;
      case "transcription":
        this.m_callbacks.onTranscription?.(event);
        break;
      case "text_output":
        this.m_callbacks.onTextOutput?.(event);
        break;
      case "tool_call":
        this.m_callbacks.onToolCall?.(event);
        break;
      case "error":
        this.m_callbacks.onErrorEvent?.(event);
        break;
      case "unknown":
        this.m_callbacks.onUnknownIncoming?.(event);
        break;
    }
  }

  private EmitOutgoingCallbacks(event: RealtimeEvent, eventClass: OutgoingEventClass): void
  {
    const info = this.BuildEventInfo("outgoing");

    this.m_callbacks.onEvent?.(event, info);
    this.m_callbacks.onConversationEvent?.(event, info);

    switch (eventClass)
    {
      case "session_config":
        this.m_callbacks.onSessionConfig?.(event);
        break;
      case "conversation_input":
        this.m_callbacks.onConversationInput?.(event);
        break;
      case "tool_output":
        this.m_callbacks.onToolOutput?.(event);
        break;
      case "response_trigger":
        this.m_callbacks.onResponseTrigger?.(event);
        break;
      case "audio_buffer_append":
        this.m_callbacks.onAudioBufferAppend?.(event);
        break;
      case "unknown":
        this.m_callbacks.onUnknownOutgoing?.(event);
        break;
    }
  }

  private BuildEventInfo(direction: ConversationEventInfo["direction"]): ConversationEventInfo
  {
    return {
      sessionId: this.m_sessionId,
      direction,
    };
  }
}
