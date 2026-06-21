import type { AdapterEvent, AdapterTurnContext, HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";
import { assertCommandAvailable, ProcessJsonlSession, type ProcessHarnessState } from "./process_jsonl.js";

export class CursorAdapter implements HarnessAdapter {
  readonly harness = "cursor";
  readonly capabilities: HarnessCapabilities = {
    forwardsModel: true,
    forwardsThinkingLevel: false,
    streamsDeltas: true,
  };

  async start(options: HarnessStartOptions): Promise<HarnessSession> {
    await assertCommandAvailable("cursor-agent", this.harness);
    return new ProcessJsonlSession({
      harness: this.harness,
      cwd: options.cwd,
      buildCommand: (context, state) => buildCursorCommand(context, state, options),
      parseEvent: parseCursorProviderEvent,
    });
  }
}

function buildCursorCommand(
  context: AdapterTurnContext,
  state: ProcessHarnessState,
  options: HarnessStartOptions,
) {
  const args = ["--print", "--output-format", "stream-json", "--stream-partial-output", "--trust"];
  if (state.providerThreadId !== undefined) {
    args.push("--resume", state.providerThreadId);
  }
  if (options.model !== undefined) {
    args.push("--model", options.model);
  }
  args.push(context.text);
  return { command: "cursor-agent", args };
}

export function parseCursorProviderEvent(
  raw: unknown,
  context: AdapterTurnContext,
  state: ProcessHarnessState,
): AdapterEvent[] {
  if (!isRecord(raw)) {
    return [];
  }

  if (typeof raw.thread_id === "string" || typeof raw.session_id === "string") {
    state.providerThreadId = stringValue(raw.thread_id ?? raw.session_id, state.providerThreadId ?? "");
  }

  const type = stringValue(raw.type ?? raw.event, "");
  if (type === "assistant_delta" || type === "message.delta") {
    return [{
      type: "message.delta",
      message_id: stringValue(raw.message_id, `message_${context.inputSequence}`),
      role: "assistant",
      delta: stringValue(raw.delta ?? raw.text, ""),
    }];
  }
  if (type === "assistant_message" || type === "message.completed" || type === "result") {
    return [{
      type: "message.completed",
      message_id: stringValue(raw.message_id, `message_${context.inputSequence}`),
      role: "assistant",
      text: stringValue(raw.text ?? raw.message ?? raw.result, ""),
    }, {
      type: "turn.completed",
      final_text: stringValue(raw.text ?? raw.message ?? raw.result, ""),
      provider_thread_id: state.providerThreadId,
    }];
  }
  if (type === "tool_call" || type === "tool.started") {
    return [{
      type: "tool.started",
      tool_call_id: stringValue(raw.tool_call_id ?? raw.id, `tool_${context.inputSequence}`),
      name: stringValue(raw.name, "tool"),
      input: raw.input,
    }];
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
