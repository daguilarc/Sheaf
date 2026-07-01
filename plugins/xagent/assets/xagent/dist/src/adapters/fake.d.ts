import type { AdapterTurnContext, HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions } from "./types.js";
export type FakeHarnessAdapterOptions = {
    readonly includeToolEvents?: boolean;
    readonly includeRawProvider?: boolean;
    readonly includeDeltas?: boolean;
};
export declare class FakeHarnessAdapter implements HarnessAdapter {
    readonly options: FakeHarnessAdapterOptions;
    readonly harness = "codex";
    readonly capabilities: HarnessCapabilities;
    readonly submittedTexts: string[];
    readonly submittedContexts: AdapterTurnContext[];
    startCount: number;
    closeCount: number;
    constructor(options?: FakeHarnessAdapterOptions);
    start(_options: HarnessStartOptions): Promise<HarnessSession>;
}
//# sourceMappingURL=fake.d.ts.map