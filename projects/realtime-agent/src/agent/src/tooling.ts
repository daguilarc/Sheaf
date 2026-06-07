import type {
  CreateResponseOptions,
  QueuedEventResult,
  RealtimeEvent,
  ToolCallSet,
  ToolDefinition,
  ToolLifecycleCallback,
  ToolLifecycleNotification,
  ToolRuntimeContext,
} from "./types.js";

export class DuplicateToolNameError extends Error
{
  constructor(duplicateName: string)
  {
    super(`Duplicate tool name in tool call set: ${duplicateName}`);
    this.name = "DuplicateToolNameError";
  }
}

export class ToolRegistry
{
  private m_toolsByName = new Map<string, ToolDefinition>();

  constructor(toolCallSet: ToolCallSet)
  {
    for (const tool of toolCallSet.tools)
    {
      if (this.m_toolsByName.has(tool.name))
      {
        throw new DuplicateToolNameError(tool.name);
      }

      this.m_toolsByName.set(tool.name, tool);
    }
  }

  static FromToolCallSet(toolCallSet: ToolCallSet): ToolRegistry
  {
    return new ToolRegistry(toolCallSet);
  }

  Resolve(name: string): ToolDefinition | undefined
  {
    return this.m_toolsByName.get(name);
  }

  GetToolNames(): string[]
  {
    return [...this.m_toolsByName.keys()];
  }

  ToRealtimeToolDescriptors(): Record<string, unknown>[]
  {
    return [...this.m_toolsByName.values()].map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
  }
}

export type ToolErrorCode = "tool_not_found" | "invalid_arguments" | "callback_failed";

export interface ToolErrorPayload
{
  error: string;
  code: ToolErrorCode;
  details?: unknown;
}

export interface ExtractedToolCall
{
  callId: string;
  name: string;
  argumentsJson: string;
  metadata?: Record<string, unknown>;
}

export interface ToolDispatcherSendContext
{
  sendOutgoingEvent: (event: RealtimeEvent) => void;
  enqueueResponseCreate: (options?: CreateResponseOptions) => Promise<QueuedEventResult>;
}

export type ToolDispatcherResponseAfterOutput = "never" | "always";

export interface ToolDispatcherOptions
{
  sessionId: string;
  registry: ToolRegistry;
  sendContext: ToolDispatcherSendContext;
  onToolLifecycle?: ToolLifecycleCallback;
  responseAfterOutput?: ToolDispatcherResponseAfterOutput;
}

interface QueuedToolCall
{
  extracted: ExtractedToolCall;
}

export function buildFunctionCallOutputEvent(
  callId: string,
  outputPayload: unknown,
): RealtimeEvent
{
  return {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(outputPayload),
    },
  };
}

export function buildToolErrorPayload(
  code: ToolErrorCode,
  error: string,
  details?: unknown,
): ToolErrorPayload
{
  const payload: ToolErrorPayload = {
    error,
    code,
  };

  if (details !== undefined)
  {
    payload.details = details;
  }

  return payload;
}

export class ToolDispatcher
{
  private m_sessionId: string;
  private m_registry: ToolRegistry;
  private m_sendContext: ToolDispatcherSendContext;
  private m_onToolLifecycle?: ToolLifecycleCallback;
  private m_responseAfterOutput: ToolDispatcherResponseAfterOutput;
  private m_queue: QueuedToolCall[] = [];
  private m_processing = false;

  constructor(options: ToolDispatcherOptions)
  {
    this.m_sessionId = options.sessionId;
    this.m_registry = options.registry;
    this.m_sendContext = options.sendContext;
    this.m_onToolLifecycle = options.onToolLifecycle;
    this.m_responseAfterOutput = options.responseAfterOutput ?? "never";
  }

  Enqueue(extracted: ExtractedToolCall): void
  {
    this.EmitLifecycle({
      sessionId: this.m_sessionId,
      toolCallId: extracted.callId,
      toolName: extracted.name,
      phase: "queued",
    });

    this.m_queue.push({ extracted });
    void this.ProcessQueue();
  }

  private async ProcessQueue(): Promise<void>
  {
    if (this.m_processing)
    {
      return;
    }

    this.m_processing = true;

    while (this.m_queue.length > 0)
    {
      const queued = this.m_queue.shift();
      if (queued === undefined)
      {
        continue;
      }

      await this.ExecuteQueuedCall(queued);
    }

    this.m_processing = false;
  }

  private async ExecuteQueuedCall(queued: QueuedToolCall): Promise<void>
  {
    const extracted = queued.extracted;

    this.EmitLifecycle({
      sessionId: this.m_sessionId,
      toolCallId: extracted.callId,
      toolName: extracted.name,
      phase: "started",
    });

    const tool = this.m_registry.Resolve(extracted.name);
    if (tool === undefined)
    {
      const payload = buildToolErrorPayload(
        "tool_not_found",
        `Tool not found: ${extracted.name}`,
      );
      this.SendToolOutput(extracted.callId, payload);
      this.EmitLifecycle({
        sessionId: this.m_sessionId,
        toolCallId: extracted.callId,
        toolName: extracted.name,
        phase: "failed",
        error: payload.error,
      });
      await this.MaybeEnqueueFollowUpResponse();
      return;
    }

    let parsedArgs: unknown;
    try
    {
      parsedArgs = JSON.parse(extracted.argumentsJson);
    }
    catch (error)
    {
      const payload = buildToolErrorPayload(
        "invalid_arguments",
        "Tool arguments must be valid JSON",
        {
          message: error instanceof Error ? error.message : String(error),
        },
      );
      this.SendToolOutput(extracted.callId, payload);
      this.EmitLifecycle({
        sessionId: this.m_sessionId,
        toolCallId: extracted.callId,
        toolName: extracted.name,
        phase: "failed",
        error: payload.error,
      });
      await this.MaybeEnqueueFollowUpResponse();
      return;
    }

    const runtimeContext: ToolRuntimeContext = {
      sessionId: this.m_sessionId,
      toolCallId: extracted.callId,
      metadata: extracted.metadata,
    };

    try
    {
      const result = await tool.callback(parsedArgs, runtimeContext);
      this.SendToolOutput(extracted.callId, result);
      this.EmitLifecycle({
        sessionId: this.m_sessionId,
        toolCallId: extracted.callId,
        toolName: extracted.name,
        phase: "succeeded",
      });
      await this.MaybeEnqueueFollowUpResponse();
    }
    catch (error)
    {
      const payload = buildToolErrorPayload(
        "callback_failed",
        error instanceof Error ? error.message : "Tool callback failed",
      );
      this.SendToolOutput(extracted.callId, payload);
      this.EmitLifecycle({
        sessionId: this.m_sessionId,
        toolCallId: extracted.callId,
        toolName: extracted.name,
        phase: "failed",
        error: payload.error,
      });
      await this.MaybeEnqueueFollowUpResponse();
    }
  }

  private SendToolOutput(callId: string, outputPayload: unknown): void
  {
    const event = buildFunctionCallOutputEvent(callId, outputPayload);
    this.m_sendContext.sendOutgoingEvent(event);
  }

  private async MaybeEnqueueFollowUpResponse(): Promise<void>
  {
    if (this.m_responseAfterOutput !== "always")
    {
      return;
    }

    await this.m_sendContext.enqueueResponseCreate({ queuePolicy: "enqueue" });
  }

  private EmitLifecycle(notification: ToolLifecycleNotification): void
  {
    this.m_onToolLifecycle?.(notification);
  }
}
