import type { HarnessName, OutputEvent, OutputMode, ThinkingLevel } from "./events.js";
export type RunMetadata = {
    run_id: string;
    harness: HarnessName;
    mode: OutputMode;
    model?: string;
    thinking_level?: ThinkingLevel;
    created_at: string;
    updated_at: string;
    exit_status: "running" | "completed" | "failed";
    paths: {
        run_dir: string;
        metadata: string;
        normalized: string;
        raw_provider: string;
    };
};
export type RunRecord = RunMetadata & {
    runDir: string;
    metadataPath: string;
    normalizedLogPath: string;
    rawProviderLogPath: string;
};
export type CreateRunRecordOptions = {
    readonly repoRoot: string;
    readonly logRoot?: string;
    readonly harness: HarnessName;
    readonly mode: OutputMode;
    readonly model?: string;
    readonly thinkingLevel?: ThinkingLevel;
    readonly runId?: string;
    readonly clock?: () => Date;
};
export declare function createRunRecord(options: CreateRunRecordOptions): Promise<RunRecord>;
export declare function appendNormalizedEvent(record: RunRecord, event: OutputEvent): Promise<void>;
export declare function appendRawProviderEvent(record: RunRecord, event: unknown): Promise<void>;
export declare function updateRunExitStatus(record: RunRecord, exitStatus: RunMetadata["exit_status"], clock?: () => Date): Promise<void>;
export declare function listRuns(logRoot: string): Promise<RunMetadata[]>;
export declare function readNormalizedLog(logRoot: string, runId: string): Promise<string>;
export declare function generateRunId(date?: Date): string;
export declare function getDefaultLogRoot(repoRoot: string): string;
//# sourceMappingURL=logs.d.ts.map