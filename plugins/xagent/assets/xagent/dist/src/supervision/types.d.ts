import type { OwnedProcessIdentity } from "../adapters/types.js";
import type { EvidenceSuspicionSignal, SemanticEvidenceSnapshot } from "./evidence.js";
export type SupervisionPhase = "starting" | "running" | "ready" | "completed" | "failed" | "cancelled" | "abandoned";
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
    reason: "await_deadline" | "run_terminal";
};
export type AwaitResult = SupervisionEvent | AwaitDeadline;
export type WatchdogPolicy = {
    inputLimitBytes?: number;
    outputLimitBytes?: number;
    suspicionWindowMs?: number;
    repeatedToolThreshold?: number;
    repeatedFailureThreshold?: number;
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
export type WatchdogRequest = SemanticEvidenceSnapshot & {
    readonly suspicion_signals: readonly EvidenceSuspicionSignal[];
};
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
//# sourceMappingURL=types.d.ts.map