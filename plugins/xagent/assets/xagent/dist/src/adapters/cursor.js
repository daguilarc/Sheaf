import { assertCommandAvailable, ProcessJsonlSession } from "./process_jsonl.js";
export class CursorAdapter {
    harness = "cursor";
    capabilities = {
        forwardsModel: true,
        forwardsThinkingLevel: false,
        streamsDeltas: true,
    };
    async start(options) {
        await assertCommandAvailable("cursor-agent", this.harness);
        return new ProcessJsonlSession({
            harness: this.harness,
            cwd: options.cwd,
            buildCommand: (context, state) => buildCursorCommand(context, state, options),
            parseEvent: parseCursorProviderEvent,
            // Seed the resumed thread id so buildCursorCommand emits `--resume <id>`
            // on the first turn. Without this, `--resume <id>` would silently start a
            // fresh provider thread.
            //
            ...(options.providerThreadId === undefined
                ? {}
                : { initialProviderThreadId: options.providerThreadId }),
        });
    }
}
function buildCursorCommand(context, state, options) {
    // Reset stream state at turn start so a prior interrupted turn cannot
    // poison flush detection in the next child process.
    //
    state.cursorSegmentText = "";
    state.cursorLastDelta = undefined;
    state.cursorFinalSegmentText = undefined;
    const args = ["--print", "--output-format", "stream-json", "--stream-partial-output", "--trust", "--force"];
    if (state.providerThreadId !== undefined) {
        args.push("--resume", state.providerThreadId);
    }
    if (options.model !== undefined) {
        args.push("--model", options.model);
    }
    // cursor-agent is a commander CLI; without `--`, a prompt that starts
    // with `-` is parsed as an unknown option and the turn dies at spawn.
    //
    args.push("--", context.text);
    return { command: "cursor-agent", args };
}
export function parseCursorProviderEvent(raw, context, state) {
    if (!isRecord(raw)) {
        return [];
    }
    if (typeof raw.thread_id === "string" || typeof raw.session_id === "string") {
        state.providerThreadId = stringValue(raw.thread_id ?? raw.session_id, state.providerThreadId ?? "");
    }
    const type = stringValue(raw.type ?? raw.event, "");
    if (type === "system" && stringValue(raw.subtype, "") === "init") {
        clearCursorSegment(state);
        return [];
    }
    if (type === "assistant") {
        return parseCursorAssistantEvent(raw, context, state);
    }
    if (type === "result") {
        const streamed = stringValue(raw.result ?? raw.text, extractCursorAssistantText(raw.message));
        // `result` is the whole turn's assistant stream glued together, so the
        // controller's "final report" arrived with every narration line fused onto
        // the status contract. The end-of-turn flush is the real final message;
        // fall back to `result` only when no such flush was observed.
        //
        const finalSegment = state.cursorFinalSegmentText;
        const text = finalSegment !== undefined && finalSegment.trim() !== ""
            ? finalSegment
            : streamed;
        state.cursorFinalSegmentText = undefined;
        clearCursorSegment(state);
        return [{
                type: "message.completed",
                message_id: stringValue(raw.message_id, `message_${context.inputSequence}`),
                role: "assistant",
                text,
            }, {
                type: "turn.completed",
                final_text: text,
                provider_thread_id: state.providerThreadId,
            }];
    }
    if (type === "tool_call") {
        const events = parseCursorToolCallEvent(raw, context);
        if (stringValue(raw.subtype, "") === "started") {
            // A missed pre-tool flush must not leave segment text that poisons
            // the next assistant tokens.
            //
            clearCursorSegment(state);
        }
        return events;
    }
    return [];
}
function parseCursorAssistantEvent(raw, context, state) {
    const text = extractCursorAssistantText(raw.message);
    if (text === "") {
        return [];
    }
    // cursor-agent writes each token, then flushes its buffer:
    // - before tool calls: timestamp_ms + model_call_id
    // - at turn end: neither timestamp_ms nor model_call_id
    // Some rarer sites flush with timestamp_ms only; those still match the
    // open multi-chunk segment text.
    //
    const isFinalFlush = typeof raw.timestamp_ms !== "number";
    const isToolFlush = typeof raw.model_call_id === "string";
    const segment = state.cursorSegmentText ?? "";
    const isSegmentReplay = text === segment
        && state.cursorLastDelta !== undefined
        && text !== state.cursorLastDelta;
    if (isFinalFlush || isToolFlush || isSegmentReplay) {
        // `isFinalFlush` and `isToolFlush` are computed independently, so a flush
        // carrying a model_call_id but no timestamp_ms would otherwise be mistaken
        // for the end of the turn. A replay is not excluded here: the end-of-turn
        // flush replays the accumulated segment by construction.
        //
        if (isFinalFlush && !isToolFlush) {
            state.cursorFinalSegmentText = text;
        }
        clearCursorSegment(state);
        return [];
    }
    // A new segment opened after a previous final flush, so that flush was not
    // the end of the turn after all. Drop it rather than reporting stale text.
    //
    state.cursorFinalSegmentText = undefined;
    state.cursorLastDelta = text;
    state.cursorSegmentText = `${segment}${text}`;
    return [{
            type: "message.delta",
            message_id: stringValue(raw.message_id, `message_${context.inputSequence}`),
            role: "assistant",
            delta: text,
        }];
}
function clearCursorSegment(state) {
    state.cursorSegmentText = "";
    state.cursorLastDelta = undefined;
}
function extractCursorAssistantText(value) {
    if (typeof value === "string") {
        return value;
    }
    if (!isRecord(value) || !Array.isArray(value.content)) {
        return "";
    }
    let text = "";
    for (const item of value.content) {
        if (isRecord(item) && item.type === "text" && typeof item.text === "string") {
            text += item.text;
        }
    }
    return text;
}
function parseCursorToolCallEvent(raw, context) {
    const details = extractCursorToolDetails(raw.tool_call);
    const toolCallId = stringValue(raw.call_id ?? raw.tool_call_id ?? raw.id ?? details?.toolCallId, `tool_${context.inputSequence}`);
    const name = stringValue(raw.name ?? details?.name, "tool");
    const subtype = stringValue(raw.subtype, "started");
    if (subtype === "completed") {
        const output = details?.result ?? raw.output ?? raw.result;
        const status = cursorToolStatus(output);
        const error = cursorToolError(raw, output);
        return [{
                type: "tool.completed",
                tool_call_id: toolCallId,
                name,
                status,
                output,
                ...(error === undefined ? {} : { error }),
            }];
    }
    return [{
            type: "tool.started",
            tool_call_id: toolCallId,
            name,
            input: raw.input ?? details?.args,
        }];
}
function extractCursorToolDetails(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const toolCallId = typeof value.toolCallId === "string" ? value.toolCallId : undefined;
    for (const [key, payload] of Object.entries(value)) {
        if (!key.endsWith("ToolCall") || !isRecord(payload)) {
            continue;
        }
        return {
            name: key.slice(0, -"ToolCall".length),
            args: payload.args,
            result: payload.result,
            toolCallId,
        };
    }
    if (toolCallId === undefined) {
        return undefined;
    }
    return { name: "tool", toolCallId };
}
function cursorToolStatus(output) {
    if (!isRecord(output)) {
        // A completed event with no recognizable payload is not success — fail loud.
        //
        return "failed";
    }
    if ("failure" in output || "error" in output) {
        return "failed";
    }
    return "completed";
}
function cursorToolError(raw, output) {
    if (typeof raw.error === "string") {
        return raw.error;
    }
    if (!isRecord(output)) {
        return undefined;
    }
    const failure = isRecord(output.failure)
        ? output.failure
        : isRecord(output.error)
            ? output.error
            : undefined;
    if (failure === undefined) {
        return typeof output.error === "string" ? output.error : undefined;
    }
    if (typeof failure.stderr === "string" && failure.stderr.trim() !== "") {
        return failure.stderr;
    }
    if (typeof failure.message === "string" && failure.message.trim() !== "") {
        return failure.message;
    }
    if (typeof failure.command === "string") {
        const exitCode = typeof failure.exitCode === "number" ? ` (exit ${failure.exitCode})` : "";
        return `command failed${exitCode}: ${failure.command}`;
    }
    return undefined;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringValue(value, fallback) {
    return typeof value === "string" ? value : fallback;
}
//# sourceMappingURL=cursor.js.map