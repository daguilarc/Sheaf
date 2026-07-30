import type { OwnedProcessIdentity } from "../adapters/types.js";
import type { ProviderJsonEvidenceSnapshot } from "./evidence.js";

export type SupervisionPhase =
  | "starting"
  | "running"
  | "ready"
  | "completed"
  | "failed"
  | "cancelled"
  | "abandoned";

export type SupervisionEvent = {
  schema_version: 1;
  type: "supervision.state" | "supervision.attention" | "turn.completed" | "turn.submitted";
  run_id: string;
  sequence: number;
  timestamp: string;
  phase: SupervisionPhase;
  reason: string;
  payload?: unknown;
};

export type AwaitDeadline = {
  schema_version: 1;
  type: "supervision.deadline";
  run_id: string;
  sequence: number;
  timestamp: string;
  phase: SupervisionPhase;
  // `await_deadline` is the normal chunk-expired outcome: the server held the
  // connection for the requested chunk and no wake arrived. `run_terminal` is
  // returned by the persisted path when the run is already in a terminal phase
  // and no wake exists after the cursor — the deadline was never reached, so
  // the caller must treat it as a terminal stop rather than a reason to loop.
  //
  reason: "await_deadline" | "run_terminal";
};

export type AwaitResult = SupervisionEvent | AwaitDeadline;

export type WatchdogPolicy = {
  inputLimitBytes?: number;
  outputLimitBytes?: number;
  cadenceMs?: readonly number[];
  minimumIntervalMs?: number;
  maximumCalls?: number;
  confidenceFloor?: number;
  timeoutMs?: number;
  maxBudgetUsd?: number;
};

export type SupervisionPolicy = {
  silenceTimeoutMs: number;
  hardDeadlineMs?: number;
  watchdog: WatchdogPolicy;
};

export type SupervisorInspection = {
  run_id: string;
  phase: SupervisionPhase;
  sequence: number;
  provider_thread_id: string | undefined;
  callback_failure?: {
    source: "health_callback" | "watchdog_callback";
    message: string;
  };
};

export type WatchdogAggregate = {
  invocation_count: number;
  controller_wake_count: number;
  deterministic_alert_count: number;
  evidence_truncation_count: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  last_verdict?: "healthy" | "derailed" | "uncertain";
  coverage_exhausted?: boolean;
};

export type WatchdogRequest = ProviderJsonEvidenceSnapshot;

export type WatchdogUsage = {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
};

export type WatchdogVerdict = {
  readonly verdict: "healthy" | "derailed" | "uncertain";
  readonly confidence: number;
  readonly reason_code: string;
  readonly evidence: readonly string[];
  readonly usage?: WatchdogUsage;
  readonly estimated_cost_usd?: number;
  readonly output_bytes?: number;
};

export type WatchdogClassifier = {
  classify(request: WatchdogRequest, signal: AbortSignal): Promise<WatchdogVerdict>;
};

export type WatchdogTelemetry = {
  readonly schema_version: 1;
  readonly timestamp: string;
  readonly request_hash: string;
  readonly input_bytes: number;
  readonly output_bytes: number;
  readonly verdict: WatchdogVerdict["verdict"];
  readonly confidence: number;
  readonly reason_code: string;
  readonly call_count: number;
  readonly truncated: boolean;
  // Elapsed milliseconds from turn start to the watchdog invocation that
  // produced this verdict. xas-10 requires telemetry sufficient to compute
  // detection latency ("time since the triggering evidence"); `elapsed_ms`
  // is the value embedded in the `WatchdogRequest` (and folded into
  // `request_hash`), surfaced here so analysts can recover it from
  // `watchdog.jsonl` without re-deriving the request.
  //
  readonly elapsed_ms: number;
  readonly attention_sequence?: number;
  readonly usage?: WatchdogUsage;
  readonly estimated_cost_usd?: number;
};

export type SupervisionPersistenceState = SupervisorInspection & {
  last_transport_progress_at: string;
  last_semantic_progress_at: string;
  owned_process?: OwnedProcessIdentity;
  watchdog: WatchdogAggregate;
};

export type SupervisionEventSink = (event: SupervisionEvent) => Promise<void>;
export type SupervisionMetadataSink = (state: SupervisionPersistenceState) => Promise<void>;
export type WatchdogTelemetrySink = (telemetry: WatchdogTelemetry) => Promise<void>;

export type SupervisionScheduler = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};
