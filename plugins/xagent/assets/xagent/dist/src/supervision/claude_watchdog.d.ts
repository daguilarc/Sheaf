import type { WatchdogClassifier, WatchdogRequest, WatchdogVerdict } from "./types.js";
export declare const DEFAULT_STDOUT_LIMIT_BYTES: number;
export declare const WATCHDOG_SCHEMA_JSON: string;
export type WatchdogSpawnRequest = {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly input: string;
    readonly timeoutMs: number;
    readonly outputLimitBytes: number;
    readonly signal: AbortSignal;
};
export type WatchdogSpawnResult = {
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut?: boolean;
    readonly outputTooLarge?: boolean;
    readonly budgetExceeded?: boolean;
    readonly aborted?: boolean;
};
export type WatchdogSpawn = (request: WatchdogSpawnRequest) => Promise<WatchdogSpawnResult>;
export type ClaudeWatchdogClassifierOptions = {
    readonly spawn?: WatchdogSpawn;
    readonly inputLimitBytes?: number;
    readonly outputLimitBytes?: number;
    readonly timeoutMs?: number;
    readonly maxBudgetUsd?: number;
    readonly confidenceFloor?: number;
};
export declare class ClaudeWatchdogClassifier implements WatchdogClassifier {
    #private;
    constructor(options?: ClaudeWatchdogClassifierOptions);
    classify(request: WatchdogRequest, signal: AbortSignal): Promise<WatchdogVerdict>;
}
export declare function minimumWatchdogBudgetUsd(inputLimitBytes: number, outputLimitBytes: number): number;
export declare function maximumWatchdogRunExposureUsd(maxBudgetUsd: number, maximumCalls: number): number;
export declare const spawnWatchdogProcess: WatchdogSpawn;
//# sourceMappingURL=claude_watchdog.d.ts.map