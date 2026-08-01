import type { HarnessAdapter, HarnessStartOptions } from "../adapters/types.js";
import { type ProviderJsonEvidenceSnapshot } from "./evidence.js";
import type { AwaitResult, SupervisionEvent, SupervisionEventSink, SupervisionMetadataSink, SupervisionPolicy, SupervisionScheduler, SupervisorInspection, WatchdogClassifier, WatchdogTelemetrySink } from "./types.js";
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
    readonly providerTranscriptSink?: (raw: unknown) => Promise<void>;
};
export declare class Supervisor {
    #private;
    constructor(options: SupervisorOptions);
    inspect(): SupervisorInspection;
    isVouching(): boolean;
    evidenceSnapshot(): ProviderJsonEvidenceSnapshot | undefined;
    start(): Promise<void>;
    submit(text: string): Promise<void>;
    awaitEvent(afterSequence: number, deadlineMs: number, signal?: AbortSignal): Promise<AwaitResult>;
    publishAttention(reason: string, payload?: unknown): Promise<SupervisionEvent>;
    interrupt(): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=supervisor.d.ts.map