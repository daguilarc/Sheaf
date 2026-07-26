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
export declare const XagentStartInputSchema: z.ZodObject<{
    cwd: z.ZodString;
    prompt: z.ZodString;
    harness: z.ZodEnum<["codex", "pi", "cursor", "claude_code"]>;
    mode: z.ZodDefault<z.ZodEnum<["subagent", "full"]>>;
    model: z.ZodOptional<z.ZodString>;
    thinking_level: z.ZodOptional<z.ZodEnum<["low", "medium", "high", "xhigh"]>>;
    permission_mode: z.ZodOptional<z.ZodString>;
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
    permission_mode?: string | undefined;
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
    prompt: string;
    cwd: string;
    mode?: "subagent" | "full" | undefined;
    model?: string | undefined;
    thinking_level?: "low" | "medium" | "high" | "xhigh" | undefined;
    permission_mode?: string | undefined;
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
export declare function parseToolInput<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.output<S>;
export declare function structuredErrorFromUnknown(error: unknown): StructuredToolError;
//# sourceMappingURL=tool_schemas.d.ts.map