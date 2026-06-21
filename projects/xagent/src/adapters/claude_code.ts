import type { AdapterEvent, AdapterTurnContext, HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";
import { assertCommandAvailable, ProcessJsonlSession, type ProcessHarnessState } from "./process_jsonl.js";

export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly harness = "claude_code";
  readonly capabilities: HarnessCapabilities = {
    forwardsModel: true,
    forwardsThinkingLevel: true,
    streamsDeltas: true,
  };

  async start(options: HarnessStartOptions): Promise<HarnessSession> {
    await assertCommandAvailable("claude", this.harness);
    return new ProcessJsonlSession({
      harness: this.harness,
      cwd: options.cwd,
      buildCommand: (context, state) => buildClaudeCommand(context, state, options),
      parseEvent: parseClaudeProviderEvent,
    });
  }
}

function buildClaudeCommand(
  context: AdapterTurnContext,
  state: ProcessHarnessState,
  options: HarnessStartOptions,
) {
  const args = ["--print", "--output-format", "stream-json", "--include-partial-messages", "--verbose"];
  if (state.providerThreadId !== undefined) {
    args.push("--resume", state.providerThreadId);
  }
  if (options.model !== undefined) {
    args.push("--model", options.model);
  }
  if (options.thinkingLevel !== undefined) {
    args.push("--effort", options.thinkingLevel);
  }
  args.push(context.text);
  return { command: "claude", args };
}

export function parseClaudeProviderEvent(
  raw: unknown,
  context: AdapterTurnContext,
  state: ProcessHarnessState,
): AdapterEvent[] {
  if (!isRecord(raw)) {
    return [];
  }
  if (typeof raw.session_id === "string") {
    state.providerThreadId = raw.session_id;
  }

  const type = stringValue(raw.type, "");
  if (type === "stream_event" && isRecord(raw.event)) {
    return parseClaudeStreamEvent(raw.event, context);
  }
  if (type === "result") {
    const text = stringValue(raw.result ?? raw.text, "");
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

function parseClaudeStreamEvent(event: Record<string, unknown>, context: AdapterTurnContext): AdapterEvent[] {
  if (event.type === "content_block_delta" && isRecord(event.delta)) {
    return [{
      type: "message.delta",
      message_id: stringValue(event.index, `message_${context.inputSequence}`),
      role: "assistant",
      delta: stringValue(event.delta.text, ""),
    }];
  }
  if (event.type === "content_block_start" && isRecord(event.content_block) && event.content_block.type === "tool_use") {
    return [{
      type: "tool.started",
      tool_call_id: stringValue(event.content_block.id, `tool_${context.inputSequence}`),
      name: stringValue(event.content_block.name, "tool"),
      input: event.content_block.input,
    }];
  }
  if (event.type === "content_block_stop" && isRecord(event.content_block) && event.content_block.type === "tool_result") {
    return [{
      type: "tool.completed",
      tool_call_id: stringValue(event.content_block.tool_use_id, `tool_${context.inputSequence}`),
      name: "tool",
      status: "completed",
      output: event.content_block.content,
    }];
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return fallback;
}
