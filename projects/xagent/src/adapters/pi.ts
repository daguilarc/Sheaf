import type { AdapterEvent, AdapterTurnContext, HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";
import { assertCommandAvailable, ProcessJsonlSession, type ProcessHarnessState } from "./process_jsonl.js";

export class PiAdapter implements HarnessAdapter {
  readonly harness = "pi";
  readonly capabilities: HarnessCapabilities = {
    forwardsModel: true,
    forwardsThinkingLevel: true,
    streamsDeltas: true,
  };

  async start(options: HarnessStartOptions): Promise<HarnessSession> {
    await assertCommandAvailable("pi", this.harness);
    return new ProcessJsonlSession({
      harness: this.harness,
      cwd: options.cwd,
      buildCommand: (context, state) => buildPiCommand(context, state, options),
      parseEvent: parsePiProviderEvent,
    });
  }
}

function buildPiCommand(
  context: AdapterTurnContext,
  state: ProcessHarnessState,
  options: HarnessStartOptions,
) {
  const args = ["-p", "--mode", "json"];
  if (state.providerThreadId !== undefined) {
    args.push("--session", state.providerThreadId);
  }
  if (options.model !== undefined) {
    args.push("--model", options.model);
  }
  if (options.thinkingLevel !== undefined) {
    args.push("--thinking-level", options.thinkingLevel);
  }
  args.push(context.text);
  return { command: "pi", args };
}

export function parsePiProviderEvent(
  raw: unknown,
  context: AdapterTurnContext,
  state: ProcessHarnessState,
): AdapterEvent[] {
  if (!isRecord(raw)) {
    return [];
  }
  if (raw.type === "session" && typeof raw.id === "string") {
    state.providerThreadId = raw.id;
    return [];
  }
  if (typeof raw.thread_id === "string" || typeof raw.session_id === "string") {
    state.providerThreadId = stringValue(raw.thread_id ?? raw.session_id, state.providerThreadId ?? "");
  }

  const type = stringValue(raw.type ?? raw.event, "");
  if (type === "message_update") {
    const assistantEvent = isRecord(raw.assistantMessageEvent) ? raw.assistantMessageEvent : undefined;
    if (assistantEvent !== undefined && assistantEvent.type !== "text_delta") {
      return [];
    }
    return [{
      type: "message.delta",
      message_id: stringValue(raw.message_id, `message_${context.inputSequence}`),
      role: "assistant",
      delta: stringValue(assistantEvent?.delta ?? raw.delta ?? raw.text, ""),
    }];
  }
  if (type === "message_end" && isRecord(raw.message)) {
    return parseMessageEnd(raw.message, context, state);
  }
  if (type === "tool_execution_start") {
    return [{
      type: "tool.started",
      tool_call_id: stringValue(raw.tool_call_id ?? raw.id, `tool_${context.inputSequence}`),
      name: stringValue(raw.name, "tool"),
      input: raw.input,
    }];
  }
  if (type === "tool_execution_end") {
    return [{
      type: "tool.completed",
      tool_call_id: stringValue(raw.tool_call_id ?? raw.id, `tool_${context.inputSequence}`),
      name: stringValue(raw.name, "tool"),
      status: raw.status === "failed" ? "failed" : "completed",
      output: raw.output,
      error: typeof raw.error === "string" ? raw.error : undefined,
    }];
  }
  if (type === "agent_end") {
    const text = stringValue(raw.final_text ?? raw.text, "");
    if (text === "") {
      return [];
    }
    return [{
      type: "message.completed",
      message_id: stringValue(raw.message_id, `message_${context.inputSequence}`),
      role: "assistant",
      text,
    }, {
      type: "turn.completed",
      final_text: text,
      usage: raw.usage,
      provider_thread_id: state.providerThreadId,
    }];
  }
  return [];
}

function parseMessageEnd(
  message: Record<string, unknown>,
  context: AdapterTurnContext,
  state: ProcessHarnessState,
): AdapterEvent[] {
  if (message.role === "toolResult") {
    return [{
      type: "tool.completed",
      tool_call_id: stringValue(message.toolCallId, `tool_${context.inputSequence}`),
      name: stringValue(message.toolName, "tool"),
      status: message.isError === true ? "failed" : "completed",
      output: extractContentText(message.content),
    }];
  }

  if (message.role !== "assistant") {
    return [];
  }

  const content = Array.isArray(message.content) ? message.content : [];
  const toolCalls = content.filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "toolCall");
  if (toolCalls.length > 0 && message.stopReason !== "stop") {
    return toolCalls.map((toolCall) => ({
      type: "tool.started",
      tool_call_id: stringValue(toolCall.id, `tool_${context.inputSequence}`),
      name: stringValue(toolCall.name, "tool"),
      input: toolCall.arguments,
    }));
  }

  const text = extractContentText(content);
  return [{
    type: "message.completed",
    message_id: stringValue(message.responseId, `message_${context.inputSequence}`),
    role: "assistant",
    text,
  }, {
    type: "turn.completed",
    final_text: text,
    usage: message.usage,
    provider_thread_id: state.providerThreadId,
  }];
}

function extractContentText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.type === "text")
    .map((item) => stringValue(item.text, ""))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
