import { z } from "zod";
import path from "node:path";

import { harnessNames, outputModes, thinkingLevels } from "../events.js";

export const x_DefaultAwaitDeadlineSeconds = 7000;
export const x_MaxAwaitDeadlineSeconds = 7000;

export type StructuredToolError = {
  readonly error: string;
  readonly message: string;
  readonly details?: unknown;
};

export class ToolValidationError extends Error {
  readonly structured: StructuredToolError;

  constructor(structured: StructuredToolError) {
    super(structured.message);
    this.name = "ToolValidationError";
    this.structured = structured;
  }
}

export const CwdSchema = z.string().min(1).describe("Absolute path to an existing working directory");

const x_GeneratedAgentIdPattern = /^xrun_[0-9]{17}_[0-9a-f]{8}$/;

export const AgentIdSchema = z
  .string()
  .min(1)
  .regex(x_GeneratedAgentIdPattern, "agent_id must be a generated xagent run id");

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

export const SupervisionPolicySchema = z
  .object({
    silenceTimeoutMs: z.number().int().positive(),
    hardDeadlineMs: z.number().int().positive().optional(),
    watchdog: WatchdogPolicySchema.default({}),
  })
  .strict();

const SddArtifactPathSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    if (!path.isAbsolute(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "path must be absolute",
      });
      return;
    }
    if (value.split(/[\\/]/).includes("..")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "path must not contain traversal segments",
      });
    }
  });

export const SddAbsolutePathSchema = SddArtifactPathSchema;

const SddAssignmentFields = {
  cwd: CwdSchema,
  plan: SddArtifactPathSchema,
  agent: z.string().min(1),
  harness: z.enum(harnessNames),
  effort: z.enum(thinkingLevels),
  policy: SupervisionPolicySchema.optional(),
};

export const ImplementerStartSchema = z
  .object({
    role: z.literal("implementer"),
    ...SddAssignmentFields,
    task: z.number().int().positive(),
    name: z.string().min(1),
    brief: SddArtifactPathSchema,
    report: SddArtifactPathSchema,
    context: z.string().min(1).optional(),
  })
  .strict();

export const TaskReviewerStartSchema = z
  .object({
    role: z.literal("task-reviewer"),
    ...SddAssignmentFields,
    task: z.number().int().positive(),
    brief: SddArtifactPathSchema,
    report: SddArtifactPathSchema,
    base: z.string().min(1),
    head: z.string().min(1),
    constraints: SddArtifactPathSchema.optional(),
    diff: SddArtifactPathSchema.optional(),
  })
  .strict();

export const CodeReviewerStartSchema = z
  .object({
    role: z.literal("code-reviewer"),
    ...SddAssignmentFields,
    review_brief: SddArtifactPathSchema,
    description: z.string().min(1),
    base: z.string().min(1),
    head: z.string().min(1),
  })
  .strict();

export const XagentSddStartInputSchema = z.discriminatedUnion("role", [
  ImplementerStartSchema,
  TaskReviewerStartSchema,
  CodeReviewerStartSchema,
]);

export const FixFollowupSchema = z
  .object({
    kind: z.literal("fix"),
    agent_id: AgentIdSchema,
    round: z.number().int().positive(),
    findings: SddArtifactPathSchema,
    findings_text: z.string().min(1),
    tests: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const ReReviewFollowupSchema = z
  .object({
    kind: z.literal("re-review"),
    agent_id: AgentIdSchema,
    round: z.number().int().positive(),
    findings: SddArtifactPathSchema,
    base: z.string().min(1),
    head: z.string().min(1),
    diff: SddArtifactPathSchema.optional(),
  })
  .strict();

export const XagentSddFollowupInputSchema = z.discriminatedUnion("kind", [
  FixFollowupSchema,
  ReReviewFollowupSchema,
]);

export const XagentSddAwaitInputSchema = z
  .object({
    agent_id: AgentIdSchema,
    after_sequence: z.number().int().min(0),
    deadline_seconds: z
      .number()
      .int()
      .positive()
      .max(x_MaxAwaitDeadlineSeconds)
      .default(x_DefaultAwaitDeadlineSeconds),
  })
  .strict();

export const XagentSddCloseInputSchema = z
  .object({
    agent_id: AgentIdSchema,
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

export function parseToolInput<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return parsed.data as z.output<S>;
  }
  throw new ToolValidationError({
    error: "invalid_tool_input",
    message: parsed.error.issues.map((issue) => issue.message).join("; "),
    details: parsed.error.flatten(),
  });
}

export function structuredErrorFromUnknown(error: unknown): StructuredToolError {
  if (error instanceof ToolValidationError) {
    return error.structured;
  }
  if (
    error !== null
    && typeof error === "object"
    && "error" in error
    && typeof (error as { error: unknown }).error === "string"
    && "message" in error
    && typeof (error as { message: unknown }).message === "string"
  ) {
    const structured = error as StructuredToolError;
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
