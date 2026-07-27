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
export declare const AgentIdSchema: z.ZodString;
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
    name: z.ZodString;
    brief: z.ZodEffects<z.ZodString, string, string>;
    report: z.ZodEffects<z.ZodString, string, string>;
    context: z.ZodOptional<z.ZodString>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    agent: z.ZodString;
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
    role: "implementer";
    name: string;
    cwd: string;
    task: number;
    brief: string;
    report: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
    context?: string | undefined;
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
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    role: "implementer";
    name: string;
    cwd: string;
    task: number;
    brief: string;
    report: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
    context?: string | undefined;
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
}>;
export declare const TaskReviewerStartSchema: z.ZodObject<{
    task: z.ZodNumber;
    brief: z.ZodEffects<z.ZodString, string, string>;
    report: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    constraints: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    agent: z.ZodString;
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
    role: z.ZodLiteral<"task-reviewer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    role: "task-reviewer";
    cwd: string;
    task: number;
    brief: string;
    report: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
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
    constraints?: string | undefined;
    diff?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    role: "task-reviewer";
    cwd: string;
    task: number;
    brief: string;
    report: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
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
    constraints?: string | undefined;
    diff?: string | undefined;
}>;
export declare const CodeReviewerStartSchema: z.ZodObject<{
    review_brief: z.ZodEffects<z.ZodString, string, string>;
    description: z.ZodString;
    base: z.ZodString;
    head: z.ZodString;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    agent: z.ZodString;
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
    role: z.ZodLiteral<"code-reviewer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    role: "code-reviewer";
    cwd: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
    base: string;
    head: string;
    review_brief: string;
    description: string;
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
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    role: "code-reviewer";
    cwd: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
    base: string;
    head: string;
    review_brief: string;
    description: string;
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
}>;
export declare const XagentSddStartInputSchema: z.ZodDiscriminatedUnion<"role", [z.ZodObject<{
    task: z.ZodNumber;
    name: z.ZodString;
    brief: z.ZodEffects<z.ZodString, string, string>;
    report: z.ZodEffects<z.ZodString, string, string>;
    context: z.ZodOptional<z.ZodString>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    agent: z.ZodString;
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
    role: "implementer";
    name: string;
    cwd: string;
    task: number;
    brief: string;
    report: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
    context?: string | undefined;
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
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    role: "implementer";
    name: string;
    cwd: string;
    task: number;
    brief: string;
    report: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
    context?: string | undefined;
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
}>, z.ZodObject<{
    task: z.ZodNumber;
    brief: z.ZodEffects<z.ZodString, string, string>;
    report: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    constraints: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    agent: z.ZodString;
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
    role: z.ZodLiteral<"task-reviewer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    role: "task-reviewer";
    cwd: string;
    task: number;
    brief: string;
    report: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
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
    constraints?: string | undefined;
    diff?: string | undefined;
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    role: "task-reviewer";
    cwd: string;
    task: number;
    brief: string;
    report: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
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
    constraints?: string | undefined;
    diff?: string | undefined;
}>, z.ZodObject<{
    review_brief: z.ZodEffects<z.ZodString, string, string>;
    description: z.ZodString;
    base: z.ZodString;
    head: z.ZodString;
    cwd: z.ZodString;
    plan: z.ZodEffects<z.ZodString, string, string>;
    agent: z.ZodString;
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
    role: z.ZodLiteral<"code-reviewer">;
}, "strict", z.ZodTypeAny, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    role: "code-reviewer";
    cwd: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
    base: string;
    head: string;
    review_brief: string;
    description: string;
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
}, {
    harness: "codex" | "pi" | "cursor" | "claude_code";
    role: "code-reviewer";
    cwd: string;
    plan: string;
    agent: string;
    effort: "low" | "medium" | "high" | "xhigh";
    base: string;
    head: string;
    review_brief: string;
    description: string;
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
}>]>;
export declare const FixFollowupSchema: z.ZodObject<{
    kind: z.ZodLiteral<"fix">;
    agent_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    findings_text: z.ZodString;
    tests: z.ZodArray<z.ZodString, "many">;
}, "strict", z.ZodTypeAny, {
    kind: "fix";
    agent_id: string;
    round: number;
    findings: string;
    findings_text: string;
    tests: string[];
}, {
    kind: "fix";
    agent_id: string;
    round: number;
    findings: string;
    findings_text: string;
    tests: string[];
}>;
export declare const ReReviewFollowupSchema: z.ZodObject<{
    kind: z.ZodLiteral<"re-review">;
    agent_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "strict", z.ZodTypeAny, {
    kind: "re-review";
    base: string;
    head: string;
    agent_id: string;
    round: number;
    findings: string;
    diff?: string | undefined;
}, {
    kind: "re-review";
    base: string;
    head: string;
    agent_id: string;
    round: number;
    findings: string;
    diff?: string | undefined;
}>;
export declare const XagentSddFollowupInputSchema: z.ZodDiscriminatedUnion<"kind", [z.ZodObject<{
    kind: z.ZodLiteral<"fix">;
    agent_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    findings_text: z.ZodString;
    tests: z.ZodArray<z.ZodString, "many">;
}, "strict", z.ZodTypeAny, {
    kind: "fix";
    agent_id: string;
    round: number;
    findings: string;
    findings_text: string;
    tests: string[];
}, {
    kind: "fix";
    agent_id: string;
    round: number;
    findings: string;
    findings_text: string;
    tests: string[];
}>, z.ZodObject<{
    kind: z.ZodLiteral<"re-review">;
    agent_id: z.ZodString;
    round: z.ZodNumber;
    findings: z.ZodEffects<z.ZodString, string, string>;
    base: z.ZodString;
    head: z.ZodString;
    diff: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
}, "strict", z.ZodTypeAny, {
    kind: "re-review";
    base: string;
    head: string;
    agent_id: string;
    round: number;
    findings: string;
    diff?: string | undefined;
}, {
    kind: "re-review";
    base: string;
    head: string;
    agent_id: string;
    round: number;
    findings: string;
    diff?: string | undefined;
}>]>;
export declare const XagentSddAwaitInputSchema: z.ZodObject<{
    agent_id: z.ZodString;
    after_sequence: z.ZodNumber;
    deadline_seconds: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    agent_id: string;
    after_sequence: number;
    deadline_seconds: number;
}, {
    agent_id: string;
    after_sequence: number;
    deadline_seconds?: number | undefined;
}>;
export declare const XagentSddCloseInputSchema: z.ZodObject<{
    agent_id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    agent_id: string;
}, {
    agent_id: string;
}>;
export declare const XagentStartInputSchema: z.ZodObject<{
    cwd: z.ZodString;
    prompt: z.ZodString;
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
export declare const XagentMessageInputSchema: z.ZodObject<{
    run_id: z.ZodString;
    text: z.ZodString;
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
export type XagentMessageInput = z.infer<typeof XagentMessageInputSchema>;
export type XagentInterruptInput = z.infer<typeof XagentInterruptInputSchema>;
export type XagentCloseInput = z.infer<typeof XagentCloseInputSchema>;
export type XagentSddStartInput = z.infer<typeof XagentSddStartInputSchema>;
export type XagentSddFollowupInput = z.infer<typeof XagentSddFollowupInputSchema>;
export type XagentSddAwaitInput = z.infer<typeof XagentSddAwaitInputSchema>;
export type XagentSddCloseInput = z.infer<typeof XagentSddCloseInputSchema>;
export declare function parseToolInput<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S>;
export declare function structuredErrorFromUnknown(error: unknown): StructuredToolError;
//# sourceMappingURL=tool_schemas.d.ts.map