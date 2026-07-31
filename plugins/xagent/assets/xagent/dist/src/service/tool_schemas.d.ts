import { z } from "zod";
export declare const x_DefaultAwaitDeadlineSeconds = 7000;
export declare const x_MaxAwaitDeadlineSeconds = 7000;
export type StructuredToolError = {
    readonly error: string;
    readonly message: string;
    readonly details?: unknown;
};
export declare class ToolValidationError extends Error {
    readonly structured: StructuredToolError;
    constructor(structured: StructuredToolError);
}
export declare const CwdSchema: z.ZodString;
export declare const RunIdSchema: z.ZodString;
export declare const SupervisionPolicySchema: z.ZodObject<{
    silenceTimeoutMs: z.ZodNumber;
    hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
    watchdog: z.ZodDefault<z.ZodObject<{
        inputLimitBytes: z.ZodOptional<z.ZodNumber>;
        outputLimitBytes: z.ZodOptional<z.ZodNumber>;
        suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
        repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
        repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
        cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
        minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
        maximumCalls: z.ZodOptional<z.ZodNumber>;
        confidenceFloor: z.ZodOptional<z.ZodNumber>;
        timeoutMs: z.ZodOptional<z.ZodNumber>;
        maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        suspicionWindowMs?: number | undefined;
        repeatedToolThreshold?: number | undefined;
        repeatedFailureThreshold?: number | undefined;
        inputLimitBytes?: number | undefined;
        cadenceMs?: number[] | undefined;
        minimumIntervalMs?: number | undefined;
        maximumCalls?: number | undefined;
        outputLimitBytes?: number | undefined;
        timeoutMs?: number | undefined;
        maxBudgetUsd?: number | undefined;
        confidenceFloor?: number | undefined;
    }, {
        suspicionWindowMs?: number | undefined;
        repeatedToolThreshold?: number | undefined;
        repeatedFailureThreshold?: number | undefined;
        inputLimitBytes?: number | undefined;
        cadenceMs?: number[] | undefined;
        minimumIntervalMs?: number | undefined;
        maximumCalls?: number | undefined;
        outputLimitBytes?: number | undefined;
        timeoutMs?: number | undefined;
        maxBudgetUsd?: number | undefined;
        confidenceFloor?: number | undefined;
    }>>;
}, "strict", z.ZodTypeAny, {
    watchdog: {
        suspicionWindowMs?: number | undefined;
        repeatedToolThreshold?: number | undefined;
        repeatedFailureThreshold?: number | undefined;
        inputLimitBytes?: number | undefined;
        cadenceMs?: number[] | undefined;
        minimumIntervalMs?: number | undefined;
        maximumCalls?: number | undefined;
        outputLimitBytes?: number | undefined;
        timeoutMs?: number | undefined;
        maxBudgetUsd?: number | undefined;
        confidenceFloor?: number | undefined;
    };
    silenceTimeoutMs: number;
    hardDeadlineMs?: number | undefined;
}, {
    silenceTimeoutMs: number;
    watchdog?: {
        suspicionWindowMs?: number | undefined;
        repeatedToolThreshold?: number | undefined;
        repeatedFailureThreshold?: number | undefined;
        inputLimitBytes?: number | undefined;
        cadenceMs?: number[] | undefined;
        minimumIntervalMs?: number | undefined;
        maximumCalls?: number | undefined;
        outputLimitBytes?: number | undefined;
        timeoutMs?: number | undefined;
        maxBudgetUsd?: number | undefined;
        confidenceFloor?: number | undefined;
    } | undefined;
    hardDeadlineMs?: number | undefined;
}>;
export declare const SddAbsolutePathSchema: z.ZodEffects<z.ZodString, string, string>;
export declare const ImplementerStartSchema: z.ZodObject<{
    task: z.ZodNumber;
    name: z.ZodEffects<z.ZodString, string, string>;
    brief: z.ZodEffects<z.ZodString, string, string>;
    report_out: z.ZodEffects<z.ZodString, string, string>;
    context: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    role: z.ZodLiteral<"implementer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "implementer";
    name: string;
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    task: number;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    context?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "implementer";
    name: string;
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    task: number;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    context?: string | undefined;
}>;
export declare const x_ReviewerBranchForbiddenFields: readonly ["implementer_report", "constraints", "diff"];
export declare const x_ReviewerTaskForbiddenFields: readonly ["description"];
export declare const x_ReviewerTaskRequiredFields: readonly ["implementer_report"];
export declare const x_ReviewerBranchRequiredFields: readonly ["description"];
export declare const ReviewerStartObject: z.ZodObject<{
    task: z.ZodOptional<z.ZodNumber>;
    brief: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    implementer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    constraints: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    description: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    role: z.ZodLiteral<"reviewer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    base: string;
    head: string;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    implementer_report?: string | undefined;
    constraints?: string | undefined;
    diff?: string | undefined;
    task?: number | undefined;
    description?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    base: string;
    head: string;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    implementer_report?: string | undefined;
    constraints?: string | undefined;
    diff?: string | undefined;
    task?: number | undefined;
    description?: string | undefined;
}>;
export declare const ReviewerStartSchema: z.ZodEffects<z.ZodObject<{
    task: z.ZodOptional<z.ZodNumber>;
    brief: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    implementer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    constraints: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    description: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    role: z.ZodLiteral<"reviewer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    base: string;
    head: string;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    implementer_report?: string | undefined;
    constraints?: string | undefined;
    diff?: string | undefined;
    task?: number | undefined;
    description?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    base: string;
    head: string;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    implementer_report?: string | undefined;
    constraints?: string | undefined;
    diff?: string | undefined;
    task?: number | undefined;
    description?: string | undefined;
}>, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    base: string;
    head: string;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    implementer_report?: string | undefined;
    constraints?: string | undefined;
    diff?: string | undefined;
    task?: number | undefined;
    description?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    base: string;
    head: string;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    implementer_report?: string | undefined;
    constraints?: string | undefined;
    diff?: string | undefined;
    task?: number | undefined;
    description?: string | undefined;
}>;
export declare const FixerStartSchema: z.ZodObject<{
    task: z.ZodNumber;
    brief: z.ZodEffects<z.ZodString, string, string>;
    findings: z.ZodEffects<z.ZodString, string, string>;
    findings_text: z.ZodEffects<z.ZodString, string, string>;
    tests: z.ZodArray<z.ZodString, "many">;
    report_out: z.ZodEffects<z.ZodString, string, string>;
    round: z.ZodDefault<z.ZodNumber>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    role: z.ZodLiteral<"fixer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "fixer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    findings: string;
    task: number;
    findings_text: string;
    tests: string[];
    round: number;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "fixer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    findings: string;
    task: number;
    findings_text: string;
    tests: string[];
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    round?: number | undefined;
}>;
export declare const ReReviewerStartSchema: z.ZodObject<{
    task: z.ZodNumber;
    brief: z.ZodEffects<z.ZodString, string, string>;
    findings: z.ZodEffects<z.ZodString, string, string>;
    fixer_report: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    round: z.ZodDefault<z.ZodNumber>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    role: z.ZodLiteral<"re-reviewer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "re-reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    fixer_report: string;
    findings: string;
    task: number;
    base: string;
    head: string;
    round: number;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    diff?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "re-reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    fixer_report: string;
    findings: string;
    task: number;
    base: string;
    head: string;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    diff?: string | undefined;
    round?: number | undefined;
}>;
export declare const XagentSddStartInputSchema: z.ZodEffects<z.ZodDiscriminatedUnion<"role", [z.ZodObject<{
    task: z.ZodNumber;
    name: z.ZodEffects<z.ZodString, string, string>;
    brief: z.ZodEffects<z.ZodString, string, string>;
    report_out: z.ZodEffects<z.ZodString, string, string>;
    context: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    role: z.ZodLiteral<"implementer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "implementer";
    name: string;
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    task: number;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    context?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "implementer";
    name: string;
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    task: number;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    context?: string | undefined;
}>, z.ZodObject<{
    task: z.ZodOptional<z.ZodNumber>;
    brief: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    implementer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    constraints: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    description: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    role: z.ZodLiteral<"reviewer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    base: string;
    head: string;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    implementer_report?: string | undefined;
    constraints?: string | undefined;
    diff?: string | undefined;
    task?: number | undefined;
    description?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    base: string;
    head: string;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    implementer_report?: string | undefined;
    constraints?: string | undefined;
    diff?: string | undefined;
    task?: number | undefined;
    description?: string | undefined;
}>, z.ZodObject<{
    task: z.ZodNumber;
    brief: z.ZodEffects<z.ZodString, string, string>;
    findings: z.ZodEffects<z.ZodString, string, string>;
    findings_text: z.ZodEffects<z.ZodString, string, string>;
    tests: z.ZodArray<z.ZodString, "many">;
    report_out: z.ZodEffects<z.ZodString, string, string>;
    round: z.ZodDefault<z.ZodNumber>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    role: z.ZodLiteral<"fixer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "fixer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    findings: string;
    task: number;
    findings_text: string;
    tests: string[];
    round: number;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "fixer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    findings: string;
    task: number;
    findings_text: string;
    tests: string[];
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    round?: number | undefined;
}>, z.ZodObject<{
    task: z.ZodNumber;
    brief: z.ZodEffects<z.ZodString, string, string>;
    findings: z.ZodEffects<z.ZodString, string, string>;
    fixer_report: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    round: z.ZodDefault<z.ZodNumber>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    role: z.ZodLiteral<"re-reviewer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "re-reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    fixer_report: string;
    findings: string;
    task: number;
    base: string;
    head: string;
    round: number;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    diff?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "re-reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    fixer_report: string;
    findings: string;
    task: number;
    base: string;
    head: string;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    diff?: string | undefined;
    round?: number | undefined;
}>]>, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "implementer";
    name: string;
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    task: number;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    context?: string | undefined;
} | {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    base: string;
    head: string;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    implementer_report?: string | undefined;
    constraints?: string | undefined;
    diff?: string | undefined;
    task?: number | undefined;
    description?: string | undefined;
} | {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "fixer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    findings: string;
    task: number;
    findings_text: string;
    tests: string[];
    round: number;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
} | {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "re-reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    fixer_report: string;
    findings: string;
    task: number;
    base: string;
    head: string;
    round: number;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    diff?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "implementer";
    name: string;
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    task: number;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    context?: string | undefined;
} | {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    base: string;
    head: string;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    implementer_report?: string | undefined;
    constraints?: string | undefined;
    diff?: string | undefined;
    task?: number | undefined;
    description?: string | undefined;
} | {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "fixer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    report_out: string;
    findings: string;
    task: number;
    findings_text: string;
    tests: string[];
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    round?: number | undefined;
} | {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    model: string;
    role: "re-reviewer";
    cwd: string;
    effort: "low" | "medium" | "high" | "xhigh";
    plan: string;
    brief: string;
    fixer_report: string;
    findings: string;
    task: number;
    base: string;
    head: string;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    note?: string | undefined;
    diff?: string | undefined;
    round?: number | undefined;
}>;
export declare const FixFollowupSchema: z.ZodObject<{
    kind: z.ZodLiteral<"fix">;
    run_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    findings_text: z.ZodEffects<z.ZodString, string, string>;
    tests: z.ZodArray<z.ZodString, "many">;
    report_out: z.ZodEffects<z.ZodString, string, string>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "strict", z.ZodTypeAny, {
    run_id: string;
    kind: "fix";
    report_out: string;
    findings: string;
    findings_text: string;
    tests: string[];
    round: number;
    note?: string | undefined;
}, {
    run_id: string;
    kind: "fix";
    report_out: string;
    findings: string;
    findings_text: string;
    tests: string[];
    round: number;
    note?: string | undefined;
}>;
export declare const ReReviewFollowupSchema: z.ZodObject<{
    kind: z.ZodLiteral<"re-review">;
    run_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    fixer_report: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "strict", z.ZodTypeAny, {
    run_id: string;
    kind: "re-review";
    fixer_report: string;
    findings: string;
    base: string;
    head: string;
    round: number;
    note?: string | undefined;
    diff?: string | undefined;
}, {
    run_id: string;
    kind: "re-review";
    fixer_report: string;
    findings: string;
    base: string;
    head: string;
    round: number;
    note?: string | undefined;
    diff?: string | undefined;
}>;
export declare const XagentSddFollowupInputSchema: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
    kind: z.ZodLiteral<"fix">;
    run_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    findings_text: z.ZodEffects<z.ZodString, string, string>;
    tests: z.ZodArray<z.ZodString, "many">;
    report_out: z.ZodEffects<z.ZodString, string, string>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "strict", z.ZodTypeAny, {
    run_id: string;
    kind: "fix";
    report_out: string;
    findings: string;
    findings_text: string;
    tests: string[];
    round: number;
    note?: string | undefined;
}, {
    run_id: string;
    kind: "fix";
    report_out: string;
    findings: string;
    findings_text: string;
    tests: string[];
    round: number;
    note?: string | undefined;
}>, z.ZodObject<{
    kind: z.ZodLiteral<"re-review">;
    run_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    fixer_report: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "strict", z.ZodTypeAny, {
    run_id: string;
    kind: "re-review";
    fixer_report: string;
    findings: string;
    base: string;
    head: string;
    round: number;
    note?: string | undefined;
    diff?: string | undefined;
}, {
    run_id: string;
    kind: "re-review";
    fixer_report: string;
    findings: string;
    base: string;
    head: string;
    round: number;
    note?: string | undefined;
    diff?: string | undefined;
}>]>;
export declare const XagentSddStartAdvertisedSchema: z.ZodObject<{
    role: z.ZodEnum<["implementer", "reviewer", "fixer", "re-reviewer"]>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    task: z.ZodOptional<z.ZodNumber>;
    name: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    brief: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    report_out: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    implementer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    fixer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    context: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    description: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    base: z.ZodOptional<z.ZodString>;
    head: z.ZodOptional<z.ZodString>;
    constraints: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    findings: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    findings_text: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    tests: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    round: z.ZodOptional<z.ZodNumber>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    role: z.ZodEnum<["implementer", "reviewer", "fixer", "re-reviewer"]>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    task: z.ZodOptional<z.ZodNumber>;
    name: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    brief: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    report_out: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    implementer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    fixer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    context: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    description: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    base: z.ZodOptional<z.ZodString>;
    head: z.ZodOptional<z.ZodString>;
    constraints: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    findings: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    findings_text: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    tests: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    round: z.ZodOptional<z.ZodNumber>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    role: z.ZodEnum<["implementer", "reviewer", "fixer", "re-reviewer"]>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    model: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    effort: z.ZodEnum<["low", "medium", "high", "xhigh"]>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    task: z.ZodOptional<z.ZodNumber>;
    name: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    brief: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    report_out: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    implementer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    fixer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    context: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    description: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    base: z.ZodOptional<z.ZodString>;
    head: z.ZodOptional<z.ZodString>;
    constraints: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    findings: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    findings_text: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    tests: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    round: z.ZodOptional<z.ZodNumber>;
}, z.ZodTypeAny, "passthrough">>;
export declare const XagentSddFollowupAdvertisedSchema: z.ZodObject<{
    kind: z.ZodEnum<["fix", "re-review"]>;
    run_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    report_out: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    fixer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    findings_text: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    tests: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    base: z.ZodOptional<z.ZodString>;
    head: z.ZodOptional<z.ZodString>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    kind: z.ZodEnum<["fix", "re-review"]>;
    run_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    report_out: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    fixer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    findings_text: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    tests: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    base: z.ZodOptional<z.ZodString>;
    head: z.ZodOptional<z.ZodString>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    kind: z.ZodEnum<["fix", "re-review"]>;
    run_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    report_out: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    fixer_report: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    note: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    findings_text: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    tests: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    base: z.ZodOptional<z.ZodString>;
    head: z.ZodOptional<z.ZodString>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, z.ZodTypeAny, "passthrough">>;
export declare const XagentStartInputSchema: z.ZodObject<{
    cwd: z.ZodString;
    prompt: z.ZodEffects<z.ZodString, string, string>;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    mode: z.ZodDefault<z.ZodEnum<["subagent", "full"]>>;
    model: z.ZodOptional<z.ZodString>;
    thinking_level: z.ZodOptional<z.ZodEnum<["low", "medium", "high", "xhigh"]>>;
    permission_mode: z.ZodOptional<z.ZodString>;
    provider_thread_id: z.ZodOptional<z.ZodString>;
    policy: z.ZodOptional<z.ZodObject<{
        silenceTimeoutMs: z.ZodNumber;
        hardDeadlineMs: z.ZodOptional<z.ZodNumber>;
        watchdog: z.ZodDefault<z.ZodObject<{
            inputLimitBytes: z.ZodOptional<z.ZodNumber>;
            outputLimitBytes: z.ZodOptional<z.ZodNumber>;
            suspicionWindowMs: z.ZodOptional<z.ZodNumber>;
            repeatedToolThreshold: z.ZodOptional<z.ZodNumber>;
            repeatedFailureThreshold: z.ZodOptional<z.ZodNumber>;
            cadenceMs: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
            minimumIntervalMs: z.ZodOptional<z.ZodNumber>;
            maximumCalls: z.ZodOptional<z.ZodNumber>;
            confidenceFloor: z.ZodOptional<z.ZodNumber>;
            timeoutMs: z.ZodOptional<z.ZodNumber>;
            maxBudgetUsd: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }, {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    }, {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    }>>;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    mode: "subagent" | "full";
    prompt: string;
    cwd: string;
    model?: string | undefined;
    thinking_level?: "low" | "medium" | "high" | "xhigh" | undefined;
    provider_thread_id?: string | undefined;
    policy?: {
        watchdog: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        };
        silenceTimeoutMs: number;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    permission_mode?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    prompt: string;
    cwd: string;
    mode?: "subagent" | "full" | undefined;
    model?: string | undefined;
    thinking_level?: "low" | "medium" | "high" | "xhigh" | undefined;
    provider_thread_id?: string | undefined;
    policy?: {
        silenceTimeoutMs: number;
        watchdog?: {
            suspicionWindowMs?: number | undefined;
            repeatedToolThreshold?: number | undefined;
            repeatedFailureThreshold?: number | undefined;
            inputLimitBytes?: number | undefined;
            cadenceMs?: number[] | undefined;
            minimumIntervalMs?: number | undefined;
            maximumCalls?: number | undefined;
            outputLimitBytes?: number | undefined;
            timeoutMs?: number | undefined;
            maxBudgetUsd?: number | undefined;
            confidenceFloor?: number | undefined;
        } | undefined;
        hardDeadlineMs?: number | undefined;
    } | undefined;
    permission_mode?: string | undefined;
}>;
export declare const XagentAwaitAdvertisedSchema: z.ZodObject<{
    run_id: z.ZodString;
    after_sequence: z.ZodNumber;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    run_id: z.ZodString;
    after_sequence: z.ZodNumber;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    run_id: z.ZodString;
    after_sequence: z.ZodNumber;
}, z.ZodTypeAny, "passthrough">>;
export declare const XagentAwaitInputSchema: z.ZodObject<{
    run_id: z.ZodString;
    after_sequence: z.ZodNumber;
    deadline_seconds: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    run_id: string;
    after_sequence: number;
    deadline_seconds: number;
}, {
    run_id: string;
    after_sequence: number;
    deadline_seconds?: number | undefined;
}>;
export declare const XagentInspectInputSchema: z.ZodObject<{
    run_id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    run_id: string;
}, {
    run_id: string;
}>;
export declare const XagentListInputSchema: z.ZodObject<{
    live_only: z.ZodDefault<z.ZodBoolean>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    live_only: boolean;
    limit: number;
}, {
    live_only?: boolean | undefined;
    limit?: number | undefined;
}>;
export declare const XagentMessageInputSchema: z.ZodObject<{
    run_id: z.ZodString;
    text: z.ZodEffects<z.ZodString, string, string>;
}, "strict", z.ZodTypeAny, {
    run_id: string;
    text: string;
}, {
    run_id: string;
    text: string;
}>;
export declare const XagentInterruptInputSchema: z.ZodObject<{
    run_id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    run_id: string;
}, {
    run_id: string;
}>;
export declare const XagentCloseInputSchema: z.ZodObject<{
    run_id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    run_id: string;
}, {
    run_id: string;
}>;
export type XagentStartInput = z.infer<typeof XagentStartInputSchema>;
export type XagentAwaitInput = z.infer<typeof XagentAwaitInputSchema>;
export type XagentInspectInput = z.infer<typeof XagentInspectInputSchema>;
export type XagentListInput = z.infer<typeof XagentListInputSchema>;
export type XagentMessageInput = z.infer<typeof XagentMessageInputSchema>;
export type XagentInterruptInput = z.infer<typeof XagentInterruptInputSchema>;
export type XagentCloseInput = z.infer<typeof XagentCloseInputSchema>;
export type XagentSddStartInput = z.infer<typeof XagentSddStartInputSchema>;
export type XagentSddFollowupInput = z.infer<typeof XagentSddFollowupInputSchema>;
export declare function parseToolInput<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S>;
export declare function structuredErrorFromUnknown(error: unknown): StructuredToolError;
//# sourceMappingURL=tool_schemas.d.ts.map