import type {
  AdapterEvent,
  HarnessAdapter,
  HarnessSession,
  HarnessStartOptions,
} from "../adapters/types.js";
import { SequencedEventQueue } from "./event_queue.js";
import type {
  AwaitResult,
  SupervisionEvent,
  SupervisionEventSink,
  SupervisionMetadataSink,
  SupervisionPersistenceState,
  SupervisionPhase,
  SupervisionPolicy,
  SupervisionScheduler,
  SupervisorInspection,
  WatchdogAggregate,
} from "./types.js";

export type SupervisorOptions = {
  readonly runId: string;
  readonly adapter: HarnessAdapter;
  readonly startOptions: HarnessStartOptions;
  readonly policy: SupervisionPolicy;
  readonly clock?: () => Date;
  readonly scheduler?: SupervisionScheduler;
  readonly eventSink?: SupervisionEventSink;
  readonly metadataSink?: SupervisionMetadataSink;
};

const terminalPhases = new Set<SupervisionPhase>([
  "completed",
  "failed",
  "cancelled",
  "abandoned",
]);

export class Supervisor {
  readonly #runId: string;
  readonly #adapter: HarnessAdapter;
  readonly #startOptions: HarnessStartOptions;
  readonly #policy: SupervisionPolicy;
  readonly #clock: () => Date;
  readonly #metadataSink: SupervisionMetadataSink;
  readonly #events: SequencedEventQueue;
  readonly #watchdog: WatchdogAggregate = {
    invocation_count: 0,
    controller_wake_count: 0,
    deterministic_alert_count: 0,
    evidence_truncation_count: 0,
  };
  readonly #initialPersistence: Promise<void>;
  #lifecycleTail: Promise<void> = Promise.resolve();
  #phase: SupervisionPhase = "starting";
  #providerThreadId?: string;
  #session?: HarnessSession;
  #sessionClosePromise?: Promise<void>;
  #closePromise?: Promise<void>;
  #inputSequence = 0;
  #startRequested = false;
  #lastTransportProgressAt: string;
  #lastSemanticProgressAt: string;

  constructor(options: SupervisorOptions) {
    this.#runId = options.runId;
    this.#adapter = options.adapter;
    this.#startOptions = options.startOptions;
    this.#policy = options.policy;
    this.#clock = options.clock ?? (() => new Date());
    this.#metadataSink = options.metadataSink ?? (async () => {});
    const timestamp = this.#clock().toISOString();
    this.#lastTransportProgressAt = timestamp;
    this.#lastSemanticProgressAt = timestamp;
    this.#events = new SequencedEventQueue(
      this.#runId,
      options.eventSink,
      this.#clock,
      options.scheduler,
    );
    this.#initialPersistence = this.#publishState("starting", "supervisor_created", false);
  }

  inspect(): SupervisorInspection {
    return {
      run_id: this.#runId,
      phase: this.#phase,
      sequence: Math.max(1, this.#events.sequence),
      provider_thread_id: this.#providerThreadId,
    };
  }

  start(): Promise<void> {
    return this.#withLifecycleMutation(async () => {
      if (terminalPhases.has(this.#phase)) {
        throw invalidPhase("start", this.#phase);
      }
      if (this.#startRequested) {
        throw new Error("Supervisor start has already been requested.");
      }
      if (this.#phase !== "starting") {
        throw invalidPhase("start", this.#phase);
      }
      this.#startRequested = true;
      await this.#initialPersistence;
      try {
        this.#session = await this.#adapter.start(this.#startOptions);
      } catch (error) {
        await this.#publishState("failed", errorCode(error), true);
        throw error;
      }
      try {
        await this.#publishState("ready", "session_ready", true);
      } catch (error) {
        try {
          await this.#closeSessionOnce();
        } catch {
          // Preserve the persistence failure that prevented the ready commit.
        }
        throw error;
      }
    });
  }

  async submit(text: string): Promise<void> {
    const turn = await this.#withLifecycleMutation(async () => {
      if (this.#phase !== "ready" || this.#session === undefined) {
        throw invalidPhase("submit", this.#phase);
      }
      this.#inputSequence += 1;
      const inputSequence = this.#inputSequence;
      const turnId = `turn_${inputSequence}`;
      await this.#publishState("running", "turn_started", false);
      return { inputSequence, turnId, session: this.#session };
    });

    let lastAssistantText: string | undefined;
    let completed: Extract<AdapterEvent, { type: "turn.completed" }> | undefined;
    try {
      for await (const event of turn.session.submit({
        text,
        turnId: turn.turnId,
        inputSequence: turn.inputSequence,
      })) {
        if (terminalPhases.has(this.#phase)) {
          return;
        }
        this.#recordProgress(event);
        if (event.type === "message.completed" && event.role === "assistant") {
          lastAssistantText = event.text;
        }
        if (event.type === "turn.failed") {
          await this.#withLifecycleMutation(async () => {
            if (terminalPhases.has(this.#phase)) {
              return;
            }
            await this.#publishState("failed", event.code, true, {
              message: event.message,
              turn_id: turn.turnId,
            });
          });
          return;
        }
        if (event.type === "turn.completed") {
          completed = event;
        }
      }
    } catch (error) {
      if (terminalPhases.has(this.#phase)) {
        return;
      }
      await this.#withLifecycleMutation(async () => {
        if (terminalPhases.has(this.#phase)) {
          return;
        }
        await this.#publishState("failed", errorCode(error), true, {
          message: error instanceof Error ? error.message : String(error),
          turn_id: turn.turnId,
        });
      });
      return;
    }

    if (terminalPhases.has(this.#phase)) {
      return;
    }
    const reportText = completed?.final_text || lastAssistantText;
    if (completed === undefined || reportText === undefined) {
      await this.#withLifecycleMutation(async () => {
        if (terminalPhases.has(this.#phase)) {
          return;
        }
        await this.#publishState("failed", "missing_final_report", true, {
          turn_id: turn.turnId,
        });
      });
      return;
    }

    await this.#withLifecycleMutation(async () => {
      if (terminalPhases.has(this.#phase)) {
        return;
      }
      await this.#publishEvent({
        type: "turn.completed",
        phase: "ready",
        reason: "turn_completed",
        payload: {
          report: { text: reportText },
          turn_id: turn.turnId,
          provider_thread_id: completed.provider_thread_id ?? turn.session.providerThreadId,
          ...(completed.usage === undefined ? {} : { usage: completed.usage }),
        },
      }, true);
    });
  }

  async awaitEvent(
    afterSequence: number,
    deadlineMs: number,
    signal?: AbortSignal,
  ): Promise<AwaitResult> {
    const event = await this.#events.awaitEvent(afterSequence, deadlineMs, signal);
    if (event !== undefined) {
      return event;
    }
    return {
      schema_version: 1,
      type: "supervision.deadline",
      run_id: this.#runId,
      sequence: afterSequence,
      timestamp: this.#clock().toISOString(),
      phase: this.#phase,
      reason: "await_deadline",
    };
  }

  publishAttention(reason: string, payload?: unknown): Promise<SupervisionEvent> {
    return this.#withLifecycleMutation(async () => {
      if (terminalPhases.has(this.#phase)) {
        throw invalidPhase("publish attention", this.#phase);
      }
      return this.#publishEvent({
        type: "supervision.attention",
        phase: this.#phase,
        reason,
        ...(payload === undefined ? {} : { payload }),
      }, true);
    });
  }

  interrupt(): Promise<void> {
    return this.#withLifecycleMutation(async () => {
      if (this.#phase !== "running" || this.#session === undefined) {
        throw invalidPhase("interrupt", this.#phase);
      }
      if (this.#session.interrupt === undefined) {
        throw new Error("Harness session does not support interrupt.");
      }
      await this.#session.interrupt();
    });
  }

  close(): Promise<void> {
    if (this.#closePromise === undefined) {
      this.#closePromise = this.#withLifecycleMutation(async () => {
        await this.#initialPersistence;
        if (terminalPhases.has(this.#phase)) {
          return;
        }
        await this.#closeSessionOnce();
        await this.#publishState("completed", "session_closed", true);
      });
    }
    return this.#closePromise;
  }

  async #publishState(
    phase: SupervisionPhase,
    reason: string,
    deliverable: boolean,
    payload?: unknown,
  ): Promise<void> {
    await this.#publishEvent({
      type: "supervision.state",
      phase,
      reason,
      ...(payload === undefined ? {} : { payload }),
    }, deliverable);
  }

  async #publishEvent(
    body: Omit<SupervisionEvent, "schema_version" | "run_id" | "sequence" | "timestamp">,
    deliverable: boolean,
  ): Promise<SupervisionEvent> {
    this.#assertTransition(body.phase);
    const nextWatchdog = {
      ...this.#watchdog,
      controller_wake_count: this.#watchdog.controller_wake_count + (deliverable ? 1 : 0),
      deterministic_alert_count: this.#watchdog.deterministic_alert_count
        + (body.type === "supervision.attention" ? 1 : 0),
    };
    return this.#events.publish(body, deliverable, async (event) => {
      const providerThreadId = this.#session?.providerThreadId;
      await this.#metadataSink(this.#persistenceState(
        body.phase,
        event.sequence,
        providerThreadId,
        nextWatchdog,
      ));
      this.#phase = body.phase;
      this.#providerThreadId = providerThreadId;
      Object.assign(this.#watchdog, nextWatchdog);
    });
  }

  #assertTransition(next: SupervisionPhase): void {
    if (terminalPhases.has(this.#phase) && next !== this.#phase) {
      throw new Error(`Cannot transition terminal supervision phase ${this.#phase} to ${next}.`);
    }
    const allowed: Record<SupervisionPhase, readonly SupervisionPhase[]> = {
      starting: ["starting", "ready", "failed", "completed"],
      ready: ["ready", "running", "completed", "failed"],
      running: ["running", "ready", "completed", "failed", "cancelled"],
      completed: ["completed"],
      failed: ["failed"],
      cancelled: ["cancelled"],
      abandoned: ["abandoned"],
    };
    if (!allowed[this.#phase].includes(next)) {
      throw new Error(`Invalid supervision phase transition ${this.#phase} -> ${next}.`);
    }
  }

  #recordProgress(event: AdapterEvent): void {
    const timestamp = this.#clock().toISOString();
    this.#lastTransportProgressAt = timestamp;
    if (
      event.type === "message.delta"
      || event.type === "message.completed"
      || event.type === "tool.started"
      || event.type === "tool.completed"
      || event.type === "turn.completed"
      || event.type === "turn.failed"
    ) {
      this.#lastSemanticProgressAt = timestamp;
    }
  }

  #persistenceState(
    phase: SupervisionPhase,
    sequence: number,
    providerThreadId: string | undefined,
    watchdog: WatchdogAggregate,
  ): SupervisionPersistenceState {
    return {
      run_id: this.#runId,
      phase,
      sequence,
      provider_thread_id: providerThreadId,
      last_transport_progress_at: this.#lastTransportProgressAt,
      last_semantic_progress_at: this.#lastSemanticProgressAt,
      owned_process: this.#session?.ownedProcess,
      watchdog: { ...watchdog },
    };
  }

  #withLifecycleMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#lifecycleTail.then(operation);
    this.#lifecycleTail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  #closeSessionOnce(): Promise<void> {
    if (this.#session === undefined) {
      return Promise.resolve();
    }
    if (this.#sessionClosePromise === undefined) {
      this.#sessionClosePromise = this.#session.close();
    }
    return this.#sessionClosePromise;
  }
}

function invalidPhase(operation: string, phase: SupervisionPhase): Error {
  return new Error(`Cannot ${operation} while supervision phase is ${phase}.`);
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
  ) {
    return error.code;
  }
  return "supervisor_failed";
}
