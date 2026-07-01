import type { AdapterEvent, AdapterTurnContext, HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";
import { type ProcessHarnessState } from "./process_jsonl.js";
export declare class CursorAdapter implements HarnessAdapter {
    readonly harness = "cursor";
    readonly capabilities: HarnessCapabilities;
    start(options: HarnessStartOptions): Promise<HarnessSession>;
}
export declare function parseCursorProviderEvent(raw: unknown, context: AdapterTurnContext, state: ProcessHarnessState): AdapterEvent[];
//# sourceMappingURL=cursor.d.ts.map