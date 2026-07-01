import { Readable, type Writable } from "node:stream";
import { type HarnessName, type OutputMode, type ThinkingLevel } from "./events.js";
import type { HarnessAdapter } from "./adapters/types.js";
export type CliCommand = {
    command: "run";
    harness: HarnessName;
    mode: OutputMode;
    model?: string;
    thinkingLevel?: ThinkingLevel;
    initialMessage?: string;
} | {
    command: "list";
} | {
    command: "logs";
    runId: string;
} | {
    command: "help";
    topic?: "run";
};
export type CliResult = {
    readonly exitCode: number;
};
export type CliDependencies = {
    readonly createAdapter?: (harness: HarnessName) => HarnessAdapter;
};
export declare function parseArgs(argv: string[]): CliCommand;
export declare function main(argv: string[], stdin: Readable, stdout: Writable, stderr: Writable, cwd: string, dependencies?: CliDependencies): Promise<CliResult>;
export declare function runCli(argv: string[], stdin: Readable, stdout: Writable, stderr: Writable, cwd: string, dependencies?: CliDependencies): Promise<CliResult>;
//# sourceMappingURL=cli.d.ts.map