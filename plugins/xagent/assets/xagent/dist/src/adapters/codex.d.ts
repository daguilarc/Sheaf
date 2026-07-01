import type { AdapterEvent, AdapterTurnContext, HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";
import { type ProcessHarnessState } from "./process_jsonl.js";
export declare class CodexAdapter implements HarnessAdapter {
    readonly harness = "codex";
    readonly capabilities: HarnessCapabilities;
    start(options: HarnessStartOptions): Promise<HarnessSession>;
}
export declare function buildCodexCommand(context: AdapterTurnContext, state: ProcessHarnessState, options: HarnessStartOptions): {
    command: string;
    args: string[];
};
export declare function parseCodexProviderEvent(raw: unknown, context: AdapterTurnContext, state: ProcessHarnessState): AdapterEvent[];
//# sourceMappingURL=codex.d.ts.map