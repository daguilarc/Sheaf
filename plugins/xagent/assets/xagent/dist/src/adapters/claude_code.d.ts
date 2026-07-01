import type { AdapterEvent, AdapterTurnContext, HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";
import { type ProcessHarnessState } from "./process_jsonl.js";
export declare class ClaudeCodeAdapter implements HarnessAdapter {
    readonly harness = "claude_code";
    readonly capabilities: HarnessCapabilities;
    start(options: HarnessStartOptions): Promise<HarnessSession>;
}
export declare function parseClaudeProviderEvent(raw: unknown, context: AdapterTurnContext, state: ProcessHarnessState): AdapterEvent[];
//# sourceMappingURL=claude_code.d.ts.map