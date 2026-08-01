import type { AdapterEvent, AdapterTurnContext, HarnessAdapter, HarnessCapabilities, HarnessSession, HarnessStartOptions, OwnedProcessIdentity } from "./types.js";
import type { HarnessName } from "../events.js";
export type FakeHarnessAdapterOptions = {
    readonly includeToolEvents?: boolean;
    readonly includeRawProvider?: boolean;
    readonly includeDeltas?: boolean;
    scriptedEvents?: readonly (readonly AdapterEvent[] | AsyncIterable<AdapterEvent>)[];
    readonly supportsInterrupt?: boolean;
    readonly processIdentity?: OwnedProcessIdentity;
};
export declare class FakeHarnessAdapter implements HarnessAdapter {
    options: FakeHarnessAdapterOptions;
    readonly harness: HarnessName;
    readonly capabilities: HarnessCapabilities;
    readonly submittedTexts: string[];
    readonly submittedContexts: AdapterTurnContext[];
    startCount: number;
    closeCount: number;
    interruptCount: number;
    onSubmit?: () => void;
    constructor(options?: FakeHarnessAdapterOptions);
    start(_options: HarnessStartOptions): Promise<HarnessSession>;
}
//# sourceMappingURL=fake.d.ts.map