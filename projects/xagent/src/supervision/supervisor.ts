import { createHash } from "node:crypto";

import type {
  AdapterEvent,
  HarnessAdapter,
  HarnessSession,
  HarnessStartOptions,
} from "../adapters/types.js";
import { sanitizeValue } from "../sanitize.js";
import { ClaudeWatchdogClassifier } from "./claude_watchdog.js";
import {
  SemanticEvidenceWindow,
  type SemanticEvidenceSnapshot,
  validateSemanticEvidencePolicy,
} from "./evidence.js";
import { SequencedEventQueue } from "./event_queue.js";
import {
  DeterministicHealthMonitor,
  type DeterministicHealthClassification,
} from "./health.js";
import { WatchdogScheduler } from "./watchdog.js";
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
  WatchdogClassifier,
  WatchdogRequest,
  WatchdogTelemetry,
  WatchdogTelemetrySink,
  WatchdogVerdict,
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
  readonly watchdogClassifier?: WatchdogClassifier;
  readonly watchdogTelemetrySink?: WatchdogTelemetrySink;
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
  readonly #health: DeterministicHealthMonitor;
  readonly #watchdogScheduler: WatchdogScheduler;
  readonly #watchdogTelemetrySink: WatchdogTelemetrySink;
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
  #interruptedTurnId?: string;
  #inputSequence = 0;
  #startRequested = false;
  #lastTransportProgressAt: string;
  #lastSemanticProgressAt: string;
  #evidence?: SemanticEvidenceWindow;
  #previousWatchdogVerdict?: {
    readonly verdict: WatchdogVerdict["verdict"];
    readonly confidence: number;
    readonly reason_code: string;
  };
  #healthCallbackFailure?: Error;
  #watchdogCallbackFailure?: Error;

  constructor(options: SupervisorOptions) {
    this.#runId = options.runId;
    this.#adapter = options.adapter;
    this.#startOptions = options.startOptions;
    this.#policy = options.policy;
    validateSemanticEvidencePolicy({
      ...(this.#policy.watchdog.inputLimitBytes === undefined
        ? {}
        : { maxInputBytes: this.#policy.watchdog.inputLimitBytes }),
      ...(this.#policy.watchdog.suspicionWindowMs === undefined
        ? {}
        : { suspicionWindowMs: this.#policy.watchdog.suspicionWindowMs }),
      ...(this.#policy.watchdog.repeatedToolThreshold === undefined
        ? {}
        : { repeatedToolThreshold: this.#policy.watchdog.repeatedToolThreshold }),
      ...(this.#policy.watchdog.repeatedFailureThreshold === undefined
        ? {}
        : { repeatedFailureThreshold: this.#policy.watchdog.repeatedFailureThreshold }),
    });
    this.#clock = options.clock ?? (() => new Date());
    this.#metadataSink = options.metadataSink ?? (async () => {});
    this.#watchdogTelemetrySink = options.watchdogTelemetrySink ?? (async () => {});
    const timestamp = this.#clock().toISOString();
    this.#lastTransportProgressAt = timestamp;
    this.#lastSemanticProgressAt = timestamp;
    this.#events = new SequencedEventQueue(
      this.#runId,
      options.eventSink,
      this.#clock,
      options.scheduler,
    );
    this.#health = new DeterministicHealthMonitor({
      silenceTimeoutMs: this.#policy.silenceTimeoutMs,
      ...(this.#policy.hardDeadlineMs === undefined
        ? {}
        : { hardDeadlineMs: this.#policy.hardDeadlineMs }),
      clock: this.#clock,
      ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
      onClassification: (classification) => {
        void this.#applyHealthClassification(classification).catch((error: unknown) => {
          this.#healthCallbackFailure = asError(error);
        });
      },
    });
    const classifier = options.watchdogClassifier ?? new ClaudeWatchdogClassifier({
      ...(this.#policy.watchdog.inputLimitBytes === undefined
        ? {}
        : { inputLimitBytes: this.#policy.watchdog.inputLimitBytes }),
      ...(this.#policy.watchdog.outputLimitBytes === undefined
        ? {}
        : { outputLimitBytes: this.#policy.watchdog.outputLimitBytes }),
      ...(this.#policy.watchdog.timeoutMs === undefined
        ? {}
        : { timeoutMs: this.#policy.watchdog.timeoutMs }),
      ...(this.#policy.watchdog.maxBudgetUsd === undefined
        ? {}
        : { maxBudgetUsd: this.#policy.watchdog.maxBudgetUsd }),
      ...(this.#policy.watchdog.confidenceFloor === undefined
        ? {}
        : { confidenceFloor: this.#policy.watchdog.confidenceFloor }),
    });
    this.#watchdogScheduler = new WatchdogScheduler({
      classifier,
      policy: this.#policy.watchdog,
      clock: this.#clock,
      ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
      onVerdict: (request, verdict, callCount, currentTurn) =>
        this.#recordWatchdogVerdict(request, verdict, callCount, currentTurn),
    });
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

  evidenceSnapshot(): SemanticEvidenceSnapshot | undefined {
    return this.#evidence?.snapshot();
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
      this.#evidence = new SemanticEvidenceWindow({
        repoRoot: this.#startOptions.cwd,
        originalPrompt: text,
        clock: this.#clock,
        ...(this.#previousWatchdogVerdict === undefined
          ? {}
          : { previousVerdict: this.#previousWatchdogVerdict }),
        ...(this.#policy.watchdog.inputLimitBytes === undefined
          ? {}
          : { maxInputBytes: this.#policy.watchdog.inputLimitBytes }),
        ...(this.#policy.watchdog.suspicionWindowMs === undefined
          ? {}
          : { suspicionWindowMs: this.#policy.watchdog.suspicionWindowMs }),
        ...(this.#policy.watchdog.repeatedToolThreshold === undefined
          ? {}
          : { repeatedToolThreshold: this.#policy.watchdog.repeatedToolThreshold }),
        ...(this.#policy.watchdog.repeatedFailureThreshold === undefined
          ? {}
          : { repeatedFailureThreshold: this.#policy.watchdog.repeatedFailureThreshold }),
      });
      this.#watchdogScheduler.resetTurn();
      this.#health.recordMechanicalEvent({ type: "provider.started" });
      return { inputSequence, turnId, session: this.#session };
    });

    try {
      let lastAssistantText: string | undefined;
      let completed: Extract<AdapterEvent, { type: "turn.completed" }> | undefined;
      let terminalFailure: {
        readonly reason: string;
        readonly payload: unknown;
      } | undefined;
      try {
        const providerEvents = turn.session.submit({
          text,
          turnId: turn.turnId,
          inputSequence: turn.inputSequence,
        });
        try {
          await this.#persistActiveProcessIdentity(turn.session);
        } catch (error) {
          await closeUnconsumedProviderTurn(providerEvents, turn.session);
          throw error;
        }
        for await (const event of providerEvents) {
          if (terminalPhases.has(this.#phase)) {
            return;
          }
          this.#recordProgress(event);
          const mechanical = mechanicalEventClassification(this.#health, event);
          if (mechanical?.kind === "attention") {
            await this.#applyHealthClassification(mechanical);
          }
          if (mechanical?.kind === "failure" && event.type !== "turn.failed") {
            terminalFailure = {
              reason: mechanical.reason,
              payload: sanitizeValue(mechanical.payload, this.#startOptions.cwd),
            };
            break;
          }
          if (event.type === "message.completed" && event.role === "assistant") {
            lastAssistantText = event.text;
          }
          if (event.type === "turn.failed") {
            terminalFailure = {
              reason: event.code,
              payload: {
                message: event.message,
                turn_id: turn.turnId,
              },
            };
            break;
          }
          if (event.type === "turn.completed") {
            completed = event;
          }
        }
      } catch (error) {
        if (terminalPhases.has(this.#phase)) {
          return;
        }
        if (
          errorCode(error) === "harness_process_interrupted"
          && this.#interruptedTurnId === turn.turnId
        ) {
          await this.#withLifecycleMutation(async () => {
            if (terminalPhases.has(this.#phase)) {
              return;
            }
            await this.#publishState("ready", "turn_interrupted", true, {
              turn_id: turn.turnId,
            });
            this.#interruptedTurnId = undefined;
          });
          return;
        }
        const transportFailure = this.#health.recordMechanicalEvent({
          type: "transport.lost",
          message: error instanceof Error ? error.message : String(error),
        });
        await this.#withLifecycleMutation(async () => {
          if (terminalPhases.has(this.#phase)) {
            return;
          }
          await this.#publishState(
            "failed",
            transportFailure?.reason ?? errorCode(error),
            true,
            sanitizeValue({
              message: error instanceof Error ? error.message : String(error),
              turn_id: turn.turnId,
            }, this.#startOptions.cwd),
          );
        });
        return;
      }

      if (terminalFailure !== undefined) {
        await this.#withLifecycleMutation(async () => {
          if (terminalPhases.has(this.#phase)) {
            return;
          }
          await this.#publishState(
            "failed",
            terminalFailure.reason,
            true,
            terminalFailure.payload,
          );
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
          this.#health.recordMechanicalEvent({
            type: "provider.failed",
            code: "missing_final_report",
            message: "Provider turn ended without a final report.",
          });
          await this.#publishState("failed", "missing_final_report", true, {
            turn_id: turn.turnId,
          });
        });
        return;
      }

      const sanitizedReport = sanitizeValue({ text: reportText }, this.#startOptions.cwd) as {
        readonly text: string;
      };
      await this.#withLifecycleMutation(async () => {
        if (terminalPhases.has(this.#phase)) {
          return;
        }
        await this.#publishEvent({
          type: "turn.completed",
          phase: "ready",
          reason: "turn_completed",
          payload: {
            report: sanitizedReport,
            turn_id: turn.turnId,
            provider_thread_id: completed.provider_thread_id ?? turn.session.providerThreadId,
            ...(completed.usage === undefined ? {} : { usage: completed.usage }),
          },
        }, true);
      });
    } finally {
      await this.#settleWatchdog();
    }
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
      this.#interruptedTurnId = `turn_${this.#inputSequence}`;
      try {
        await this.#session.interrupt();
      } catch (error) {
        this.#interruptedTurnId = undefined;
        throw error;
      }
    });
  }

  close(): Promise<void> {
    if (this.#closePromise === undefined) {
      const closeSession = this.#withLifecycleMutation(async () => {
        await this.#initialPersistence;
        if (terminalPhases.has(this.#phase)) {
          await this.#closeSessionOnce();
          return;
        }
        this.#health.recordMechanicalEvent({ type: "cancelled" });
        await this.#closeSessionOnce();
        await this.#publishState("completed", "session_closed", true);
      });
      this.#closePromise = closeSession.then(() => this.#settleWatchdog());
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
    options: {
      readonly watchdog?: WatchdogAggregate;
      readonly semanticAttention?: boolean;
      readonly commit?: (event: SupervisionEvent) => Promise<void>;
    } = {},
  ): Promise<SupervisionEvent> {
    this.#assertTransition(body.phase);
    const baseWatchdog = options.watchdog ?? this.#watchdog;
    const nextWatchdog = {
      ...baseWatchdog,
      controller_wake_count: baseWatchdog.controller_wake_count + (deliverable ? 1 : 0),
      deterministic_alert_count: baseWatchdog.deterministic_alert_count
        + (
          body.type === "supervision.attention"
          && options.semanticAttention !== true
            ? 1
            : 0
        ),
    };
    return this.#events.publish(body, deliverable, async (event) => {
      const providerThreadId = this.#session?.providerThreadId;
      await this.#metadataSink(this.#persistenceState(
        body.phase,
        event.sequence,
        providerThreadId,
        nextWatchdog,
      ));
      await options.commit?.(event);
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
    const activeSemanticEvidence = isActiveSemanticEvidence(event);
    this.#health.recordProviderActivity(activeSemanticEvidence ? "semantic" : "transport");
    this.#lastTransportProgressAt = this.#health.lastTransportActivityAt;
    this.#lastSemanticProgressAt = this.#health.lastSemanticActivityAt;
    this.#evidence?.record(event);
    if (activeSemanticEvidence && this.#evidence !== undefined) {
      void this.#watchdogScheduler
        .onActiveEvidence(this.#evidence.snapshot())
        .catch((error: unknown) => {
          this.#watchdogCallbackFailure = asError(error);
        });
    }
  }

  #recordWatchdogVerdict(
    request: WatchdogRequest,
    verdict: WatchdogVerdict,
    callCount: number,
    currentTurn: boolean,
  ): Promise<void> {
    return this.#withLifecycleMutation(async () => {
      this.#previousWatchdogVerdict = {
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        reason_code: verdict.reason_code,
      };
      this.#evidence?.recordPreviousVerdict(this.#previousWatchdogVerdict);
      const nextWatchdog = aggregateWatchdog(
        this.#watchdog,
        request,
        verdict,
        this.#watchdogScheduler.coverageExhausted,
      );
      const telemetryBase: Omit<WatchdogTelemetry, "attention_sequence"> = {
        schema_version: 1,
        timestamp: this.#clock().toISOString(),
        request_hash: createHash("sha256")
          .update(JSON.stringify(request), "utf8")
          .digest("hex"),
        input_bytes: request.input_bytes,
        output_bytes: verdict.output_bytes ?? 0,
        verdict: verdict.verdict,
        confidence: verdict.confidence,
        reason_code: verdict.reason_code,
        call_count: callCount,
        truncated: request.truncated,
        ...(verdict.usage === undefined ? {} : { usage: verdict.usage }),
        ...(verdict.estimated_cost_usd === undefined
          ? {}
          : { estimated_cost_usd: verdict.estimated_cost_usd }),
      };

      if (
        terminalPhases.has(this.#phase)
        || !currentTurn
        || verdict.verdict === "healthy"
      ) {
        await this.#metadataSink(this.#persistenceState(
          this.#phase,
          this.#events.sequence,
          this.#session?.providerThreadId,
          nextWatchdog,
        ));
        await this.#watchdogTelemetrySink(telemetryBase);
        Object.assign(this.#watchdog, nextWatchdog);
        return;
      }

      await this.#publishEvent({
        type: "supervision.attention",
        phase: this.#phase,
        reason: `watchdog_${verdict.verdict}`,
        payload: sanitizeValue({
          verdict: verdict.verdict,
          confidence: verdict.confidence,
          reason_code: verdict.reason_code,
          evidence: verdict.evidence,
        }, this.#startOptions.cwd),
      }, true, {
        watchdog: nextWatchdog,
        semanticAttention: true,
        commit: async (event) => {
          await this.#watchdogTelemetrySink({
            ...telemetryBase,
            attention_sequence: event.sequence,
          });
        },
      });
    });
  }

  #applyHealthClassification(
    classification: DeterministicHealthClassification,
  ): Promise<void> {
    if (classification.kind !== "attention") {
      return Promise.resolve();
    }
    return this.publishAttention(
      classification.reason,
      sanitizeValue(classification.payload, this.#startOptions.cwd),
    ).then(() => {});
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
      owned_process: this.#session?.processIdentity,
      watchdog: { ...watchdog },
    };
  }

  #persistActiveProcessIdentity(session: HarnessSession): Promise<void> {
    if (session.processIdentity === undefined) {
      return Promise.resolve();
    }
    return this.#withLifecycleMutation(async () => {
      if (this.#phase !== "running" || this.#session !== session) {
        return;
      }
      await this.#metadataSink(this.#persistenceState(
        this.#phase,
        this.#events.sequence,
        session.providerThreadId,
        this.#watchdog,
      ));
    });
  }

  #withLifecycleMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#lifecycleTail.then(operation);
    this.#lifecycleTail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  async #settleWatchdog(): Promise<void> {
    try {
      await this.#watchdogScheduler.settle();
    } catch (error) {
      this.#watchdogCallbackFailure = asError(error);
    }
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

async function closeUnconsumedProviderTurn(
  events: AsyncIterable<AdapterEvent>,
  session: HarnessSession,
): Promise<void> {
  const iterator = events[Symbol.asyncIterator]();
  const cleanup: Promise<unknown>[] = [];
  if (session.processIdentity !== undefined && session.interrupt !== undefined) {
    cleanup.push(session.interrupt());
  }
  if (iterator.return !== undefined) {
    cleanup.push(iterator.return());
  }
  await Promise.allSettled(cleanup);
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

function mechanicalEventClassification(
  monitor: DeterministicHealthMonitor,
  event: AdapterEvent,
): DeterministicHealthClassification | undefined {
  if (event.type === "turn.completed") {
    return monitor.recordMechanicalEvent({ type: "provider.completed" });
  }
  if (event.type === "turn.failed") {
    return monitor.recordMechanicalEvent({
      type: "provider.failed",
      code: event.code,
      message: event.message,
    });
  }
  if (event.type !== "status" && event.type !== "error") {
    return undefined;
  }
  if (event.code === "input_required") {
    return monitor.recordMechanicalEvent({
      type: "input.required",
      prompt: event.message,
    });
  }
  if (event.code === "permission_required") {
    return monitor.recordMechanicalEvent({
      type: "permission.required",
      permission: permissionFromDetails(event.details),
    });
  }
  if (event.code === "transport_lost" || event.code === "transport_loss") {
    return monitor.recordMechanicalEvent({
      type: "transport.lost",
      message: event.message,
    });
  }
  return undefined;
}

function isActiveSemanticEvidence(event: AdapterEvent): boolean {
  return event.type === "message.delta"
    || event.type === "message.completed"
    || event.type === "tool.started"
    || event.type === "tool.completed";
}

function aggregateWatchdog(
  current: WatchdogAggregate,
  request: WatchdogRequest,
  verdict: WatchdogVerdict,
  coverageExhausted: boolean,
): WatchdogAggregate {
  const inputTokens = sumOptional(current.input_tokens, verdict.usage?.input_tokens);
  const outputTokens = sumOptional(current.output_tokens, verdict.usage?.output_tokens);
  const estimatedCost = sumOptional(
    current.estimated_cost_usd,
    verdict.estimated_cost_usd,
  );
  return {
    ...current,
    invocation_count: current.invocation_count + 1,
    evidence_truncation_count: current.evidence_truncation_count
      + (request.truncated ? 1 : 0),
    last_verdict: verdict.verdict,
    ...(coverageExhausted ? { coverage_exhausted: true } : {}),
    ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
    ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
    ...(estimatedCost === undefined ? {} : { estimated_cost_usd: estimatedCost }),
  };
}

function sumOptional(left: number | undefined, right: number | undefined): number | undefined {
  return left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
}

function permissionFromDetails(details: unknown): string | undefined {
  if (
    typeof details === "object"
    && details !== null
    && "permission" in details
    && typeof details.permission === "string"
  ) {
    return details.permission;
  }
  return undefined;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
