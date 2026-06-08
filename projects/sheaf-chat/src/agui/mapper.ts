import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type {
  AguiEvent,
  PiMapperContext,
  PiMappableEvent,
  SheafActivity,
  UserMessageAguiInput,
} from "./types.js";
import { SanitizeOptions, SanitizeValue } from "./sanitizer.js";

interface OpenToolCall
{
  toolCallId: string;
  toolCallName: string;
  parentMessageId?: string;
}

function IsRecord(value: unknown): value is Record<string, unknown>
{
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function StringifyPayload(value: unknown): string
{
  if (typeof value === "string")
  {
    return value;
  }

  if (IsRecord(value))
  {
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort())
    {
      sorted[key] = value[key];
    }

    return JSON.stringify(sorted);
  }

  return JSON.stringify(value);
}

export class PiToAguiMapper
{
  private m_fallbackEvents: Record<string, unknown>[] = [];
  private m_openRuns = new Set<string>();
  private m_openTextMessages = new Set<string>();
  private m_openReasoningMessages = new Set<string>();
  private m_openReasoningPhases = new Set<string>();
  private m_openTools = new Map<string, OpenToolCall>();
  private m_seenTools = new Set<string>();
  private m_toolsWithArgs = new Set<string>();
  private m_runCounter = 0;

  Reset(): void
  {
    this.m_fallbackEvents = [];
    this.m_openRuns.clear();
    this.m_openTextMessages.clear();
    this.m_openReasoningMessages.clear();
    this.m_openReasoningPhases.clear();
    this.m_openTools.clear();
    this.m_seenTools.clear();
    this.m_toolsWithArgs.clear();
    this.m_runCounter = 0;
  }

  Errors(): Record<string, unknown>[]
  {
    return this.m_fallbackEvents.map((event) => structuredClone(event));
  }

  Consume(event: PiMappableEvent, context: PiMapperContext): AguiEvent[]
  {
    try
    {
      return this.MapEvent(event, context);
    }
    catch
    {
      return this.Fallback(event, context);
    }
  }

  MapEvent(event: PiMappableEvent, context: PiMapperContext): AguiEvent[]
  {
    if (!IsRecord(event) || typeof event.type !== "string")
    {
      return this.Fallback(event, context);
    }

    const source = event as Record<string, unknown>;
    const eventType = String(source.type);

    if (eventType === "agent_start")
    {
      const runId = this.NextRunId(context);
      this.m_openRuns.add(runId);

      return [this.Agui({
        type: "RUN_STARTED",
        threadId: context.threadId,
        runId,
      }, context, source)];
    }

    if (eventType === "agent_end")
    {
      const runId = [...this.m_openRuns].at(-1) ?? this.RunId(context);
      const output = this.CloseOpenForEvent(context, source);
      this.m_openRuns.delete(runId);
      output.push(this.Agui({
        type: "RUN_FINISHED",
        threadId: context.threadId,
        runId,
        result: SanitizeValue(source, { canonicalRoot: context.canonicalRoot }),
      }, context, source));
      return output;
    }

    if (eventType === "turn_start")
    {
      return [this.Agui({ type: "STEP_STARTED", stepName: "pi.turn" }, context, source)];
    }

    if (eventType === "turn_end")
    {
      return [this.Agui({ type: "STEP_FINISHED", stepName: "pi.turn" }, context, source)];
    }

    if (eventType === "message_start")
    {
      const message = source.message;

      if (!IsRecord(message))
      {
        return this.Fallback(source, context);
      }

      const messageId = this.PiMessageId(context, message);

      if (this.m_openTextMessages.has(messageId))
      {
        return [];
      }

      this.m_openTextMessages.add(messageId);

      return [this.Agui({
        type: "TEXT_MESSAGE_START",
        messageId,
        role: this.AguiTextRole(message.role),
      }, context, source)];
    }

    if (eventType === "message_update")
    {
      const message = source.message;
      const messageEvent = source.assistantMessageEvent;

      if (!IsRecord(message) || !IsRecord(messageEvent))
      {
        return this.Fallback(source, context);
      }

      const messageId = this.PiMessageId(context, message);
      const deltaType = messageEvent.type;

      if (deltaType === "text_delta")
      {
        return this.AppendText(
          context,
          messageId,
          String(messageEvent.delta ?? ""),
          this.AguiTextRole(message.role),
          source,
        );
      }

      if (deltaType === "thinking_delta")
      {
        return this.AppendReasoning(
          context,
          `${messageId}:thinking`,
          String(messageEvent.delta ?? ""),
          source,
        );
      }

      if (deltaType === "tool_call_delta")
      {
        const [toolCallId, toolName] = this.PiToolCallIdentity(context, message, messageEvent);
        const output = this.EnsurePiToolStarted(context, toolCallId, toolName, source, messageId);
        output.push(this.ToolArgs(context, toolCallId, String(messageEvent.delta ?? ""), source));
        return output;
      }

      return this.Fallback(source, context);
    }

    if (eventType === "message_end")
    {
      const message = source.message;

      if (!IsRecord(message))
      {
        return this.Fallback(source, context);
      }

      const messageId = this.PiMessageId(context, message);
      const output = this.CloseReasoning(context, `${messageId}:thinking`, source);
      output.push(...this.CloseText(context, messageId, source));
      return output;
    }

    if (eventType === "tool_execution_start")
    {
      const toolCallId = String(source.toolCallId ?? this.SourceId(context, "pi-tool-exec"));
      const toolName = String(source.toolName ?? "pi_tool");
      const output = this.EnsurePiToolStarted(context, toolCallId, toolName, source);

      if (!this.m_toolsWithArgs.has(toolCallId) && "args" in source)
      {
        output.push(this.ToolArgs(context, toolCallId, source.args, source));
      }

      return output;
    }

    if (eventType === "tool_execution_update")
    {
      const toolCallId = String(source.toolCallId ?? this.SourceId(context, "pi-tool-exec"));
      const toolName = String(source.toolName ?? "pi_tool");
      const output = this.EnsurePiToolStarted(context, toolCallId, toolName, source);

      if (!this.m_toolsWithArgs.has(toolCallId) && "args" in source)
      {
        output.push(this.ToolArgs(context, toolCallId, source.args, source));
      }

      output.push(this.ToolResult(context, toolCallId, source.partialResult, source));
      return output;
    }

    if (eventType === "tool_execution_end")
    {
      const toolCallId = String(source.toolCallId ?? this.SourceId(context, "pi-tool-exec"));
      const toolName = String(source.toolName ?? "pi_tool");
      const result = "isError" in source
        ? { result: source.result, isError: source.isError }
        : source.result;
      const output = this.EnsurePiToolStarted(context, toolCallId, toolName, source);
      output.push(this.ToolResult(context, toolCallId, result, source));

      if (this.m_openTools.has(toolCallId))
      {
        output.push(this.Agui({ type: "TOOL_CALL_END", toolCallId }, context, source));
        this.m_openTools.delete(toolCallId);
      }

      return output;
    }

    if (eventType === "auto_retry_end")
    {
      if (source.success === false)
      {
        return [this.Agui({
          type: "RUN_ERROR",
          message: String(source.finalError ?? "Pi auto-retry failed"),
          code: "auto_retry_failed",
        }, context, source)];
      }

      return [];
    }

    if (
      eventType === "compaction_start" ||
      eventType === "compaction_end" ||
      eventType === "auto_retry_start" ||
      eventType === "queue_update"
    )
    {
      return [];
    }

    if (
      eventType === "session_info_changed" ||
      eventType === "thinking_level_changed" ||
      eventType === "thinking_level_change"
    )
    {
      return [this.Agui({
        type: "CUSTOM",
        name: `pi.${eventType}`,
        value: SanitizeValue(source, { canonicalRoot: context.canonicalRoot }),
      }, context, source)];
    }

    if (eventType === "session" || eventType === "model_change" || eventType === "session_info")
    {
      return [this.Agui({
        type: "CUSTOM",
        name: `pi.${eventType}`,
        value: SanitizeValue(source, { canonicalRoot: context.canonicalRoot }),
      }, context, source)];
    }

    if (eventType === "message" && IsRecord(source.message))
    {
      const message = source.message;
      const messageId = this.PiMessageId(context, message);
      const text = ExtractMessageText(message);
      const role = this.AguiTextRole(message.role);

      return [
        this.Agui({ type: "TEXT_MESSAGE_START", messageId, role }, context, source),
        this.Agui({ type: "TEXT_MESSAGE_CONTENT", messageId, delta: text }, context, source),
        this.Agui({ type: "TEXT_MESSAGE_END", messageId }, context, source),
      ];
    }

    return this.Fallback(source, context);
  }

  Flush(context: PiMapperContext): AguiEvent[]
  {
    const output: AguiEvent[] = [];

    for (const toolCallId of [...this.m_openTools.keys()].sort())
    {
      output.push(this.Agui({ type: "TOOL_CALL_END", toolCallId }, context));
    }
    this.m_openTools.clear();

    for (const messageId of [...this.m_openReasoningMessages].sort())
    {
      output.push(this.Agui({ type: "REASONING_MESSAGE_END", messageId }, context));
    }
    this.m_openReasoningMessages.clear();

    for (const messageId of [...this.m_openReasoningPhases].sort())
    {
      output.push(this.Agui({ type: "REASONING_END", messageId }, context));
    }
    this.m_openReasoningPhases.clear();

    for (const messageId of [...this.m_openTextMessages].sort())
    {
      output.push(this.Agui({ type: "TEXT_MESSAGE_END", messageId }, context));
    }
    this.m_openTextMessages.clear();

    for (const runId of [...this.m_openRuns].sort())
    {
      output.push(this.Agui({
        type: "RUN_FINISHED",
        threadId: runId,
        runId,
      }, context));
    }
    this.m_openRuns.clear();

    return output;
  }

  Fallback(event: PiMappableEvent, context: PiMapperContext): AguiEvent[]
  {
    const source = structuredClone(event) as Record<string, unknown>;
    this.m_fallbackEvents.push(source);

    return [
      this.Agui({
        type: "RAW",
        event: this.SanitizeRaw(source, context),
        source: String((source.type as string | undefined) ?? "pi"),
      }, context, source),
    ];
  }

  Agui(
    fields: Record<string, unknown>,
    context: PiMapperContext,
    sourceEvent?: PiMappableEvent,
  ): AguiEvent
  {
    const event: AguiEvent = { type: String(fields.type) };

    for (const [key, value] of Object.entries(fields))
    {
      if (key === "type" || value === undefined)
      {
        continue;
      }

      event[key] = value;
    }

    if (event.timestamp === undefined && context.timestampMs !== undefined)
    {
      event.timestamp = context.timestampMs;
    }

    if (sourceEvent !== undefined)
    {
      event.rawEvent = this.SanitizeRaw(sourceEvent, context);
    }

    return event;
  }

  SanitizeRaw(event: PiMappableEvent, context: PiMapperContext): unknown
  {
    const options: SanitizeOptions = {};

    if (context.canonicalRoot !== undefined)
    {
      options.canonicalRoot = context.canonicalRoot;
    }

    return SanitizeValue(event, options);
  }

  SourceId(context: PiMapperContext, suffix: string): string
  {
    const step = context.step ?? "unknown";
    const sequence = context.sequence ?? "unknown";
    return `${context.threadId}:step:${step}:seq:${sequence}:${suffix}`;
  }

  RunId(context: PiMapperContext): string
  {
    const step = context.step ?? "unknown";
    return `${context.threadId}:step:${step}`;
  }

  PiMessageId(context: PiMapperContext, message: Record<string, unknown>): string
  {
    const timestamp = message.timestamp;

    if (timestamp !== undefined && timestamp !== null)
    {
      const role = String(message.role ?? "message");
      const step = context.step ?? "unknown";
      return `${context.threadId}:step:${step}:pi-message:${role}:${String(timestamp)}`;
    }

    return this.SourceId(context, "pi-message");
  }

  AguiTextRole(role: unknown): string
  {
    const roleValue = String(role ?? "assistant");

    if (roleValue === "developer" || roleValue === "system" || roleValue === "assistant" || roleValue === "user")
    {
      return roleValue;
    }

    return "assistant";
  }

  AppendText(
    context: PiMapperContext,
    messageId: string,
    text: string,
    role: string,
    sourceEvent: PiMappableEvent,
  ): AguiEvent[]
  {
    if (text.length === 0)
    {
      return [];
    }

    const output: AguiEvent[] = [];

    if (!this.m_openTextMessages.has(messageId))
    {
      this.m_openTextMessages.add(messageId);
      output.push(this.Agui({
        type: "TEXT_MESSAGE_START",
        messageId,
        role,
      }, context, sourceEvent));
    }

    output.push(this.Agui({
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta: text,
    }, context, sourceEvent));

    return output;
  }

  CloseText(context: PiMapperContext, messageId: string, sourceEvent: PiMappableEvent): AguiEvent[]
  {
    if (!this.m_openTextMessages.has(messageId))
    {
      return [];
    }

    this.m_openTextMessages.delete(messageId);

    return [this.Agui({ type: "TEXT_MESSAGE_END", messageId }, context, sourceEvent)];
  }

  AppendReasoning(
    context: PiMapperContext,
    messageId: string,
    text: string,
    sourceEvent: PiMappableEvent,
  ): AguiEvent[]
  {
    if (text.length === 0)
    {
      return [];
    }

    const output: AguiEvent[] = [];

    if (!this.m_openReasoningPhases.has(messageId))
    {
      this.m_openReasoningPhases.add(messageId);
      output.push(this.Agui({ type: "REASONING_START", messageId }, context, sourceEvent));
    }

    if (!this.m_openReasoningMessages.has(messageId))
    {
      this.m_openReasoningMessages.add(messageId);
      output.push(this.Agui({
        type: "REASONING_MESSAGE_START",
        messageId,
        role: "reasoning",
      }, context, sourceEvent));
    }

    output.push(this.Agui({
      type: "REASONING_MESSAGE_CONTENT",
      messageId,
      delta: text,
    }, context, sourceEvent));

    return output;
  }

  CloseReasoning(context: PiMapperContext, messageId: string, sourceEvent: PiMappableEvent): AguiEvent[]
  {
    const output: AguiEvent[] = [];

    if (this.m_openReasoningMessages.has(messageId))
    {
      this.m_openReasoningMessages.delete(messageId);
      output.push(this.Agui({ type: "REASONING_MESSAGE_END", messageId }, context, sourceEvent));
    }

    if (this.m_openReasoningPhases.has(messageId))
    {
      this.m_openReasoningPhases.delete(messageId);
      output.push(this.Agui({ type: "REASONING_END", messageId }, context, sourceEvent));
    }

    return output;
  }

  ToolArgs(
    context: PiMapperContext,
    toolCallId: string,
    args: unknown,
    sourceEvent: PiMappableEvent,
  ): AguiEvent
  {
    this.m_toolsWithArgs.add(toolCallId);

    return this.Agui({
      type: "TOOL_CALL_ARGS",
      toolCallId,
      delta: StringifyPayload(args),
    }, context, sourceEvent);
  }

  ToolResult(
    context: PiMapperContext,
    toolCallId: string,
    content: unknown,
    sourceEvent: PiMappableEvent,
  ): AguiEvent
  {
    return this.Agui({
      type: "TOOL_CALL_RESULT",
      messageId: `${toolCallId}:result`,
      toolCallId,
      content: StringifyPayload(content),
      role: "tool",
    }, context, sourceEvent);
  }

  EnsurePiToolStarted(
    context: PiMapperContext,
    toolCallId: string,
    toolName: string,
    sourceEvent: PiMappableEvent,
    parentMessageId?: string,
  ): AguiEvent[]
  {
    if (this.m_openTools.has(toolCallId))
    {
      return [];
    }

    this.m_openTools.set(toolCallId, {
      toolCallId,
      toolCallName: toolName,
      parentMessageId,
    });
    this.m_seenTools.add(toolCallId);

    const fields: Record<string, unknown> = {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: toolName,
    };

    if (parentMessageId !== undefined)
    {
      fields.parentMessageId = parentMessageId;
    }

    return [this.Agui(fields, context, sourceEvent)];
  }

  PiToolCallIdentity(
    context: PiMapperContext,
    message: Record<string, unknown>,
    messageEvent: Record<string, unknown>,
  ): [string, string]
  {
    const content = message.content;

    if (Array.isArray(content))
    {
      for (let index = content.length - 1; index >= 0; index -= 1)
      {
        const block = content[index];

        if (IsRecord(block) && block.type === "toolCall")
        {
          const toolCallId = String(block.id ?? `${this.PiMessageId(context, message)}:tool`);
          const toolName = String(messageEvent.name ?? block.name ?? "pi_tool");
          return [toolCallId, toolName];
        }
      }
    }

    return [
      `${this.PiMessageId(context, message)}:tool`,
      String(messageEvent.name ?? "pi_tool"),
    ];
  }

  CloseOpenForEvent(context: PiMapperContext, sourceEvent: PiMappableEvent): AguiEvent[]
  {
    const output: AguiEvent[] = [];

    for (const toolCallId of [...this.m_openTools.keys()].sort())
    {
      output.push(this.Agui({ type: "TOOL_CALL_END", toolCallId }, context, sourceEvent));
    }
    this.m_openTools.clear();

    for (const messageId of [...this.m_openReasoningMessages].sort())
    {
      output.push(this.Agui({ type: "REASONING_MESSAGE_END", messageId }, context, sourceEvent));
    }
    this.m_openReasoningMessages.clear();

    for (const messageId of [...this.m_openReasoningPhases].sort())
    {
      output.push(this.Agui({ type: "REASONING_END", messageId }, context, sourceEvent));
    }
    this.m_openReasoningPhases.clear();

    for (const messageId of [...this.m_openTextMessages].sort())
    {
      output.push(this.Agui({ type: "TEXT_MESSAGE_END", messageId }, context, sourceEvent));
    }
    this.m_openTextMessages.clear();

    return output;
  }

  NextRunId(context: PiMapperContext): string
  {
    this.m_runCounter += 1;
    return `${this.RunId(context)}:run:${this.m_runCounter}`;
  }
}

const x_defaultMapper = new PiToAguiMapper();

export function mapPiEventToAgui(
  event: PiMappableEvent,
  context: PiMapperContext,
  mapper: PiToAguiMapper = x_defaultMapper,
): AguiEvent[]
{
  return mapper.MapEvent(event, context);
}

function ExtractMessageText(message: Record<string, unknown>): string
{
  const content = message.content;

  if (typeof content === "string")
  {
    return content;
  }

  if (!Array.isArray(content))
  {
    return "";
  }

  const parts: string[] = [];

  for (const block of content)
  {
    if (typeof block === "string")
    {
      parts.push(block);
      continue;
    }

    if (!IsRecord(block))
    {
      continue;
    }

    if (typeof block.text === "string")
    {
      parts.push(block.text);
    }
    else if (typeof block.content === "string")
    {
      parts.push(block.content);
    }
    else if (typeof block.thinking === "string")
    {
      parts.push(block.thinking);
    }
  }

  return parts.join("");
}

export function mapUserMessageToAgui(message: UserMessageAguiInput): AguiEvent[]
{
  const messageId = message.messageId;
  const text = message.text;

  return [
    { type: "TEXT_MESSAGE_START", messageId, role: "user" },
    { type: "TEXT_MESSAGE_CONTENT", messageId, delta: text },
    { type: "TEXT_MESSAGE_END", messageId },
  ];
}

export function mapSheafActivityToAgui(activity: SheafActivity, context: PiMapperContext = { threadId: "sheaf-chat" }): AguiEvent
{
  const mapper = x_defaultMapper;

  switch (activity.kind)
  {
    case "path_escape_denied":
      return mapper.Agui({
        type: "CUSTOM",
        name: "sheaf.path_enforcement",
        value: SanitizeValue({
          inputPath: activity.inputPath,
          reason: activity.reason,
          tool: activity.tool,
        }, { canonicalRoot: context.canonicalRoot }),
      }, context, {
        type: "sheaf_chat.path_escape_denied",
        inputPath: activity.inputPath,
        reason: activity.reason,
        tool: activity.tool,
      });

    case "model_changed":
      return mapper.Agui({
        type: "CUSTOM",
        name: "sheaf.model_changed",
        value: SanitizeValue({
          model: activity.model,
          applyTo: activity.applyTo,
        }, { canonicalRoot: context.canonicalRoot }),
      }, context, {
        type: "model.changed",
        model: activity.model,
        applyTo: activity.applyTo,
      });

    case "lifecycle_status":
      return mapper.Agui({
        type: "CUSTOM",
        name: "sheaf.lifecycle_status",
        value: SanitizeValue({
          state: activity.state,
          previousState: activity.previousState,
        }, { canonicalRoot: context.canonicalRoot }),
      }, context, {
        type: "agent.status",
        state: activity.state,
        previousState: activity.previousState,
      });

    case "cancellation":
      return mapper.Agui({
        type: "RUN_ERROR",
        message: activity.message ?? "Turn cancelled",
        code: "cancelled",
        runId: activity.runId,
      }, context, { type: "client.cancel" });

    case "error":
      return mapper.Agui({
        type: "RUN_ERROR",
        message: activity.message,
        code: activity.code,
        runId: activity.runId,
      }, context, {
        type: "server.error",
        code: activity.code,
        message: activity.message,
        fatal: activity.fatal,
      });
  }
}

export function CreatePiToAguiMapper(): PiToAguiMapper
{
  return new PiToAguiMapper();
}

export type { AgentSessionEvent };
