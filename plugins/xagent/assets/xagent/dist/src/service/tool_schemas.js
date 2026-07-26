import { z } from "zod";
import { harnessNames, outputModes, thinkingLevels } from "../events.js";
export const x_DefaultAwaitDeadlineSeconds = 7000;
export const x_MaxAwaitDeadlineSeconds = 7000;
export class ToolValidationError extends Error {
    structured;
    constructor(structured) {
        super(structured.message);
        this.name = "ToolValidationError";
        this.structured = structured;
    }
}
const CwdSchema = z.string().min(1).describe("Absolute path to an existing working directory");
const WatchdogPolicySchema = z
    .object({
    inputLimitBytes: z.number().int().positive().optional(),
    outputLimitBytes: z.number().int().positive().optional(),
    suspicionWindowMs: z.number().int().positive().optional(),
    repeatedToolThreshold: z.number().int().positive().optional(),
    repeatedFailureThreshold: z.number().int().positive().optional(),
    cadenceMs: z.array(z.number().int().positive()).optional(),
    minimumIntervalMs: z.number().int().positive().optional(),
    maximumCalls: z.number().int().positive().optional(),
    confidenceFloor: z.number().min(0).max(1).optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxBudgetUsd: z.number().positive().optional(),
})
    .strict();
const SupervisionPolicySchema = z
    .object({
    silenceTimeoutMs: z.number().int().positive(),
    hardDeadlineMs: z.number().int().positive().optional(),
    watchdog: WatchdogPolicySchema.default({}),
})
    .strict();
export const XagentStartInputSchema = z
    .object({
    cwd: CwdSchema,
    prompt: z.string().min(1),
    harness: z.enum(harnessNames),
    mode: z.enum(outputModes).default("subagent"),
    model: z.string().min(1).optional(),
    thinking_level: z.enum(thinkingLevels).optional(),
    permission_mode: z.string().min(1).optional(),
    provider_thread_id: z.string().min(1).optional(),
    policy: SupervisionPolicySchema.optional(),
})
    .strict();
export const XagentAwaitInputSchema = z
    .object({
    run_id: z.string().min(1),
    after_sequence: z.number().int().min(0),
    deadline_seconds: z
        .number()
        .int()
        .positive()
        .max(x_MaxAwaitDeadlineSeconds)
        .default(x_DefaultAwaitDeadlineSeconds),
})
    .strict();
export const XagentInspectInputSchema = z
    .object({
    run_id: z.string().min(1),
})
    .strict();
export const XagentMessageInputSchema = z
    .object({
    run_id: z.string().min(1),
    text: z.string().min(1),
})
    .strict();
export const XagentInterruptInputSchema = z
    .object({
    run_id: z.string().min(1),
})
    .strict();
export const XagentCloseInputSchema = z
    .object({
    run_id: z.string().min(1),
})
    .strict();
export function parseToolInput(schema, raw) {
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
        return parsed.data;
    }
    throw new ToolValidationError({
        error: "invalid_tool_input",
        message: parsed.error.issues.map((issue) => issue.message).join("; "),
        details: parsed.error.flatten(),
    });
}
export function structuredErrorFromUnknown(error) {
    if (error instanceof ToolValidationError) {
        return error.structured;
    }
    if (error !== null
        && typeof error === "object"
        && "error" in error
        && typeof error.error === "string"
        && "message" in error
        && typeof error.message === "string") {
        const structured = error;
        return {
            error: structured.error,
            message: structured.message,
            ...(structured.details === undefined ? {} : { details: structured.details }),
        };
    }
    return {
        error: "tool_failed",
        message: error instanceof Error ? error.message : String(error),
    };
}
//# sourceMappingURL=tool_schemas.js.map