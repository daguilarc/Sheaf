import type { AguiEvent, AguiSnapshotMessage } from "./types.js";

interface ToolCallSnapshot
{
  id: string;
  name: string;
  args: string;
  result: string | null;
}

interface SnapshotBuilderState
{
  messages: Map<string, AguiSnapshotMessage>;
  order: string[];
  finalizedIds: Set<string>;
  openText: Map<string, { role: string; content: string; timestamp?: number }>;
  openReasoning: Map<string, { content: string; timestamp?: number }>;
  openTools: Map<string, ToolCallSnapshot>;
  toolParents: Map<string, string>;
  toolResults: Map<string, string>;
}

function CreateSnapshotState(): SnapshotBuilderState
{
  return {
    messages: new Map(),
    order: [],
    finalizedIds: new Set(),
    openText: new Map(),
    openReasoning: new Map(),
    openTools: new Map(),
    toolParents: new Map(),
    toolResults: new Map(),
  };
}

function TrackFirstSeen(state: SnapshotBuilderState, messageId: string): void
{
  if (!state.order.includes(messageId))
  {
    state.order.push(messageId);
  }
}

function TrackFirstSeenBefore(
  state: SnapshotBuilderState,
  messageId: string,
  beforeMessageId: string,
): void
{
  if (state.order.includes(messageId))
  {
    return;
  }

  const beforeIndex = state.order.indexOf(beforeMessageId);
  if (beforeIndex >= 0)
  {
    state.order.splice(beforeIndex, 0, messageId);
    return;
  }

  state.order.push(messageId);
}

function ReasoningParentMessageId(messageId: string): string | null
{
  const suffix = ":thinking";
  return messageId.endsWith(suffix)
    ? messageId.slice(0, -suffix.length)
    : null;
}

function TrackReasoningFirstSeen(state: SnapshotBuilderState, messageId: string): void
{
  const parentMessageId = ReasoningParentMessageId(messageId);
  if (parentMessageId !== null)
  {
    TrackFirstSeenBefore(state, messageId, parentMessageId);
    return;
  }

  TrackFirstSeen(state, messageId);
}

function UpsertMessage(state: SnapshotBuilderState, message: AguiSnapshotMessage): void
{
  const messageId = String(message.id);
  TrackFirstSeen(state, messageId);
  state.messages.set(messageId, message);
}

function IsRecord(value: unknown): value is Record<string, unknown>
{
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function IsPiMessageContentLifecycleRaw(event: AguiEvent): boolean
{
  if (event.source !== "message_update")
  {
    return false;
  }

  const rawEvent = event.event;
  if (!IsRecord(rawEvent))
  {
    return false;
  }

  const messageEvent = rawEvent.assistantMessageEvent;
  if (!IsRecord(messageEvent))
  {
    return false;
  }

  const messageEventType = messageEvent.type;
  return messageEventType === "thinking_start" ||
    messageEventType === "thinking_end" ||
    messageEventType === "text_start" ||
    messageEventType === "text_end";
}

function FinalizeAssistantToolCalls(state: SnapshotBuilderState, parentMessageId: string): ToolCallSnapshot[]
{
  const toolCalls: ToolCallSnapshot[] = [];

  for (const [toolCallId, toolCall] of state.openTools.entries())
  {
    if (state.toolParents.get(toolCallId) !== parentMessageId)
    {
      continue;
    }

    toolCalls.push({
      id: toolCallId,
      name: toolCall.name,
      args: toolCall.args,
      result: state.toolResults.get(toolCallId) ?? toolCall.result,
    });
  }

  return toolCalls;
}

function IsEmptyContent(content: string): boolean
{
  return content.trim().length === 0;
}

function UpsertTextSnapshot(
  state: SnapshotBuilderState,
  messageId: string,
  open: { role: string; content: string; timestamp?: number },
): void
{
  const snapshot: AguiSnapshotMessage = {
    id: messageId,
    role: open.role,
    content: open.content,
  };

  if (open.timestamp !== undefined)
  {
    snapshot.timestamp = open.timestamp;
  }

  if (open.role === "assistant")
  {
    const toolCalls = FinalizeAssistantToolCalls(state, messageId);

    if (toolCalls.length > 0)
    {
      snapshot.toolCalls = toolCalls.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
        result: toolCall.result,
      }));
    }
  }

  const toolCallCount = Array.isArray(snapshot.toolCalls) ? snapshot.toolCalls.length : 0;

  if (IsEmptyContent(String(snapshot.content ?? "")) && toolCallCount === 0)
  {
    return;
  }

  UpsertMessage(state, snapshot);
}

function UpsertReasoningSnapshot(
  state: SnapshotBuilderState,
  messageId: string,
  open: { content: string; timestamp?: number },
): void
{
  if (IsEmptyContent(open.content))
  {
    return;
  }

  const snapshot: AguiSnapshotMessage = {
    id: messageId,
    role: "reasoning",
    content: open.content,
  };

  if (open.timestamp !== undefined)
  {
    snapshot.timestamp = open.timestamp;
  }

  UpsertMessage(state, snapshot);
}

function MaterializeOpenSnapshots(state: SnapshotBuilderState): void
{
  for (const [messageId, open] of state.openText.entries())
  {
    if (!state.finalizedIds.has(messageId))
    {
      UpsertTextSnapshot(state, messageId, open);
    }
  }

  for (const [messageId, open] of state.openReasoning.entries())
  {
    if (!state.finalizedIds.has(messageId))
    {
      UpsertReasoningSnapshot(state, messageId, open);
    }
  }
}

function ApplyAguiEvent(state: SnapshotBuilderState, event: AguiEvent): void
{
  const eventType = event.type;

  if (eventType === "TEXT_MESSAGE_START")
  {
    const messageId = String(event.messageId);

    if (state.finalizedIds.has(messageId))
    {
      return;
    }

    TrackFirstSeen(state, messageId);
    state.openText.set(messageId, {
      role: String(event.role ?? "assistant"),
      content: "",
      timestamp: typeof event.timestamp === "number" ? event.timestamp : undefined,
    });
    return;
  }

  if (eventType === "TEXT_MESSAGE_CONTENT")
  {
    const messageId = String(event.messageId);

    if (state.finalizedIds.has(messageId))
    {
      return;
    }

    const open = state.openText.get(messageId) ?? {
      role: "assistant",
      content: "",
    };
    open.content += String(event.delta ?? "");
    state.openText.set(messageId, open);
    return;
  }

  if (eventType === "TEXT_MESSAGE_END")
  {
    const messageId = String(event.messageId);

    if (state.finalizedIds.has(messageId))
    {
      return;
    }

    const open = state.openText.get(messageId);

    if (open === undefined)
    {
      return;
    }

    UpsertTextSnapshot(state, messageId, open);
    state.finalizedIds.add(messageId);
    state.openText.delete(messageId);
    return;
  }

  if (eventType === "REASONING_MESSAGE_START")
  {
    const messageId = String(event.messageId);

    if (state.finalizedIds.has(messageId))
    {
      return;
    }

    TrackReasoningFirstSeen(state, messageId);
    state.openReasoning.set(messageId, {
      content: "",
      timestamp: typeof event.timestamp === "number" ? event.timestamp : undefined,
    });
    return;
  }

  if (eventType === "REASONING_MESSAGE_CONTENT")
  {
    const messageId = String(event.messageId);
    const open = state.openReasoning.get(messageId) ?? { content: "" };
    TrackReasoningFirstSeen(state, messageId);
    open.content += String(event.delta ?? "");
    state.openReasoning.set(messageId, open);
    return;
  }

  if (eventType === "REASONING_MESSAGE_END")
  {
    const messageId = String(event.messageId);
    const open = state.openReasoning.get(messageId);

    if (open === undefined)
    {
      return;
    }

    UpsertReasoningSnapshot(state, messageId, open);
    state.finalizedIds.add(messageId);
    state.openReasoning.delete(messageId);
    return;
  }

  if (eventType === "TOOL_CALL_START")
  {
    const toolCallId = String(event.toolCallId);

    if (event.parentMessageId !== undefined)
    {
      TrackFirstSeen(state, String(event.parentMessageId));
    }

    state.openTools.set(toolCallId, {
      id: toolCallId,
      name: String(event.toolCallName ?? "tool"),
      args: "",
      result: null,
    });

    if (event.parentMessageId !== undefined)
    {
      state.toolParents.set(toolCallId, String(event.parentMessageId));
    }

    return;
  }

  if (eventType === "TOOL_CALL_ARGS")
  {
    const toolCallId = String(event.toolCallId);
    const toolCall = state.openTools.get(toolCallId);

    if (toolCall !== undefined)
    {
      toolCall.args += String(event.delta ?? "");
    }

    return;
  }

  if (eventType === "TOOL_CALL_RESULT")
  {
    const toolCallId = String(event.toolCallId);
    const messageId = String(event.messageId ?? `${toolCallId}:result`);
    const content = String(event.content ?? "");
    state.toolResults.set(toolCallId, content);

    const snapshot: AguiSnapshotMessage = {
      id: messageId,
      role: "tool",
      content,
      toolCallId,
    };

    if (typeof event.timestamp === "number")
    {
      snapshot.timestamp = event.timestamp;
    }

    UpsertMessage(state, snapshot);
    return;
  }

  if (eventType === "CUSTOM")
  {
    const messageId = String(event.messageId ?? `custom:${state.order.length + 1}`);
    UpsertMessage(state, {
      id: messageId,
      role: "activity",
      activityType: String(event.name ?? "custom"),
      content: typeof event.value === "string" ? event.value : JSON.stringify(event.value ?? {}),
    });
    return;
  }

  if (eventType === "RAW")
  {
    if (IsPiMessageContentLifecycleRaw(event))
    {
      return;
    }

    const messageId = String(event.messageId ?? `raw:${state.order.length + 1}`);
    UpsertMessage(state, {
      id: messageId,
      role: "activity",
      activityType: String(event.source ?? "raw"),
      content: JSON.stringify(event.event ?? {}),
    });
    return;
  }

  if (eventType === "ACTIVITY_SNAPSHOT")
  {
    const messageId = String(event.messageId ?? `activity:${state.order.length + 1}`);
    UpsertMessage(state, {
      id: messageId,
      role: "activity",
      activityType: String(event.activityType ?? "activity"),
      content: JSON.stringify(event.content ?? {}),
    });
  }
}

export function eventsToSnapshots(events: AguiEvent[]): AguiSnapshotMessage[]
{
  const state = CreateSnapshotState();

  for (const event of events)
  {
    ApplyAguiEvent(state, event);
  }

  MaterializeOpenSnapshots(state);

  const dedupedOrder: string[] = [];
  const seen = new Set<string>();

  for (const messageId of state.order)
  {
    if (seen.has(messageId))
    {
      continue;
    }

    seen.add(messageId);
    dedupedOrder.push(messageId);
  }

  return dedupedOrder
    .map((messageId) => state.messages.get(messageId))
    .filter((message): message is AguiSnapshotMessage => message !== undefined);
}
