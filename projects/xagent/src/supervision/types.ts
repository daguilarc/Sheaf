import type { OwnedProcessIdentity } from "../adapters/types.js";

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
  type: "supervision.state" | "supervision.attention" | "turn.completed";
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
  reason: "await_deadline";
};

export type AwaitResult = SupervisionEvent | AwaitDeadline;

export type WatchdogPolicy = Record<string, never>;

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
};

export type SupervisionPersistenceState = SupervisorInspection & {
  last_transport_progress_at: string;
  last_semantic_progress_at: string;
  owned_process?: OwnedProcessIdentity;
  watchdog: WatchdogAggregate;
};

export type SupervisionEventSink = (event: SupervisionEvent) => Promise<void>;
export type SupervisionMetadataSink = (state: SupervisionPersistenceState) => Promise<void>;

export type SupervisionScheduler = {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};
