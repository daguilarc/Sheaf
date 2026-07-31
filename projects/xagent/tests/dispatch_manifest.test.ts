import { test } from "node:test";
import assert from "node:assert/strict";
import type { z } from "zod";

import {
  CallerInputProjection,
  DISPATCH_VARIANTS,
  DispatchManifest,
  OPERATIONAL_FIELDS,
  REGISTRY,
  SurfaceFieldFor,
  x_OptionFields,
  type DispatchVariant,
} from "../src/service/dispatch_manifest.js";
import { BuildDispatchArgs, type RenderSddPromptInput } from "../src/service/sdd_prompt.js";
import {
  FixFollowupSchema,
  FixerStartSchema,
  ImplementerStartSchema,
  ReReviewFollowupSchema,
  ReReviewerStartSchema,
  ReviewerStartObject,
  XagentSddFollowupAdvertisedSchema,
  XagentSddFollowupInputSchema,
  XagentSddStartAdvertisedSchema,
  XagentSddStartInputSchema,
  x_ReviewerBranchForbiddenFields,
  x_ReviewerBranchRequiredFields,
  x_ReviewerTaskForbiddenFields,
  x_ReviewerTaskRequiredFields,
} from "../src/service/tool_schemas.js";

// Equality #1: membership comes from the union option lists themselves, so a
// fifth start role added only to the discriminatedUnion fails this test.
//
function RecognizedDispatchVariants(): string[] {
  const startOptions = (
    XagentSddStartInputSchema as unknown as {
      _def: { schema: { options: ReadonlyArray<{ shape: { role: { value: string } } }> } };
    }
  )._def.schema.options;
  const variants: string[] = [];
  for (const option of startOptions) {
    const role = option.shape.role.value;
    if (role === "reviewer") {
      // Task presence is the refinement's split into two public variants.
      //
      variants.push("reviewer:task", "reviewer:branch");
    }
    else {
      variants.push(role);
    }
  }
  const followupOptions = (
    XagentSddFollowupInputSchema as unknown as {
      options: ReadonlyArray<{ shape: { kind: { value: string } } }>;
    }
  ).options;
  for (const option of followupOptions) {
    variants.push(`followup:${option.shape.kind.value}`);
  }
  return variants.sort();
}

// Equality #2 input: every (variant, field) pair the schemas accept. Reviewer
// task vs branch splits use the refinement's own forbidden-field lists.
//
function AcceptedPairsFromSchemas(): Array<{ variant: string; field: string }> {
  const pairs: Array<{ variant: string; field: string }> = [];
  for (const field of Object.keys(ImplementerStartSchema.shape)) {
    pairs.push({ variant: "implementer", field });
  }
  const reviewerFields = Object.keys(ReviewerStartObject.shape);
  const taskForbidden = new Set<string>(x_ReviewerTaskForbiddenFields);
  const branchForbidden = new Set<string>(x_ReviewerBranchForbiddenFields);
  for (const field of reviewerFields) {
    if (taskForbidden.has(field)) {
      continue;
    }
    pairs.push({ variant: "reviewer:task", field });
  }
  for (const field of reviewerFields) {
    if (field === "task" || branchForbidden.has(field)) {
      continue;
    }
    pairs.push({ variant: "reviewer:branch", field });
  }
  for (const field of Object.keys(FixerStartSchema.shape)) {
    pairs.push({ variant: "fixer", field });
  }
  for (const field of Object.keys(ReReviewerStartSchema.shape)) {
    pairs.push({ variant: "re-reviewer", field });
  }
  for (const field of Object.keys(FixFollowupSchema.shape)) {
    pairs.push({ variant: "followup:fix", field });
  }
  for (const field of Object.keys(ReReviewFollowupSchema.shape)) {
    pairs.push({ variant: "followup:re-review", field });
  }
  return pairs;
}

function ZodFieldIsOptional(schema: z.ZodTypeAny): boolean {
  const typeName = (schema as { _def: { typeName: string } })._def.typeName;
  return typeName === "ZodOptional" || typeName === "ZodDefault";
}

function NonOperationalRequiredKeys(
  shape: Record<string, z.ZodTypeAny>,
): string[] {
  return Object.entries(shape)
    .filter(([key, schema]) => (
      !ZodFieldIsOptional(schema) && !OPERATIONAL_FIELDS.includes(key)
    ))
    .map(([key]) => key);
}

// Schema-side always-required set per variant. Compared to what the manifest
// marks `always`, so x_UnionAlwaysRequired cannot drift from the union.
//
function SchemaAlwaysRequiredFields(variant: DispatchVariant): string[] {
  switch (variant) {
    case "implementer":
      return NonOperationalRequiredKeys(ImplementerStartSchema.shape).sort();
    case "reviewer:task":
      return [...new Set([
        ...NonOperationalRequiredKeys(ReviewerStartObject.shape),
        // Task presence selects this branch; the shape marks it optional.
        //
        "task",
        ...x_ReviewerTaskRequiredFields,
      ])]
        .filter((field) => !(x_ReviewerTaskForbiddenFields as readonly string[]).includes(field))
        .sort();
    case "reviewer:branch":
      return [...new Set([
        ...NonOperationalRequiredKeys(ReviewerStartObject.shape),
        ...x_ReviewerBranchRequiredFields,
      ])]
        .filter((field) => (
          field !== "task"
          && !(x_ReviewerBranchForbiddenFields as readonly string[]).includes(field)
        ))
        .sort();
    case "fixer":
      return NonOperationalRequiredKeys(FixerStartSchema.shape).sort();
    case "re-reviewer":
      return NonOperationalRequiredKeys(ReReviewerStartSchema.shape).sort();
    case "followup:fix":
      return NonOperationalRequiredKeys(FixFollowupSchema.shape).sort();
    case "followup:re-review":
      return NonOperationalRequiredKeys(ReReviewFollowupSchema.shape).sort();
  }
}

function ManifestAlwaysRequiredFields(variant: string): string[] {
  return [...new Set(
    DispatchManifest()
      .filter((entry) => (
        entry.variant === variant
        && entry.provenance === "caller_input"
        && entry.field !== null
        && entry.requiredCondition === "always"
      ))
      .map((entry) => entry.field as string),
  )].sort();
}

function FieldDescription(field: string, tool: "start" | "followup" = "start"): string {
  const startShape = XagentSddStartAdvertisedSchema.shape as Record<
    string,
    { description?: string }
  >;
  const followupShape = XagentSddFollowupAdvertisedSchema.shape as Record<
    string,
    { description?: string }
  >;
  if (tool === "followup") {
    return followupShape[field]?.description ?? "";
  }
  return startShape[field]?.description ?? followupShape[field]?.description ?? "";
}

function RequiredForClause(described: string): string | null {
  const prefix = "(required for: ";
  const start = described.indexOf(prefix);
  if (start < 0) {
    return null;
  }
  const from = start + prefix.length;
  // Labels may themselves contain parentheses (task-scoped); the clause is
  // always the trailing parenthetical, so take through the final ')'.
  //
  const end = described.lastIndexOf(")");
  if (end <= from) {
    return null;
  }
  return described.slice(from, end);
}

function ExpectedRolesForField(field: string, tool: "start" | "followup"): string {
  const labels: string[] = [];
  for (const variant of DISPATCH_VARIANTS) {
    if (!(REGISTRY[variant] as readonly string[]).includes(field)) {
      continue;
    }
    if (tool === "start") {
      switch (variant) {
        case "implementer":
          labels.push("implementer");
          break;
        case "reviewer:task":
          labels.push("reviewer (task-scoped)");
          break;
        case "reviewer:branch":
          labels.push("reviewer (whole-branch)");
          break;
        case "fixer":
          labels.push("fixer");
          break;
        case "re-reviewer":
          labels.push("re-reviewer");
          break;
        default:
          break;
      }
    }
    else if (variant === "followup:fix") {
      labels.push("fix");
    }
    else if (variant === "followup:re-review") {
      labels.push("re-review");
    }
  }
  const hasTask = labels.includes("reviewer (task-scoped)");
  const hasBranch = labels.includes("reviewer (whole-branch)");
  if (hasTask && hasBranch) {
    const collapsed: string[] = [];
    let inserted = false;
    for (const label of labels) {
      if (label === "reviewer (task-scoped)" || label === "reviewer (whole-branch)") {
        if (!inserted) {
          collapsed.push("reviewer");
          inserted = true;
        }
        continue;
      }
      collapsed.push(label);
    }
    return collapsed.join(", ");
  }
  return labels.join(", ");
}

function FullRenderInputFor(variant: string): RenderSddPromptInput {
  const base = { repoRoot: "/repo", cwd: "/cwd", plan: "/tmp/plan.md" };
  switch (variant) {
    case "implementer":
      return {
        role: "implementer",
        ...base,
        task: 1,
        name: "n",
        brief: "/tmp/brief.md",
        reportOut: "/tmp/report.md",
        context: "scene",
      };
    case "reviewer:task":
      return {
        role: "task-reviewer",
        ...base,
        task: 1,
        brief: "/tmp/brief.md",
        implementerReport: "/tmp/report.md",
        base: "main",
        head: "HEAD",
        constraints: "/tmp/constraints.md",
        diff: "/tmp/diff.md",
      };
    case "reviewer:branch":
      return {
        role: "code-reviewer",
        ...base,
        reviewBrief: "/tmp/brief.md",
        description: "branch does X",
        base: "main",
        head: "HEAD",
      };
    case "re-reviewer":
      return {
        role: "re-review",
        ...base,
        task: 1,
        round: 1,
        brief: "/tmp/brief.md",
        findings: "/tmp/findings.md",
        fixerReport: "/tmp/fixer.md",
        base: "main",
        head: "HEAD",
        diff: "/tmp/diff.md",
        dispatchVariant: "re-reviewer",
      };
    case "followup:re-review":
      return {
        role: "re-review",
        ...base,
        task: 1,
        round: 1,
        brief: "/tmp/brief.md",
        findings: "/tmp/findings.md",
        fixerReport: "/tmp/fixer.md",
        base: "main",
        head: "HEAD",
        diff: "/tmp/diff.md",
        dispatchVariant: "followup:re-review",
        runId: "xrun_20260727000000000_abcdef12",
      };
    default:
      throw new Error(`no render input for ${variant}`);
  }
}

test("recognized routes equal the registry variant keys", () => {
  // Membership tracks the union option count: reviewer expands one role into
  // two variants, so recognized length is startOptions + 1 + followupOptions.
  //
  const startCount = (
    XagentSddStartInputSchema as unknown as { _def: { schema: { options: unknown[] } } }
  )._def.schema.options.length;
  const followupCount = (
    XagentSddFollowupInputSchema as unknown as { options: unknown[] }
  ).options.length;
  assert.equal(
    RecognizedDispatchVariants().length,
    startCount + 1 + followupCount,
    "route count must track union option membership",
  );
  assert.deepEqual(
    RecognizedDispatchVariants(),
    [...DISPATCH_VARIANTS].sort(),
    "union/refinement/follow-up routes must equal DISPATCH_VARIANTS",
  );
});

test("the caller-input projection exactly equals the registry matrix", () => {
  const projection = CallerInputProjection()
    .map((e) => `${e.variant}\u0000${e.field}`).sort();
  const expected = Object.entries(REGISTRY)
    .flatMap(([v, fields]) => fields.map((f) => `${v}\u0000${f}`)).sort();
  assert.deepEqual(projection, expected,
    "projection must equal the matrix — neither subset nor superset");
});

test("schema-accepted pairs, less operational fields, equal the registry", () => {
  // Equality #2. The subtraction is required: the registry holds in-scope
  // fields only, so an unfiltered comparison can never succeed.
  //
  const accepted = AcceptedPairsFromSchemas()
    .filter((e) => !OPERATIONAL_FIELDS.includes(e.field));
  assert.deepEqual(
    accepted.map((e) => `${e.variant}\u0000${e.field}`).sort(),
    Object.entries(REGISTRY).flatMap(([v, fs]) => fs.map((f) => `${v}\u0000${f}`)).sort());
});

test("an option reachable two ways has an entry per provenance", () => {
  const diff = DispatchManifest().filter(
    (e) => e.variant === "reviewer:task" && e.rendererOption === "--diff");
  assert.deepEqual(diff.map((e) => e.provenance).sort(), ["caller_input", "derived"]);
  assert.equal(diff.find((e) => e.provenance === "derived")?.field, null);
});

test("manifest variants exactly equal the registry keys", () => {
  // Real coverage of the closed set: every registered variant appears, and
  // nothing else. Unregistered routes are caught by equality #1 above.
  //
  assert.deepEqual(
    [...new Set(DispatchManifest().map((e) => e.variant))].sort(),
    [...DISPATCH_VARIANTS].sort(),
  );
});

test("manifest always-required fields equal the schemas", () => {
  for (const variant of DISPATCH_VARIANTS) {
    const fromSchema = SchemaAlwaysRequiredFields(variant);
    const fromManifest = ManifestAlwaysRequiredFields(variant);
    assert.deepEqual(
      fromManifest,
      fromSchema,
      `${variant}: manifest always-required must equal schema requiredness`,
    );
    // A union-required --report surface field cannot have a derived provenance.
    //
    for (const field of fromSchema) {
      const entry = DispatchManifest().find(
        (e) => e.variant === variant && e.field === field,
      );
      if (entry?.rendererOption !== "--report") {
        continue;
      }
      assert.equal(
        DispatchManifest().filter((e) => (
          e.variant === variant
          && e.rendererOption === "--report"
          && e.provenance === "derived"
        )).length,
        0,
        `${variant} must not emit derived --report for always-required ${field}`,
      );
    }
  }
});

test("service-formatted variants are covered by the service source", () => {
  for (const variant of ["fixer", "followup:fix"]) {
    const entries = DispatchManifest().filter((e) => e.variant === variant);
    assert.ok(entries.length > 0, `${variant} has no manifest entries`);
    assert.equal(entries.every((e) => e.source === "service"), true);
    assert.equal(entries.find((e) => e.field === "report_out")?.direction, "writes");
  }
});

test("a path surface field delivered by an inlining slot records both facts", () => {
  const brief = DispatchManifest().find(
    (e) => e.variant === "reviewer:branch" && e.field === "brief");
  assert.equal(brief?.surfaceKind, "path");
  assert.equal(brief?.direction, "reads");
  assert.equal(brief?.transport, "inlined_contents");
  assert.equal(brief?.rendererOption, "--requirements");
});

test("one renderer option maps to the variant's own surface field", () => {
  assert.equal(SurfaceFieldFor("implementer", "--report"), "report_out");
  assert.equal(SurfaceFieldFor("reviewer:task", "--report"), "implementer_report");
  assert.equal(SurfaceFieldFor("re-reviewer", "--report"), "fixer_report");
});

test("non-artifact caller options resolve, ledger options do not", () => {
  assert.equal(SurfaceFieldFor("implementer", "--name"), "name");
  assert.equal(SurfaceFieldFor("reviewer:task", "--base"), "base");
  assert.equal(SurfaceFieldFor("implementer", "--task"), "task");
  // Sourced from the sdd_agents row, not from the caller — no public field
  // to blame, so these route to sdd_stored_artifact_missing instead.
  //
  assert.equal(SurfaceFieldFor("followup:re-review", "--brief"), null);
  assert.equal(SurfaceFieldFor("followup:re-review", "--plan"), null);
  // An option the facade never sends.
  //
  assert.equal(SurfaceFieldFor("implementer", "--out"), null);
});

test("advertised descriptions agree with the manifest", () => {
  for (const entry of DispatchManifest().filter(
    (e) => e.field !== null && e.direction !== null && e.provenance === "caller_input",
  )) {
    const field = entry.field as string;
    const described = FieldDescription(field);
    if (entry.direction === "writes") {
      assert.match(described, /writes/i,
        `${field} (${entry.variant}) is writes but described as "${described}"`);
      assert.doesNotMatch(described, /\breads\b/i,
        `${field} (${entry.variant}) is writes but also claims reads: "${described}"`);
    }
    else {
      assert.match(described, /reads|must already exist/i,
        `${field} (${entry.variant}) is reads but described as "${described}"`);
      assert.doesNotMatch(described, /\bwrites\b/i,
        `${field} (${entry.variant}) is reads but also claims writes: "${described}"`);
    }
    if (entry.requiredCondition === "unless-derivable") {
      assert.ok(
        entry.derivation !== null,
        `${field} (${entry.variant}) is unless-derivable without a derivation`,
      );
      const pattern = entry.derivation.kind === "plan_workspace"
        ? entry.derivation.pattern
        : null;
      assert.ok(
        /required unless|unless the plan workspace/i.test(described),
        `${field} (${entry.variant}) is unless-derivable but described as optional: "${described}"`,
      );
      if (pattern !== null) {
        const humanized = pattern
          .replaceAll("{short(base)}", "<short base sha>")
          .replaceAll("{short(head)}", "<short head sha>");
        assert.ok(
          described.includes(humanized),
          `${field} description must name humanized derivation pattern ${humanized}`,
        );
        assert.ok(
          !described.includes("{short("),
          `${field} description must not leak renderer templating syntax`,
        );
      }
    }
    else if (entry.requiredCondition === "always") {
      assert.doesNotMatch(
        described,
        /\boptional\b/i,
        `${field} (${entry.variant}) is always but described as optional: "${described}"`,
      );
    }
  }
});

test("advertised (required for:) clauses derive from the registry per tool", () => {
  for (const field of ["task", "brief", "diff", "report_out", "fixer_report", "base"]) {
    const startDesc = FieldDescription(field, "start");
    if (startDesc.includes("(required for:")) {
      assert.equal(
        RequiredForClause(startDesc),
        ExpectedRolesForField(field, "start"),
        `start ${field} roles must equal registry projection`,
      );
    }
    const followupDesc = FieldDescription(field, "followup");
    if (followupDesc.includes("(required for:")) {
      assert.equal(
        RequiredForClause(followupDesc),
        ExpectedRolesForField(field, "followup"),
        `followup ${field} roles must equal registry projection`,
      );
      assert.doesNotMatch(
        RequiredForClause(followupDesc) ?? "",
        /reviewer \(task-scoped\)|implementer|fixer(?!-report)|re-reviewer/,
        `followup ${field} must not name start roles`,
      );
    }
  }
  assert.equal(
    RequiredForClause(FieldDescription("diff", "start")),
    "reviewer (task-scoped), re-reviewer",
  );
  assert.equal(
    RequiredForClause(FieldDescription("diff", "followup")),
    "re-review",
  );
});

test("BuildDispatchArgs supplied options are covered by x_OptionFields", () => {
  // Fourth equality: every option the facade emits (with all optionals
  // supplied) must appear in x_OptionFields, or dpr-10 trailers naming it
  // fall through to opaque sdd_renderer_failed.
  //
  for (const variant of Object.keys(x_OptionFields)) {
    const { suppliedOptions } = BuildDispatchArgs(FullRenderInputFor(variant));
    const declared = new Set(Object.keys(x_OptionFields[variant]!));
    for (const option of suppliedOptions) {
      assert.ok(
        declared.has(option),
        `${variant}: BuildDispatchArgs emits ${option} but x_OptionFields does not list it`,
      );
    }
  }
});

test("followup:re-review ledger options carry null surface fields", () => {
  for (const option of ["--plan", "--task", "--brief"]) {
    const entries = DispatchManifest().filter(
      (e) => e.variant === "followup:re-review" && e.rendererOption === option,
    );
    assert.ok(entries.length > 0, `${option} missing from followup:re-review`);
    assert.equal(entries.every((e) => e.provenance === "ledger"), true);
    assert.equal(entries.every((e) => e.field === null), true);
  }
});

test("plan is reads under the artifact-lifecycle definition", () => {
  const plan = DispatchManifest().find(
    (e) => e.variant === "implementer" && e.field === "plan",
  );
  assert.equal(plan?.direction, "reads");
  assert.equal(plan?.surfaceKind, "path");
});
