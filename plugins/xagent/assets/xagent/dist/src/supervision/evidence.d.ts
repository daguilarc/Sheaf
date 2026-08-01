import type { HarnessName } from "../events.js";
export type ProviderJsonEvidenceInput = {
    readonly original_prompt: string;
    readonly harness: HarnessName;
    readonly recent_provider_json: readonly unknown[];
    readonly elapsed_ms: number;
    readonly truncated: boolean;
};
export type ProviderJsonEvidenceSnapshot = ProviderJsonEvidenceInput & {
    readonly input_bytes: number;
};
export type ProviderJsonEvidenceWindowOptions = {
    readonly harness: HarnessName;
    readonly originalPrompt: string;
    readonly clock?: () => Date;
    readonly maxInputBytes?: number;
    readonly maxStringBytes?: number;
};
export declare class ProviderJsonEvidenceWindow {
    #private;
    constructor(options: ProviderJsonEvidenceWindowOptions);
    record(payload: unknown): void;
    snapshot(): ProviderJsonEvidenceSnapshot;
}
export declare function validateProviderJsonEvidencePolicy(options: {
    readonly maxInputBytes?: number;
    readonly maxStringBytes?: number;
}): void;
export declare function boundProviderValue(value: unknown, maxStringBytes: number): {
    readonly value: unknown;
    readonly truncated: boolean;
};
//# sourceMappingURL=evidence.d.ts.map