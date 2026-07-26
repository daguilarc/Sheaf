import { assertCommandAvailable, ProcessJsonlSession } from "./process_jsonl.js";
export class CodexAdapter {
    harness = "codex";
    capabilities = {
        forwardsModel: true,
        forwardsThinkingLevel: true,
        streamsDeltas: true,
    };
    async start(options) {
        await assertCommandAvailable("codex", this.harness);
        return new ProcessJsonlSession({
            harness: this.harness,
            cwd: options.cwd,
            buildCommand: (context, state) => buildCodexCommand(context, state, options),
            parseEvent: parseCodexProviderEvent,
            // Seed the resumed thread id so buildCodexCommand emits `exec resume <id>`
            // on the first turn. Without this, `--resume <id>` would silently start a
            // fresh provider thread.
            //
            ...(options.providerThreadId === undefined
                ? {}
                : { initialProviderThreadId: options.providerThreadId }),
        });
    }
}
export function buildCodexCommand(context, state, options) {
    const args = state.providerThreadId === undefined
        ? ["exec", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"]
        : ["exec", "resume", "--json", "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"];
    if (options.model !== undefined) {
        args.push("--model", options.model);
    }
    if (options.thinkingLevel !== undefined) {
        args.push("--config", `model_reasoning_effort="${options.thinkingLevel}"`);
    }
    if (state.providerThreadId !== undefined) {
        args.push(state.providerThreadId);
    }
    args.push(context.text);
    return { command: "codex", args };
}
export function parseCodexProviderEvent(raw, context, state) {
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
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue(value, fallback) {
    return typeof value === "string" ? value : fallback;
}
//# sourceMappingURL=codex.js.map