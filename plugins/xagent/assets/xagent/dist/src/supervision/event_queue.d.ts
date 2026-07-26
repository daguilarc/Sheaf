import type { SupervisionEvent, SupervisionEventSink, SupervisionScheduler } from "./types.js";
export type PublishableSupervisionEvent = Omit<SupervisionEvent, "schema_version" | "run_id" | "sequence" | "timestamp">;
export type PersistedEventCommit = (event: SupervisionEvent) => Promise<void>;
export declare class SequencedEventQueue {
    #private;
    private readonly runId;
    private readonly sink;
    private readonly clock;
    private readonly scheduler;
    constructor(runId: string, sink?: SupervisionEventSink, clock?: () => Date, scheduler?: SupervisionScheduler);
    get sequence(): number;
    publish(body: PublishableSupervisionEvent, deliverable?: boolean, commit?: PersistedEventCommit): Promise<SupervisionEvent>;
    awaitEvent(afterSequence: number, deadlineMs: number, signal?: AbortSignal): Promise<SupervisionEvent | undefined>;
}
//# sourceMappingURL=event_queue.d.ts.map