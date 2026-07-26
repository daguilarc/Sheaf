import { generateRunId, createRunRecord, appendNormalizedEvent, updateRunSupervision, type RunRecord } from "../logs.js";
import { Supervisor } from "../supervision/supervisor.js";
import type {
  AwaitResult,
  SupervisionPersistenceState,
  SupervisionPolicy,
  SupervisorInspection,
} from "../supervision/types.js";
import { createAdapter } from "../adapters/index.js";
import type { HarnessAdapter } from "../adapters/types.js";
import type { HarnessName, OutputMode, ThinkingLevel } from "../events.js";

export type XagentRunManagerOptions = {
  readonly repoRoot: string;
  readonly logRoot: string;
  readonly adapterFactory?: (harness: HarnessName) => HarnessAdapter;
  readonly clock?: () => Date;
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

type OwnedRun = {
  readonly supervisor: Supervisor;
  readonly record: RunRecord;
};

export class XagentRunManager {
  readonly #repoRoot: string;
  readonly #logRoot: string;
  readonly #adapterFactory: (harness: HarnessName) => HarnessAdapter;
  readonly #clock: () => Date;
  readonly #defaultPolicy: SupervisionPolicy;
  readonly #runs = new Map<string, OwnedRun>();
  #closed = false;

  constructor(options: XagentRunManagerOptions) {
    this.#repoRoot = options.repoRoot;
    this.#logRoot = options.logRoot;
    this.#adapterFactory = options.adapterFactory ?? ((harness) => createAdapter(harness));
    this.#clock = options.clock ?? (() => new Date());
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

  #require(runId: string): OwnedRun {
    const run = this.#runs.get(runId);
    if (run === undefined) {
      throw new Error(`Unknown xagent run: ${runId}`);
    }
    return run;
  }
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
