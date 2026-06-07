import {
  classifyIncomingEvent,
  type ConversationEventInfo,
  type RealtimeEvent,
  type StructuredContextMessage,
  type ToolLifecycleNotification,
} from "realtime-agent-lib";

import type { ChatBubble } from "./bubbleTypes.js";
import { FormatContextPushSummary } from "./contextSummary.js";
import { FormatToolCallSummary } from "./toolSummary.js";

function NewBubbleId(): string
{
  return crypto.randomUUID();
}

function ReadStringField(event: RealtimeEvent, key: string): string | undefined
{
  const v = event[key];
  return typeof v === "string" ? v : undefined;
}

function ReadErrorMessage(event: RealtimeEvent): string
{
  const err = event.error;
  if (typeof err === "object" && err !== null)
  {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.length > 0)
    {
      return msg;
    }
  }

  return "Realtime error";
}

function ExtractAssistantStreamKey(event: RealtimeEvent): string
{
  const responseId = ReadStringField(event, "response_id");
  if (responseId !== undefined && responseId.length > 0)
  {
    return responseId;
  }

  const itemId = ReadStringField(event, "item_id");
  if (itemId !== undefined && itemId.length > 0)
  {
    return itemId;
  }

  return "_unknown_response";
}

export class ChatModel
{
  private m_bubbles: ChatBubble[] = [];
  private m_listeners = new Set<() => void>();
  private m_argsByCallId = new Map<string, string>();
  private m_transcriptBubbleIdByItemId = new Map<string, string>();
  private m_assistantBubbleIdByResponseKey = new Map<string, string>();

  getSnapshot(): ChatBubble[]
  {
    return this.m_bubbles.map((b) => ({ ...b }));
  }

  subscribe(fn: () => void): () => void
  {
    this.m_listeners.add(fn);
    return () =>
    {
      this.m_listeners.delete(fn);
    };
  }

  private Emit(): void
  {
    for (const fn of this.m_listeners)
    {
      fn();
    }
  }

  ingestEvent(event: RealtimeEvent, info: ConversationEventInfo): void
  {
    if (info.direction !== "incoming")
    {
      return;
    }

    const eventClass = classifyIncomingEvent(event);

    if (eventClass === "tool_call" && event.type === "response.function_call_arguments.done")
    {
      const callId = ReadStringField(event, "call_id");
      const args = ReadStringField(event, "arguments");
      if (callId !== undefined && callId.length > 0)
      {
        this.m_argsByCallId.set(callId, args ?? "");
      }

      return;
    }

    if (eventClass === "transcription")
    {
      this.IngestTranscriptionEvent(event);
      return;
    }

    if (eventClass === "text_output")
    {
      this.IngestTextOutputEvent(event);
      return;
    }

    if (eventClass === "error")
    {
      this.recordError(ReadErrorMessage(event));
    }
  }

  private IngestTranscriptionEvent(event: RealtimeEvent): void
  {
    const itemId = ReadStringField(event, "item_id");
    if (itemId === undefined || itemId.length === 0)
    {
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.delta")
    {
      const delta = ReadStringField(event, "delta") ?? "";
      const existingId = this.m_transcriptBubbleIdByItemId.get(itemId);
      const createdAt = new Date().toISOString();

      if (existingId === undefined)
      {
        const id = NewBubbleId();
        this.m_transcriptBubbleIdByItemId.set(itemId, id);
        this.m_bubbles.push({
          kind: "user_transcript",
          id,
          itemId,
          text: delta,
          complete: false,
          createdAt,
        });
      }
      else
      {
        const bubble = this.m_bubbles.find((b) => b.id === existingId);
        if (bubble !== undefined && bubble.kind === "user_transcript")
        {
          bubble.text += delta;
        }
      }

      this.Emit();
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.completed")
    {
      const transcript = ReadStringField(event, "transcript") ?? "";
      const existingId = this.m_transcriptBubbleIdByItemId.get(itemId);

      if (existingId === undefined)
      {
        const id = NewBubbleId();
        this.m_transcriptBubbleIdByItemId.set(itemId, id);
        this.m_bubbles.push({
          kind: "user_transcript",
          id,
          itemId,
          text: transcript,
          complete: true,
          createdAt: new Date().toISOString(),
        });
      }
      else
      {
        const bubble = this.m_bubbles.find((b) => b.id === existingId);
        if (bubble !== undefined && bubble.kind === "user_transcript")
        {
          bubble.text = transcript.length > 0 ? transcript : bubble.text;
          bubble.complete = true;
        }
      }

      this.Emit();
    }
  }

  private IngestTextOutputEvent(event: RealtimeEvent): void
  {
    const key = ExtractAssistantStreamKey(event);
    const createdAt = new Date().toISOString();

    if (event.type === "response.output_text.delta")
    {
      const delta = ReadStringField(event, "delta") ?? "";
      const existingId = this.m_assistantBubbleIdByResponseKey.get(key);

      if (existingId === undefined)
      {
        const id = NewBubbleId();
        this.m_assistantBubbleIdByResponseKey.set(key, id);
        this.m_bubbles.push({
          kind: "assistant_text",
          id,
          responseId: key,
          text: delta,
          complete: false,
          createdAt,
        });
      }
      else
      {
        const bubble = this.m_bubbles.find((b) => b.id === existingId);
        if (bubble !== undefined && bubble.kind === "assistant_text")
        {
          bubble.text += delta;
        }
      }

      this.Emit();
      return;
    }

    if (event.type === "response.output_text.done")
    {
      const text =
        ReadStringField(event, "text") ??
        (() =>
        {
          const existingId = this.m_assistantBubbleIdByResponseKey.get(key);
          if (existingId === undefined)
          {
            return "";
          }

          const bubble = this.m_bubbles.find((b) => b.id === existingId);
          return bubble !== undefined && bubble.kind === "assistant_text" ? bubble.text : "";
        })();

      const existingId = this.m_assistantBubbleIdByResponseKey.get(key);

      if (existingId === undefined)
      {
        const id = NewBubbleId();
        this.m_assistantBubbleIdByResponseKey.set(key, id);
        this.m_bubbles.push({
          kind: "assistant_text",
          id,
          responseId: key,
          text,
          complete: true,
          createdAt,
        });
      }
      else
      {
        const bubble = this.m_bubbles.find((b) => b.id === existingId);
        if (bubble !== undefined && bubble.kind === "assistant_text")
        {
          bubble.text = text.length > 0 ? text : bubble.text;
          bubble.complete = true;
        }
      }

      this.Emit();
    }
  }

  ingestToolLifecycle(notification: ToolLifecycleNotification): void
  {
    if (notification.phase === "queued")
    {
      const argsJson = this.m_argsByCallId.get(notification.toolCallId);
      const summary = FormatToolCallSummary(notification.toolName, argsJson);
      this.m_bubbles.push({
        kind: "tool_call",
        id: NewBubbleId(),
        toolCallId: notification.toolCallId,
        toolName: notification.toolName,
        summary,
        phase: "queued",
        createdAt: new Date().toISOString(),
      });
      this.Emit();
      return;
    }

    const bubble = this.m_bubbles.find(
      (b) => b.kind === "tool_call" && b.toolCallId === notification.toolCallId,
    );

    if (bubble === undefined || bubble.kind !== "tool_call")
    {
      return;
    }

    bubble.phase = notification.phase;

    if (notification.phase === "started")
    {
      const argsJson = this.m_argsByCallId.get(notification.toolCallId);
      bubble.summary = FormatToolCallSummary(notification.toolName, argsJson);
    }

    if (notification.phase === "succeeded" || notification.phase === "failed")
    {
      this.m_argsByCallId.delete(notification.toolCallId);
    }

    this.Emit();
  }

  recordContextPush(message: StructuredContextMessage): void
  {
    this.m_bubbles.push({
      kind: "context_push",
      id: NewBubbleId(),
      summary: FormatContextPushSummary(message),
      createdAt: new Date().toISOString(),
    });
    this.Emit();
  }

  recordError(message: string): void
  {
    this.m_bubbles.push({
      kind: "error",
      id: NewBubbleId(),
      message,
      createdAt: new Date().toISOString(),
    });
    this.Emit();
  }

  reset(reason: string): void
  {
    this.m_bubbles = [];
    this.m_argsByCallId.clear();
    this.m_transcriptBubbleIdByItemId.clear();
    this.m_assistantBubbleIdByResponseKey.clear();
    this.m_bubbles.push({
      kind: "context_push",
      id: NewBubbleId(),
      summary: `Session ended: ${reason}`,
      createdAt: new Date().toISOString(),
    });
    this.Emit();
  }

  clear(): void
  {
    this.m_bubbles = [];
    this.m_argsByCallId.clear();
    this.m_transcriptBubbleIdByItemId.clear();
    this.m_assistantBubbleIdByResponseKey.clear();
    this.Emit();
  }
}
