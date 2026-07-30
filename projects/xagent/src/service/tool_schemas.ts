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

const x_EmbeddedRunIdPattern = /xrun_[0-9]{17}_[0-9a-f]{8}/;

// Controller bookkeeping is not worker-actionable. A dispatched worker has no
// xagent access, so "keep session xrun_… open for re-review" reads as an
// instruction it must obey and cannot. Fail the dispatch rather than shipping
// the confusion into the prompt.
//
// Quoting a run id is legitimate when the subject matter IS xagent — a findings
// list citing a log line, a note naming the sibling run whose work is in the
// tree. Backticks mark it as a quotation rather than an instruction, so text
// inside them is exempt. Bare run ids in prose stay rejected.
//
function StripQuotedSpans(value: string): string {
  return value.replace(/`[^`]*`/g, "");
}

function WorkerFacingText(label: string) {
  return z.string().min(1).superRefine((value, ctx) => {
    const match = x_EmbeddedRunIdPattern.exec(StripQuotedSpans(value));
    if (match !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          `${label} must not contain a controller run id (found ${match[0]}); `
          + "a dispatched worker cannot act on xagent session ids. "
          + "If you are quoting it as subject matter, wrap it in backticks.",
      });
    }
  });
}

export const AgentIdSchema = z
  .string()
  .min(1)
  .regex(x_GeneratedAgentIdPattern, "agent_id must be a generated xagent run id");

const WatchdogPolicySchema = z
  .object({
    inputLimitBytes: z.number().int().positive().optional(),
    outputLimitBytes: z.number().int().positive().optional(),
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

// Free-text the controller appends verbatim to the rendered prompt, for any
// role and any follow-up kind. This is the channel for things the templates
// have no slot for — "the tree has uncommitted work from a cancelled sibling",
// "ignore the stray build output" — instead of smuggling them into a findings
// list or writing a constraints file. Worker-facing, so it is guarded like the
// rest of the prompt text.
//
const NoteSchema = WorkerFacingText("note").optional();

const SddAssignmentFields = {
  note: NoteSchema,
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
    name: WorkerFacingText("name"),
    brief: SddArtifactPathSchema,
    report: SddArtifactPathSchema,
    context: WorkerFacingText("context").optional(),
  })
  .strict();

// v2 start roles. Task 6 cuts the tool surface over to this union in the same
// commit that rewrites Start — never before it.
//
function ReviewerRefinement(
  value: {
    readonly task?: number;
    readonly report?: string;
    readonly constraints?: string;
    readonly diff?: string;
    readonly description?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.task === undefined) {
    if (value.description === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "reviewer without a task requires description (whole-branch review)",
      });
    }
    for (const field of ["report", "constraints", "diff"] as const) {
      if (value[field] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `reviewer without a task must not set ${field}`,
        });
      }
    }
    return;
  }
  if (value.report === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "reviewer with a task requires report",
    });
  }
  if (value.description !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "reviewer with a task must not set description",
    });
  }
}

const ReviewerStartObject = z
  .object({
    role: z.literal("reviewer"),
    ...SddAssignmentFields,
    task: z.number().int().positive().optional(),
    brief: SddArtifactPathSchema,
    base: z.string().min(1),
    head: z.string().min(1),
    report: SddArtifactPathSchema.optional(),
    constraints: SddArtifactPathSchema.optional(),
    diff: SddArtifactPathSchema.optional(),
    description: WorkerFacingText("description").optional(),
  })
  .strict();

export const ReviewerStartSchema = ReviewerStartObject.superRefine(ReviewerRefinement);

export const FixerStartSchema = z
  .object({
    role: z.literal("fixer"),
    ...SddAssignmentFields,
    task: z.number().int().positive(),
    brief: SddArtifactPathSchema,
    findings: SddArtifactPathSchema,
    findings_text: WorkerFacingText("findings_text"),
    tests: z.array(z.string().min(1)).min(1),
    report: SddArtifactPathSchema,
    round: z.number().int().positive().default(1),
  })
  .strict();

export const ReReviewerStartSchema = z
  .object({
    role: z.literal("re-reviewer"),
    ...SddAssignmentFields,
    task: z.number().int().positive(),
    brief: SddArtifactPathSchema,
    findings: SddArtifactPathSchema,
    report: SddArtifactPathSchema,
    base: z.string().min(1),
    head: z.string().min(1),
    diff: SddArtifactPathSchema.optional(),
    round: z.number().int().positive().default(1),
  })
  .strict();

export const XagentSddStartInputSchema = z
  .discriminatedUnion("role", [
    ImplementerStartSchema,
    ReviewerStartObject,
    FixerStartSchema,
    ReReviewerStartSchema,
  ])
  .superRefine((value, ctx) => {
    if (value.role === "reviewer") {
      ReviewerRefinement(value, ctx);
    }
  });

export const FixFollowupSchema = z
  .object({
    kind: z.literal("fix"),
    agent_id: AgentIdSchema,
    round: z.number().int().positive(),
    findings: SddArtifactPathSchema,
    findings_text: WorkerFacingText("findings_text"),
    tests: z.array(z.string().min(1)).min(1),
    report: SddArtifactPathSchema,
    note: NoteSchema,
  })
  .strict();

export const ReReviewFollowupSchema = z
  .object({
    kind: z.literal("re-review"),
    agent_id: AgentIdSchema,
    round: z.number().int().positive(),
    findings: SddArtifactPathSchema,
    report: SddArtifactPathSchema,
    base: z.string().min(1),
    head: z.string().min(1),
    diff: SddArtifactPathSchema.optional(),
    note: NoteSchema,
  })
  .strict();

export const XagentSddFollowupInputSchema = z.discriminatedUnion("kind", [
  FixFollowupSchema,
  ReReviewFollowupSchema,
]);

// Advertised-only schemas (xsvc-15).
//
// McpServer.registerTool derives a tool's published JSON Schema from an
// object schema; a discriminated union normalizes to undefined and is
// published as the empty object, leaving these two tools undiscoverable
// while every other tool advertises real fields. Handing registerTool the
// union's JSON Schema does not help either -- it accepts only a raw shape or
// an object schema.
//
// So these describe the union as a flat object: the discriminator as an
// enum, the fields every variant shares as required, and every
// variant-specific field optional and described with the variants that
// require it. They are never used to validate. The handlers still parse
// against the unions above, which remain the sole authority for rejection.
//
// The asymmetry is deliberate. Accepting a payload the union rejects costs
// the caller one structured error; rejecting a payload the union accepts
// hides capability the service would have served, with no way for the caller
// to discover the mistake. Only the second direction is a defect.
//
function AdvertisedFor(roles: string, detail: string): string {
  return `${detail} (required for: ${roles})`;
}

export const XagentSddStartAdvertisedSchema = z.object({
  role: z.enum(["implementer", "reviewer", "fixer", "re-reviewer"])
    .describe("Which SDD role to dispatch; selects the required fields below."),
  cwd: CwdSchema.describe("Absolute path to the worktree the agent works in."),
  plan: SddArtifactPathSchema.describe("Absolute path to the Superpowers plan."),
  agent: z.string().min(1).describe("Provider model name, e.g. grok-4.5 or opus."),
  harness: z.enum(harnessNames).describe("Provider harness to run the agent under."),
  effort: z.enum(thinkingLevels).describe("Reasoning effort for the dispatched agent."),
  policy: SupervisionPolicySchema.optional().describe("Optional supervision policy overrides."),
  note: NoteSchema.describe(
    "Free text appended verbatim to the rendered prompt, for anything the templates have no slot for.",
  ),
  task: z.number().int().positive().optional()
    .describe(AdvertisedFor("implementer, reviewer (task-scoped), fixer, re-reviewer", "Plan task number.")),
  name: WorkerFacingText("name").optional()
    .describe(AdvertisedFor("implementer", "Human-readable task name.")),
  brief: SddArtifactPathSchema.optional()
    .describe(AdvertisedFor("implementer, reviewer, fixer, re-reviewer", "Absolute path to the task or review brief.")),
  report: SddArtifactPathSchema.optional()
    .describe(AdvertisedFor("implementer, reviewer (task-scoped), fixer, re-reviewer", "Absolute path the agent writes its report to.")),
  context: WorkerFacingText("context").optional()
    .describe("Optional scene-setting for an implementer."),
  description: WorkerFacingText("description").optional()
    .describe(AdvertisedFor("reviewer (whole-branch)", "What the branch under review does.")),
  base: z.string().min(1).optional()
    .describe(AdvertisedFor("reviewer, re-reviewer", "Base git ref for the review diff.")),
  head: z.string().min(1).optional()
    .describe(AdvertisedFor("reviewer, re-reviewer", "Head git ref for the review diff.")),
  constraints: SddArtifactPathSchema.optional()
    .describe("Optional constraints file for a task-scoped reviewer."),
  diff: SddArtifactPathSchema.optional()
    .describe("Optional precomputed diff file for a reviewer or re-reviewer."),
  findings: SddArtifactPathSchema.optional()
    .describe(AdvertisedFor("fixer, re-reviewer", "Absolute path to the findings file.")),
  findings_text: WorkerFacingText("findings_text").optional()
    .describe(AdvertisedFor("fixer", "The findings, inline.")),
  tests: z.array(z.string().min(1)).min(1).optional()
    .describe(AdvertisedFor("fixer", "Commands that must pass before the fix is done.")),
  round: z.number().int().positive().optional()
    .describe("Optional fix or re-review round number for fixer and re-reviewer; defaults to 1."),
});

export const XagentSddFollowupAdvertisedSchema = z.object({
  kind: z.enum(["fix", "re-review"])
    .describe("Which continuation to render; selects the required fields below."),
  agent_id: AgentIdSchema.describe("The live SDD agent to continue."),
  round: z.number().int().positive().describe("Fix or re-review round number; render-only."),
  findings: SddArtifactPathSchema.describe("Absolute path to the findings file."),
  report: SddArtifactPathSchema.describe("Absolute path the agent appends its report to."),
  note: NoteSchema.describe("Free text appended verbatim to the rendered prompt."),
  findings_text: WorkerFacingText("findings_text").optional()
    .describe(AdvertisedFor("fix", "The findings, inline.")),
  tests: z.array(z.string().min(1)).min(1).optional()
    .describe(AdvertisedFor("fix", "Commands that must pass before the fix is done.")),
  base: z.string().min(1).optional()
    .describe(AdvertisedFor("re-review", "Base git ref for the re-review diff.")),
  head: z.string().min(1).optional()
    .describe(AdvertisedFor("re-review", "Head git ref for the re-review diff.")),
  diff: SddArtifactPathSchema.optional()
    .describe("Optional precomputed diff file."),
});

export const XagentStartInputSchema = z
  .object({
    cwd: CwdSchema,
    prompt: WorkerFacingText("prompt"),
    harness: z.enum(harnessNames),
    mode: z.enum(outputModes).default("subagent"),
    model: z.string().min(1).optional(),
    thinking_level: z.enum(thinkingLevels).optional(),
    permission_mode: z.string().min(1).optional(),
    provider_thread_id: z.string().min(1).optional(),
    policy: SupervisionPolicySchema.optional(),
  })
  .strict();

// Agent-facing discovery (xsvc-5 / xsvc-15): no deadline. Choosing a timeout
// whose only correct value depends on transport behaviour the agent cannot
// observe is not the agent's job. Internal callers and tests still pass
// deadline_seconds through XagentAwaitInputSchema.
//
// `.passthrough()` is load-bearing. The MCP SDK validates call arguments
// against the registered (advertised) schema before the handler runs and
// would otherwise strip `deadline_seconds`. Passthrough keeps unknown keys
// for the handler's real parse, while tools/list still advertises only the
// shape properties below. This is the inverse of the SDD advertised
// schemas, which are supersets; here discovery is a subset.
//
export const XagentAwaitAdvertisedSchema = z.object({
  run_id: z.string().min(1).describe("The supervised run to await."),
  after_sequence: z.number().int().min(0)
    .describe("Return the next durable wake after this cursor."),
}).passthrough();

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

export const XagentListInputSchema = z
  .object({
    live_only: z.boolean().default(false),
    limit: z.number().int().positive().max(200).default(50),
  })
  .strict();

export const XagentMessageInputSchema = z
  .object({
    run_id: z.string().min(1),
    // Reaches a worker verbatim, and this path is now legal on SDD runs, so it
    // is guarded like every other worker-facing field.
    //
    text: WorkerFacingText("text"),
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
export type XagentListInput = z.infer<typeof XagentListInputSchema>;
export type XagentMessageInput = z.infer<typeof XagentMessageInputSchema>;
export type XagentInterruptInput = z.infer<typeof XagentInterruptInputSchema>;
export type XagentCloseInput = z.infer<typeof XagentCloseInputSchema>;
export type XagentSddStartInput = z.infer<typeof XagentSddStartInputSchema>;
export type XagentSddFollowupInput = z.infer<typeof XagentSddFollowupInputSchema>;

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
