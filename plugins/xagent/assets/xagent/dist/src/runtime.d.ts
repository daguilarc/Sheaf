import type { Readable, Writable } from "node:stream";
import type { HarnessAdapter } from "./adapters/types.js";
import { type HarnessName, type OutputMode, type ThinkingLevel } from "./events.js";
export type RunSessionOptions = {
    readonly harness: HarnessName;
    readonly mode: OutputMode;
    readonly model?: string;
    readonly thinkingLevel?: ThinkingLevel;
    readonly repoRoot: string;
    readonly logRoot?: string;
    readonly cwd: string;
    readonly stdin: Readable;
    readonly stdout: Writable;
    readonly adapter: HarnessAdapter;
    readonly runId?: string;
    readonly clock?: () => Date;
};
export type RunSessionResult = {
    readonly exitCode: number;
};
export declare function runSession(options: RunSessionOptions): Promise<RunSessionResult>;
//# sourceMappingURL=runtime.d.ts.map