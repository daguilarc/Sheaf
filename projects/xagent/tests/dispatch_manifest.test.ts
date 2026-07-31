import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CallerInputProjection,
  DISPATCH_VARIANTS,
  DispatchManifest,
  OPERATIONAL_FIELDS,
  REGISTRY,
  SurfaceFieldFor,
} from "../src/service/dispatch_manifest.js";
import {
  FixFollowupSchema,
  FixerStartSchema,
  ImplementerStartSchema,
  ReReviewFollowupSchema,
  ReReviewerStartSchema,
  XagentSddFollowupAdvertisedSchema,
  XagentSddStartAdvertisedSchema,
} from "../src/service/tool_schemas.js";

// Equality #2 input: every (variant, field) pair the schemas accept. Reviewer
// task vs branch splits live in the refinement, not the flat object shape.
//
function AcceptedPairsFromSchemas(): Array<{ variant: string; field: string }> {
  const pairs: Array<{ variant: string; field: string }> = [];
  for (const field of Object.keys(ImplementerStartSchema.shape)) {
    pairs.push({ variant: "implementer", field });
  }
  const reviewerFields = [
    "role", "note", "cwd", "plan", "model", "harness", "effort", "policy",
    "task", "brief", "base", "head", "implementer_report", "constraints",
    "diff", "description",
  ];
  for (const field of reviewerFields) {
    if (field === "description") {
      continue;
    }
    pairs.push({ variant: "reviewer:task", field });
  }
  for (const field of reviewerFields) {
    if (
      field === "task"
      || field === "implementer_report"
      || field === "constraints"
      || field === "diff"
    ) {
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

test("a variant reusing only existing fields still fails until registered", () => {
  // The mutation guard: the advertised field set is flat, so a new variant
  // that reuses `brief` and `report_out` changes nothing observable there.
  //
  const manifest = DispatchManifest().concat([{
    variant: "reviewer:security",
    field: "brief",
    source: "service",
    rendererOption: null,
    provenance: "caller_input",
    surfaceKind: "path",
    direction: "reads",
    transport: "path_substituted",
    requiredCondition: "always",
    derivation: null,
  }]);
  const covered = new Set(manifest.map((e) => e.variant));
  assert.notDeepEqual([...covered].sort(), [...DISPATCH_VARIANTS].sort());
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
  const startShape = XagentSddStartAdvertisedSchema.shape;
  const followupShape = XagentSddFollowupAdvertisedSchema.shape;
  for (const entry of DispatchManifest().filter(
    (e) => e.field !== null && e.direction !== null,
  )) {
    const field = entry.field as string;
    const described =
      (startShape as Record<string, { description?: string }>)[field]?.description
      ?? (followupShape as Record<string, { description?: string }>)[field]?.description
      ?? "";
    const expected = entry.direction === "writes" ? /writes/i : /reads|must already exist/i;
    assert.match(described, expected,
      `${field} (${entry.variant}) is ${entry.direction} but described as "${described}"`);
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
