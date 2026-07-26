import type { SupervisionScheduler, WatchdogClassifier, WatchdogPolicy, WatchdogRequest, WatchdogVerdict } from "./types.js";
export type WatchdogSchedulerOptions = {
    readonly classifier: WatchdogClassifier;
    readonly policy?: WatchdogPolicy;
    readonly clock?: () => Date;
    readonly scheduler?: SupervisionScheduler;
    readonly onVerdict?: (request: WatchdogRequest, verdict: WatchdogVerdict, callCount: number, currentTurn: boolean) => Promise<void> | void;
};
export declare class WatchdogScheduler {
    #private;
    constructor(options: WatchdogSchedulerOptions);
    get callsUsed(): number;
    get coverageExhausted(): boolean;
    resetTurn(): void;
    settle(): Promise<void>;
    onActiveEvidence(request: WatchdogRequest): Promise<void>;
}
export declare function normalizeWatchdogVerdict(value: unknown, confidenceFloor?: number): WatchdogVerdict;
//# sourceMappingURL=watchdog.d.ts.map