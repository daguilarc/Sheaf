import type { AdapterEvent, AdapterTurnContext, HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";
import { assertCommandAvailable, ProcessJsonlSession, type ProcessHarnessState } from "./process_jsonl.js";

export class CodexAdapter implements HarnessAdapter {
  readonly harness = "codex";
  readonly capabilities: HarnessCapabilities = {
    forwardsModel: true,
    forwardsThinkingLevel: true,
    streamsDeltas: true,
  };

  async start(options: HarnessStartOptions): Promise<HarnessSession> {
    await assertCommandAvailable("codex", this.harness);
    return new ProcessJsonlSession({
      harness: this.harness,
      cwd: options.cwd,
      buildCommand: (context, state) => buildCodexCommand(context, state, options),
      parseEvent: parseCodexProviderEvent,
    });
  }
}

function buildCodexCommand(
  context: AdapterTurnContext,
  state: ProcessHarnessState,
  options: HarnessStartOptions,
) {
  const args = state.providerThreadId === undefined
    ? ["exec", "--json", "--skip-git-repo-check"]
    : ["exec", "resume", "--json", "--skip-git-repo-check"];
  if (options.model !== undefined) {
    args.push("--model", options.model);
  }
  if (options.thinkingLevel !== undefined) {
    args.push("--reasoning-effort", options.thinkingLevel);
  }
  if (state.providerThreadId !== undefined) {
    args.push(state.providerThreadId);
  }
  args.push(context.text);
  return { command: "codex", args };
}

export function parseCodexProviderEvent(
  raw: unknown,
  context: AdapterTurnContext,
  state: ProcessHarnessState,
): AdapterEvent[] {
  if (!isRecord(raw)) {
    return [];
  }

  if (raw.type === "thread.started" && typeof raw.thread_id === "string") {
    state.providerThreadId = raw.thread_id;
    return [];
  }

  if (raw.type === "item.completed" && isRecord(raw.item)) {
    const item = raw.item;
    if (item.type === "agent_message") {
      return [{
        type: "message.completed",
        message_id: stringValue(item.id, `message_${context.inputSequence}`),
        role: "assistant",
        text: stringValue(item.text ?? item.content, ""),
      }];
    }
    if (item.type === "command_execution") {
      return [{
        type: "tool.completed",
        tool_call_id: stringValue(item.id, `tool_${context.inputSequence}`),
        name: stringValue(item.name ?? item.command, "command_execution"),
        status: item.exit_code === 0 || item.status === "completed" ? "completed" : "failed",
        output: item.output,
        error: typeof item.error === "string" ? item.error : undefined,
      }];
    }
  }

  if (raw.type === "item.started" && isRecord(raw.item) && raw.item.type === "command_execution") {
    return [{
      type: "tool.started",
      tool_call_id: stringValue(raw.item.id, `tool_${context.inputSequence}`),
      name: stringValue(raw.item.name ?? raw.item.command, "command_execution"),
      input: raw.item.command ?? raw.item.input,
    }];
  }

  if (raw.type === "turn.completed") {
    return [{
      type: "turn.completed",
      final_text: stringValue(raw.final_text ?? raw.output, ""),
      usage: raw.usage,
      provider_thread_id: state.providerThreadId,
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
