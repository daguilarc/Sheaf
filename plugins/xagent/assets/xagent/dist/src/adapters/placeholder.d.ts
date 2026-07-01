import type { HarnessName } from "../events.js";
import type { HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";
export declare class PlaceholderHarnessAdapter implements HarnessAdapter {
    readonly harness: HarnessName;
    readonly capabilities: HarnessCapabilities;
    constructor(harness: HarnessName);
    start(_options: HarnessStartOptions): Promise<HarnessSession>;
}
//# sourceMappingURL=placeholder.d.ts.map