import type { AdapterEvent } from "../adapters/types.js";
export type PriorWatchdogVerdict = {
    readonly verdict: "healthy" | "derailed" | "uncertain";
    readonly confidence: number;
    readonly reason_code: string;
};
export type EvidenceSuspicionSignal = "repeated_tool_fingerprint" | "repeated_failure_fingerprint";
export type EvidenceFingerprint = {
    readonly fingerprint: string;
    readonly count: number;
};
export type SemanticEvidenceInput = {
    readonly original_prompt: string;
    readonly recent_events: readonly Record<string, unknown>[];
    readonly tool_fingerprints: readonly EvidenceFingerprint[];
    readonly failure_fingerprints: readonly EvidenceFingerprint[];
    readonly elapsed_ms: number;
    readonly previous_verdict?: PriorWatchdogVerdict;
    readonly suspicion_signals: readonly EvidenceSuspicionSignal[];
    readonly truncated: boolean;
};
export type SemanticEvidenceSnapshot = SemanticEvidenceInput & {
    readonly input_bytes: number;
};
export type SemanticEvidenceWindowOptions = {
    readonly repoRoot: string;
    readonly originalPrompt: string;
    readonly clock?: () => Date;
    readonly previousVerdict?: PriorWatchdogVerdict;
    readonly maxInputBytes?: number;
    readonly suspicionWindowMs?: number;
    readonly repeatedToolThreshold?: number;
    readonly repeatedFailureThreshold?: number;
};
export declare class SemanticEvidenceWindow {
    #private;
    constructor(options: SemanticEvidenceWindowOptions);
    record(event: AdapterEvent): void;
    recordPreviousVerdict(verdict: PriorWatchdogVerdict): void;
    snapshot(): SemanticEvidenceSnapshot;
}
export declare function validateSemanticEvidencePolicy(options: {
    readonly maxInputBytes?: number;
    readonly suspicionWindowMs?: number;
    readonly repeatedToolThreshold?: number;
    readonly repeatedFailureThreshold?: number;
}): void;
//# sourceMappingURL=evidence.d.ts.map