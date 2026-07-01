import { createInterface } from "node:readline/promises";
import { EventSequencer, } from "./events.js";
import { createOutputFilter } from "./filter.js";
import { appendNormalizedEvent, appendRawProviderEvent, createRunRecord, generateRunId, updateRunExitStatus, } from "./logs.js";
import { parseInputLine } from "./protocol.js";
import { sanitizeValue } from "./sanitize.js";
export async function runSession(options) {
    const clock = options.clock ?? (() => new Date());
    const runId = options.runId ?? generateRunId(clock());
    let runRecord;
    try {
        runRecord = await createRunRecord({
            repoRoot: options.repoRoot,
            logRoot: options.logRoot,
            runId,
            harness: options.harness,
            mode: options.mode,
            model: options.model,
            thinkingLevel: options.thinkingLevel,
            clock,
        });
    }
    catch (error) {
        const sequencer = new EventSequencer(runId, clock);
        await writeJsonLine(options.stdout, sanitizeValue(sequencer.stamp({
            type: "error",
            code: "log_root_unavailable",
            message: error instanceof Error ? error.message : String(error),
            recoverable: false,
        }), options.repoRoot));
        await writeJsonLine(options.stdout, sanitizeValue(sequencer.stamp({
            type: "session.ended",
            reason: "log_root_unavailable",
            exit_code: 1,
        }), options.repoRoot));
        return { exitCode: 1 };
    }
    const sequencer = new EventSequencer(runRecord.run_id, clock);
    const outputFilter = createOutputFilter({ mode: options.mode, clock: { now: () => clock().getTime() } });
    let closeAttempted = false;
    let session;
    try {
        session = await startSession(options, runRecord, clock);
        await emitBody(options, runRecord, outputFilter, sequencer, {
            type: "session.started",
            harness: options.harness,
            mode: options.mode,
            model: options.model,
            thinking_level: options.thinkingLevel,
            provider_thread_id: session.providerThreadId,
        });
        for (const warning of getCapabilityWarnings(options)) {
            await emitBody(options, runRecord, outputFilter, sequencer, warning);
        }
        await emitReady(options, runRecord, outputFilter, sequencer);
        const readline = createInterface({ input: options.stdin, crlfDelay: Infinity });
        let inputSequence = 0;
        for await (const line of readline) {
            const command = parseInputLine(line);
            if (command.type === "error") {
                await emitBody(options, runRecord, outputFilter, sequencer, {
                    type: "error",
                    code: command.code,
                    message: command.message,
                    recoverable: true,
                });
                continue;
            }
            if (command.type === "control.exit") {
                break;
            }
            inputSequence += 1;
            const turnId = `turn_${inputSequence}`;
            await emitBody(options, runRecord, outputFilter, sequencer, {
                type: "turn.started",
                turn_id: turnId,
                input_sequence: inputSequence,
            });
            try {
                let lastAssistantText;
                for await (const adapterEvent of session.submit({
                    text: command.text,
                    turnId,
                    inputSequence,
                })) {
                    const { rawProvider, ...rawBody } = adapterEvent;
                    let body = withRuntimeTurnContext(rawBody, turnId);
                    if (body.type === "message.completed" && body.role === "assistant") {
                        lastAssistantText = body.text;
                    }
                    if (body.type === "turn.completed" && body.final_text === "" && lastAssistantText !== undefined) {
                        body = { ...body, final_text: lastAssistantText };
                    }
                    if (rawProvider !== undefined) {
                        await appendRawProviderEvent(runRecord, sanitizeValue(rawProvider, options.repoRoot));
                        if (body.type !== "raw.provider") {
                            await emitBody(options, runRecord, outputFilter, sequencer, {
                                type: "raw.provider",
                                harness: options.harness,
                                payload: rawProvider,
                            });
                        }
                    }
                    else if (body.type === "raw.provider") {
                        await appendRawProviderEvent(runRecord, sanitizeValue(body.payload, options.repoRoot));
                    }
                    await emitBody(options, runRecord, outputFilter, sequencer, body);
                }
            }
            catch (error) {
                await emitBody(options, runRecord, outputFilter, sequencer, {
                    type: "turn.failed",
                    turn_id: turnId,
                    code: getErrorCode(error),
                    message: error instanceof Error ? error.message : String(error),
                    provider_thread_id: session.providerThreadId,
                });
            }
            await emitReady(options, runRecord, outputFilter, sequencer);
        }
        closeAttempted = true;
        try {
            await session.close();
        }
        catch (error) {
            try {
                await emitBody(options, runRecord, outputFilter, sequencer, {
                    type: "session.ended",
                    reason: "close_failed",
                    exit_code: 1,
                });
            }
            finally {
                await updateRunExitStatus(runRecord, "failed", clock);
            }
            throw error;
        }
        await emitBody(options, runRecord, outputFilter, sequencer, {
            type: "session.ended",
            reason: "input_closed",
            exit_code: 0,
        });
        await updateRunExitStatus(runRecord, "completed", clock);
    }
    catch (error) {
        if (session === undefined) {
            try {
                await emitBody(options, runRecord, outputFilter, sequencer, {
                    type: "error",
                    code: getErrorCode(error),
                    message: error instanceof Error ? error.message : String(error),
                    recoverable: false,
                });
                await emitBody(options, runRecord, outputFilter, sequencer, {
                    type: "session.ended",
                    reason: "start_failed",
                    exit_code: 1,
                });
                await updateRunExitStatus(runRecord, "failed", clock);
                return { exitCode: 1 };
            }
            catch (startupEmitError) {
                try {
                    await updateRunExitStatus(runRecord, "failed", clock);
                }
                catch {
                    // Preserve the emit failure.
                }
                throw startupEmitError;
            }
        }
        if (session !== undefined && !closeAttempted) {
            closeAttempted = true;
            try {
                await session.close();
            }
            catch {
                // Preserve the original failure; metadata below records that the run failed.
            }
        }
        try {
            await updateRunExitStatus(runRecord, "failed", clock);
        }
        catch {
            // Preserve the original failure when metadata update itself cannot be written.
        }
        throw error;
    }
    return { exitCode: 0 };
}
function getCapabilityWarnings(options) {
    const warnings = [];
    if (options.model !== undefined && !options.adapter.capabilities.forwardsModel) {
        warnings.push({
            type: "status",
            level: "warning",
            code: "model_ignored",
            message: `${options.harness} adapter does not support forwarding --model; ignoring ${options.model}.`,
        });
    }
    if (options.thinkingLevel !== undefined && !options.adapter.capabilities.forwardsThinkingLevel) {
        warnings.push({
            type: "status",
            level: "warning",
            code: "thinking_level_ignored",
            message: `${options.harness} adapter does not support forwarding --thinking-level; ignoring ${options.thinkingLevel}.`,
        });
    }
    return warnings;
}
async function startSession(options, _runRecord, _clock) {
    return options.adapter.start({
        cwd: options.cwd,
        model: options.adapter.capabilities.forwardsModel ? options.model : undefined,
        thinkingLevel: options.adapter.capabilities.forwardsThinkingLevel ? options.thinkingLevel : undefined,
    });
}
function withRuntimeTurnContext(event, turnId) {
    const turnScopedEvent = event;
    if (isTurnScopedEvent(event) && turnScopedEvent.turn_id === undefined) {
        return { ...event, turn_id: turnId };
    }
    return event;
}
function isTurnScopedEvent(event) {
    return (event.type === "message.delta" ||
        event.type === "message.completed" ||
        event.type === "tool.started" ||
        event.type === "tool.completed" ||
        event.type === "turn.completed" ||
        event.type === "turn.failed");
}
function getErrorCode(error) {
    if (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string") {
        return error.code;
    }
    return "turn_failed";
}
async function emitReady(options, runRecord, outputFilter, sequencer) {
    await emitBody(options, runRecord, outputFilter, sequencer, {
        type: "session.ready",
        can_accept_input: true,
    });
}
async function emitBody(options, runRecord, outputFilter, sequencer, body) {
    const event = sanitizeValue(sequencer.stamp(body), options.repoRoot);
    await appendNormalizedEvent(runRecord, event);
    for (const outputEvent of outputFilter.handle(event)) {
        await writeJsonLine(options.stdout, outputEvent);
    }
}
async function writeJsonLine(stdout, event) {
    await new Promise((resolve, reject) => {
        stdout.write(`${JSON.stringify(event)}\n`, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
//# sourceMappingURL=runtime.js.map