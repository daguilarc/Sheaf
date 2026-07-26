import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { generateRunId, createRunRecord, appendNormalizedEvent, updateRunSupervision, type RunRecord } from "../logs.js";
import { Supervisor } from "../supervision/supervisor.js";
import type {
  AwaitResult,
  SupervisionEvent,
  SupervisionPersistenceState,
  SupervisionPolicy,
  SupervisionScheduler,
  SupervisorInspection,
} from "../supervision/types.js";
import { createAdapter } from "../adapters/index.js";
import type { HarnessAdapter } from "../adapters/types.js";
import type { HarnessName, OutputMode, ThinkingLevel } from "../events.js";
import {
  x_DefaultAwaitDeadlineSeconds,
  type StructuredToolError,
  type XagentAwaitInput,
  type XagentCloseInput,
  type XagentInspectInput,
  type XagentInterruptInput,
  type XagentMessageInput,
  type XagentStartInput,
} from "./tool_schemas.js";
import { ToolValidationError } from "./tool_schemas.js";

export type XagentRunManagerOptions = {
  readonly repoRoot: string;
  readonly logRoot: string;
  readonly adapterFactory?: (harness: HarnessName) => HarnessAdapter;
  readonly clock?: () => Date;
  readonly scheduler?: SupervisionScheduler;
  readonly policy?: SupervisionPolicy;
};

export type CreateRunOptions = {
  readonly runId?: string;
  readonly harness: HarnessName;
  readonly mode: OutputMode;
  readonly cwd: string;
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
  readonly permissionMode?: string;
  readonly policy?: SupervisionPolicy;
};

export type StartRunResult = {
  readonly run_id: string;
  readonly sequence: number;
  readonly phase: string;
};

export type InspectRunResult = {
  readonly run_id: string;
  readonly phase: string;
  readonly sequence: number;
  readonly provider_thread_id?: string;
};

export type AwaitRunResult = {
  readonly schema_version: 1;
  readonly event: string;
  readonly run_id: string;
  readonly sequence: number;
  readonly phase: string;
  readonly elapsed_ms: number;
  readonly reason?: string;
  readonly report?: { readonly text: string };
  readonly payload?: unknown;
};

export type MessageRunResult = {
  readonly run_id: string;
  readonly phase: string;
  readonly sequence: number;
};

export type InterruptRunResult = {
  readonly run_id: string;
  readonly phase: string;
  readonly sequence: number;
};

export type CloseRunResult = {
  readonly run_id: string;
  readonly closed: true;
};

type OwnedRun = {
  readonly supervisor: Supervisor;
  readonly record: RunRecord;
};

export class XagentRunManager {
  readonly #repoRoot: string;
  readonly #logRoot: string;
  readonly #adapterFactory: (harness: HarnessName) => HarnessAdapter;
  readonly #clock: () => Date;
  readonly #scheduler: SupervisionScheduler | undefined;
  readonly #defaultPolicy: SupervisionPolicy;
  readonly #runs = new Map<string, OwnedRun>();
  #closed = false;

  constructor(options: XagentRunManagerOptions) {
    this.#repoRoot = options.repoRoot;
    this.#logRoot = options.logRoot;
    this.#adapterFactory = options.adapterFactory ?? ((harness) => createAdapter(harness));
    this.#clock = options.clock ?? (() => new Date());
    this.#scheduler = options.scheduler;
    this.#defaultPolicy = options.policy ?? {
      silenceTimeoutMs: 300_000,
      watchdog: {},
    };
  }

  async create(options: CreateRunOptions): Promise<{ readonly runId: string }> {
    if (this.#closed) {
      throw new Error("XagentRunManager is closed.");
    }
    const runId = options.runId ?? generateRunId(this.#clock());
    if (this.#runs.has(runId)) {
      throw new Error(`xagent run id already in use: ${runId}`);
    }
    const record = await createRunRecord({
      repoRoot: this.#repoRoot,
      logRoot: this.#logRoot,
      runId,
      harness: options.harness,
      mode: options.mode,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      clock: this.#clock,
    });
    const adapter = this.#adapterFactory(options.harness);
    const policy = options.policy ?? this.#defaultPolicy;
    const supervisor = new Supervisor({
      runId,
      adapter,
      startOptions: {
        cwd: options.cwd,
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.thinkingLevel === undefined ? {} : { thinkingLevel: options.thinkingLevel }),
        ...(options.permissionMode === undefined ? {} : { permissionMode: options.permissionMode }),
      },
      policy,
      clock: this.#clock,
      ...(this.#scheduler === undefined ? {} : { scheduler: this.#scheduler }),
      eventSink: async (event) => {
        await appendNormalizedEvent(record, event);
      },
      metadataSink: async (state) => {
        await updateRunSupervision(record, toRunSupervisionUpdate(state));
      },
    });
    this.#runs.set(runId, { supervisor, record });
    return { runId };
  }

  start(runId: string): Promise<void> {
    return this.#require(runId).supervisor.start();
  }

  submit(runId: string, text: string): Promise<void> {
    return this.#require(runId).supervisor.submit(text);
  }

  awaitEvent(
    runId: string,
    afterSequence: number,
    deadlineMs: number,
    signal?: AbortSignal,
  ): Promise<AwaitResult> {
    return this.#require(runId).supervisor.awaitEvent(afterSequence, deadlineMs, signal);
  }

  inspect(runId: string): SupervisorInspection | undefined {
    return this.#runs.get(runId)?.supervisor.inspect();
  }

  interrupt(runId: string): Promise<void> {
    return this.#require(runId).supervisor.interrupt();
  }

  close(runId: string): Promise<void> {
    const run = this.#runs.get(runId);
    if (run === undefined) {
      return Promise.resolve();
    }
    return run.supervisor.close().finally(() => {
      this.#runs.delete(runId);
    });
  }

  has(runId: string): boolean {
    return this.#runs.has(runId);
  }

  listRunIds(): string[] {
    return [...this.#runs.keys()];
  }

  get size(): number {
    return this.#runs.size;
  }

  async closeAll(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const runs = [...this.#runs.values()];
    this.#runs.clear();
    await Promise.allSettled(runs.map((run) => run.supervisor.close()));
  }

  async startRun(input: XagentStartInput): Promise<StartRunResult> {
    const cwd = await canonicalizeWorkingDirectory(input.cwd);
    const { runId } = await this.create({
      harness: input.harness,
      mode: input.mode,
      cwd,
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.thinking_level === undefined ? {} : { thinkingLevel: input.thinking_level }),
      ...(input.permission_mode === undefined ? {} : { permissionMode: input.permission_mode }),
      ...(input.policy === undefined ? {} : { policy: input.policy }),
    });
    try {
      await this.start(runId);
      await this.submit(runId, input.prompt);
      const inspection = this.inspect(runId);
      if (inspection === undefined) {
        throw new Error(`Run disappeared after start: ${runId}`);
      }
      return {
        run_id: runId,
        sequence: inspection.sequence,
        phase: inspection.phase,
      };
    } catch (error) {
      await this.close(runId).catch(() => {});
      throw error;
    }
  }

  async awaitRun(input: XagentAwaitInput, signal?: AbortSignal): Promise<AwaitRunResult> {
    this.#require(input.run_id);
    const deadlineSeconds = input.deadline_seconds ?? x_DefaultAwaitDeadlineSeconds;
    const startedAtMs = this.#clock().getTime();
    const result = await this.awaitEvent(
      input.run_id,
      input.after_sequence,
      deadlineSeconds * 1000,
      signal,
    );
    const elapsedMs = Math.max(0, this.#clock().getTime() - startedAtMs);
    return shapeAwaitEnvelope(result, elapsedMs);
  }

  publishAttention(runId: string, reason: string, payload?: unknown): Promise<SupervisionEvent> {
    return this.#require(runId).supervisor.publishAttention(reason, payload);
  }

  inspectRun(input: XagentInspectInput): InspectRunResult {
    const inspection = this.inspect(input.run_id);
    if (inspection === undefined) {
      throw unknownRunError(input.run_id);
    }
    return {
      run_id: inspection.run_id,
      phase: inspection.phase,
      sequence: inspection.sequence,
      ...(inspection.provider_thread_id === undefined
        ? {}
        : { provider_thread_id: inspection.provider_thread_id }),
    };
  }

  async messageRun(input: XagentMessageInput): Promise<MessageRunResult> {
    await this.submit(input.run_id, input.text);
    const inspection = this.inspect(input.run_id);
    if (inspection === undefined) {
      throw unknownRunError(input.run_id);
    }
    return {
      run_id: inspection.run_id,
      phase: inspection.phase,
      sequence: inspection.sequence,
    };
  }

  async interruptRun(input: XagentInterruptInput): Promise<InterruptRunResult> {
    await this.interrupt(input.run_id);
    const inspection = this.inspect(input.run_id);
    if (inspection === undefined) {
      throw unknownRunError(input.run_id);
    }
    return {
      run_id: inspection.run_id,
      phase: inspection.phase,
      sequence: inspection.sequence,
    };
  }

  async closeRun(input: XagentCloseInput): Promise<CloseRunResult> {
    await this.close(input.run_id);
    return {
      run_id: input.run_id,
      closed: true,
    };
  }

  #require(runId: string): OwnedRun {
    const run = this.#runs.get(runId);
    if (run === undefined) {
      throw unknownRunError(runId);
    }
    return run;
  }
}

export async function canonicalizeWorkingDirectory(cwd: string): Promise<string> {
  if (!path.isAbsolute(cwd)) {
    throw invalidWorkingDirectoryError(cwd, "working directory must be an absolute path");
  }
  let info;
  try {
    info = await stat(cwd);
  } catch {
    throw invalidWorkingDirectoryError(cwd, "working directory does not exist");
  }
  if (!info.isDirectory()) {
    throw invalidWorkingDirectoryError(cwd, "working directory path is not a directory");
  }
  return realpath(cwd);
}

function invalidWorkingDirectoryError(cwd: string, message: string): ToolValidationError {
  const structured: StructuredToolError = {
    error: "invalid_working_directory",
    message,
    details: { cwd },
  };
  return new ToolValidationError(structured);
}

function unknownRunError(runId: string): ToolValidationError {
  return new ToolValidationError({
    error: "unknown_run",
    message: `Unknown xagent run: ${runId}`,
    details: { run_id: runId },
  });
}

function toRunSupervisionUpdate(state: SupervisionPersistenceState) {
  return {
    phase: state.phase,
    sequence: state.sequence,
    provider_thread_id: state.provider_thread_id,
    last_transport_progress_at: state.last_transport_progress_at,
    last_semantic_progress_at: state.last_semantic_progress_at,
    owned_process: state.owned_process,
    watchdog: state.watchdog,
  };
}

function shapeAwaitEnvelope(result: AwaitResult, elapsedMs: number): AwaitRunResult {
  const base = {
    schema_version: 1 as const,
    event: result.type,
    run_id: result.run_id,
    sequence: result.sequence,
    phase: result.phase,
    elapsed_ms: elapsedMs,
  };
  if (result.type === "turn.completed") {
    const payload = ("payload" in result ? result.payload : undefined) as
      | { readonly report?: { readonly text?: string } }
      | undefined;
    const report = payload?.report;
    if (report === undefined || report.text === undefined) {
      return {
        ...base,
        reason: "missing_final_report",
      };
    }
    return {
      ...base,
      report: { text: report.text },
    };
  }
  if (result.type === "supervision.deadline") {
    return {
      ...base,
      reason: result.reason,
    };
  }
  const reason = result.reason;
  const payload = "payload" in result ? result.payload : undefined;
  return {
    ...base,
    ...(reason === undefined ? {} : { reason }),
    ...(payload === undefined ? {} : { payload }),
  };
}
