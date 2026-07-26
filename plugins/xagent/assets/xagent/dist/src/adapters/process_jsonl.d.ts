import { type ChildProcessWithoutNullStreams } from "node:child_process";
import type { HarnessName } from "../events.js";
import type { AdapterEvent, AdapterTurnContext, HarnessSession, OwnedProcessIdentity } from "./types.js";
export type ProcessHarnessState = {
    providerThreadId?: string;
    providerSequence: number;
};
export type ProviderEventParser = (raw: unknown, context: AdapterTurnContext, state: ProcessHarnessState) => AdapterEvent[];
export type ProcessCommand = {
    command: string;
    args: string[];
    input?: string;
};
export type ProcessCommandBuilder = (context: AdapterTurnContext, state: ProcessHarnessState) => ProcessCommand;
export type SpawnProcess = (command: string, args: readonly string[], options: {
    cwd: string;
    detached: boolean;
}) => ChildProcessWithoutNullStreams;
export type ProcessJsonlSessionOptions = {
    readonly harness: HarnessName;
    readonly cwd: string;
    readonly buildCommand: ProcessCommandBuilder;
    readonly parseEvent: ProviderEventParser;
    readonly spawnProcess?: SpawnProcess;
    readonly terminationGraceMs?: number;
    readonly initialProviderThreadId?: string;
    readonly captureProcessIdentity?: (pid: number) => OwnedProcessIdentity | undefined;
};
export declare class ProcessJsonlSession implements HarnessSession {
    #private;
    private readonly options;
    constructor(options: ProcessJsonlSessionOptions);
    get providerThreadId(): string | undefined;
    get processIdentity(): OwnedProcessIdentity | undefined;
    submit(context: AdapterTurnContext): AsyncIterable<AdapterEvent>;
    interrupt(): Promise<void>;
    close(): Promise<void>;
}
export declare function assertCommandAvailable(command: string, harness: HarnessName): Promise<void>;
//# sourceMappingURL=process_jsonl.d.ts.map