import type { SupervisionScheduler } from "./types.js";
export type ProviderActivityKind = "transport" | "semantic";
export type MechanicalHealthEvent = {
    readonly type: "process.spawned";
} | {
    readonly type: "process.exited";
    readonly exitCode: number | null;
    readonly signal: string | null;
    readonly message?: string;
} | {
    readonly type: "provider.started";
} | {
    readonly type: "provider.completed";
} | {
    readonly type: "provider.failed";
    readonly code: string;
    readonly message: string;
} | {
    readonly type: "transport.lost";
    readonly message: string;
} | {
    readonly type: "input.required";
    readonly prompt?: string;
} | {
    readonly type: "permission.required";
    readonly permission?: string;
} | {
    readonly type: "cancelled";
};
export type DeterministicHealthClassification = {
    readonly kind: "completion" | "failure" | "attention" | "cancellation";
    readonly reason: string;
    readonly payload?: unknown;
};
export type DeterministicDeadline = {
    readonly reason: "silence_timeout" | "hard_deadline";
    readonly at: string;
};
export type DeterministicHealthMonitorOptions = {
    readonly silenceTimeoutMs: number;
    readonly hardDeadlineMs?: number;
    readonly clock?: () => Date;
    readonly scheduler?: SupervisionScheduler;
    readonly onClassification: (classification: DeterministicHealthClassification) => void;
};
export declare class DeterministicHealthMonitor {
    #private;
    constructor(options: DeterministicHealthMonitorOptions);
    get lastTransportActivityAt(): string;
    get lastSemanticActivityAt(): string;
    recordProviderActivity(kind: ProviderActivityKind): void;
    recordMechanicalEvent(event: MechanicalHealthEvent): DeterministicHealthClassification | undefined;
    nextDeadline(): DeterministicDeadline | undefined;
}
//# sourceMappingURL=health.d.ts.map