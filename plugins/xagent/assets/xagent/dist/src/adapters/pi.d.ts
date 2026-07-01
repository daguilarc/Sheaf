import type { AdapterEvent, AdapterTurnContext, HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";
import { type ProcessHarnessState } from "./process_jsonl.js";
export declare class PiAdapter implements HarnessAdapter {
    readonly harness = "pi";
    readonly capabilities: HarnessCapabilities;
    start(options: HarnessStartOptions): Promise<HarnessSession>;
}
export declare function parsePiProviderEvent(raw: unknown, context: AdapterTurnContext, state: ProcessHarnessState): AdapterEvent[];
//# sourceMappingURL=pi.d.ts.map