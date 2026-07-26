import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

import type { AdapterEvent, HarnessAdapter, HarnessStartOptions } from "./adapters/types.js";
import {
  EventSequencer,
  type HarnessName,
  type OutputEvent,
  type OutputEventBody,
  type OutputMode,
  type ThinkingLevel,
} from "./events.js";
import { createOutputFilter } from "./filter.js";
import {
  appendNormalizedEvent,
  appendRawProviderEvent,
  createRunRecord,
  generateRunId,
  updateRunExitStatus,
  type RunRecord,
} from "./logs.js";
import { parseInputLine } from "./protocol.js";
import { sanitizeValue } from "./sanitize.js";

export type RunSessionOptions = {
  readonly harness: HarnessName;
  readonly mode: OutputMode;
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly permissionMode?: string;
  readonly repoRoot: string;
  readonly logRoot?: string;
  readonly cwd: string;
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly adapter: HarnessAdapter;
  readonly runId?: string;
  readonly clock?: () => Date;
};

export type RunSessionResult = {
  readonly exitCode: number;
};

export async function runSession(options: RunSessionOptions): Promise<RunSessionResult> {
  const clock = options.clock ?? (() => new Date());
  const runId = options.runId ?? generateRunId(clock());
  let runRecord: RunRecord;
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
  } catch (error) {
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
  let session: Awaited<ReturnType<typeof startSession>> | undefined;

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
        let lastAssistantText: string | undefined;
        let processExitError: { code?: string; message?: string; details?: unknown } | undefined;
        for await (const adapterEvent of session.submit({
          text: command.text,
          turnId,
          inputSequence,
        })) {
          const { rawProvider, ...rawBody } = adapterEvent;
          let body = withRuntimeTurnContext(rawBody, turnId);
          // The legacy runtime contract emits turn.failed when a provider
          // process crashes mid-turn. process_jsonl.ts now yields a
          // structured { type: "error", code: "process_exit" } event instead
          // of throwing, so capture it here and emit a matching turn.failed
          // after the iterator ends. The supervised path consumes the same
          // event directly via the supervisor's process.exited
          // classification, so this remap is legacy-only.
          //
          if (body.type === "error" && (body as { code?: string }).code === "process_exit") {
            const errorBody = body as { code: string; message: string; details?: unknown };
            processExitError = {
              code: "harness_process_failed",
              message: errorBody.message,
              details: errorBody.details,
            };
          }
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
          } else if (body.type === "raw.provider") {
            await appendRawProviderEvent(runRecord, sanitizeValue(body.payload, options.repoRoot));
          }
          await emitBody(options, runRecord, outputFilter, sequencer, body);
        }
        if (processExitError !== undefined) {
          await emitBody(options, runRecord, outputFilter, sequencer, {
            type: "turn.failed",
            turn_id: turnId,
            code: processExitError.code ?? "harness_process_failed",
            message: processExitError.message ?? "provider process exited",
            ...(processExitError.details === undefined ? {} : { details: processExitError.details }),
            provider_thread_id: session.providerThreadId,
          });
        }
      } catch (error) {
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
    } catch (error) {
      try {
        await emitBody(options, runRecord, outputFilter, sequencer, {
          type: "session.ended",
          reason: "close_failed",
          exit_code: 1,
        });
      } finally {
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
  } catch (error) {
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
      } catch (startupEmitError) {
        try {
          await updateRunExitStatus(runRecord, "failed", clock);
        } catch {
          // Preserve the emit failure.
        }
        throw startupEmitError;
      }
    }

    if (session !== undefined && !closeAttempted) {
      closeAttempted = true;
      try {
        await session.close();
      } catch {
        // Preserve the original failure; metadata below records that the run failed.
      }
    }
    try {
      await updateRunExitStatus(runRecord, "failed", clock);
    } catch {
      // Preserve the original failure when metadata update itself cannot be written.
    }
    throw error;
  }

  return { exitCode: 0 };
}

function getCapabilityWarnings(options: RunSessionOptions): OutputEventBody[] {
  const warnings: OutputEventBody[] = [];
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

async function startSession(
  options: RunSessionOptions,
  _runRecord: RunRecord,
  _clock: () => Date,
) {
  const startOptions: HarnessStartOptions = {
    cwd: options.cwd,
    model: options.adapter.capabilities.forwardsModel ? options.model : undefined,
    thinkingLevel: options.adapter.capabilities.forwardsThinkingLevel ? options.thinkingLevel : undefined,
    ...(options.permissionMode === undefined ? {} : { permissionMode: options.permissionMode }),
  };
  return options.adapter.start(startOptions);
}

function withRuntimeTurnContext(event: Omit<AdapterEvent, "rawProvider">, turnId: string): OutputEventBody {
  const turnScopedEvent = event as Omit<AdapterEvent, "rawProvider"> & { turn_id?: string };
  if (isTurnScopedEvent(event) && turnScopedEvent.turn_id === undefined) {
    return { ...event, turn_id: turnId } as OutputEventBody;
  }
  return event as OutputEventBody;
}

function isTurnScopedEvent(event: Omit<AdapterEvent, "rawProvider">): boolean {
  return (
    event.type === "message.delta" ||
    event.type === "message.completed" ||
    event.type === "tool.started" ||
    event.type === "tool.completed" ||
    event.type === "turn.completed" ||
    event.type === "turn.failed"
  );
}

function getErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "turn_failed";
}

async function emitReady(
  options: RunSessionOptions,
  runRecord: RunRecord,
  outputFilter: ReturnType<typeof createOutputFilter>,
  sequencer: EventSequencer,
): Promise<void> {
  await emitBody(options, runRecord, outputFilter, sequencer, {
    type: "session.ready",
    can_accept_input: true,
  });
}

async function emitBody(
  options: RunSessionOptions,
  runRecord: RunRecord,
  outputFilter: ReturnType<typeof createOutputFilter>,
  sequencer: EventSequencer,
  body: OutputEventBody,
): Promise<void> {
  const event = sanitizeValue(sequencer.stamp(body), options.repoRoot);
  await appendNormalizedEvent(runRecord, event);
  for (const outputEvent of outputFilter.handle(event)) {
    await writeJsonLine(options.stdout, outputEvent);
  }
}

async function writeJsonLine(stdout: Writable, event: OutputEvent): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stdout.write(`${JSON.stringify(event)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
