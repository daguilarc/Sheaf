import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Derivation =
  | { readonly kind: "repo_root" }
  | {
      readonly kind: "plan_workspace";
      readonly pattern: string;
      readonly requires_existing: boolean;
    };

export type ManifestEntry = {
  readonly variant: string;
  readonly field: string | null;
  readonly source: "renderer" | "service";
  readonly rendererOption: string | null;
  readonly provenance: "caller_input" | "ledger" | "derived";
  readonly surfaceKind: "path" | "text";
  readonly direction: "reads" | "writes" | null;
  readonly transport: "path_substituted" | "inlined_contents" | "not_applicable";
  readonly requiredCondition: "always" | "unless-derivable" | "optional";
  readonly derivation: Derivation | null;
};

export type DispatchVariant = (typeof DISPATCH_VARIANTS)[number];

export const DISPATCH_VARIANTS = [
  "implementer",
  "reviewer:task",
  "reviewer:branch",
  "fixer",
  "re-reviewer",
  "followup:fix",
  "followup:re-review",
] as const;

export const OPERATIONAL_FIELDS: readonly string[] = [
  "role",
  "kind",
  "cwd",
  "model",
  "harness",
  "effort",
  "policy",
  "note",
  "run_id",
];

export const ARTIFACT_FIELDS: readonly string[] = [
  "plan",
  "brief",
  "report_out",
  "implementer_report",
  "fixer_report",
  "constraints",
  "diff",
  "findings",
];

// Closed registry matrix: each public dispatch variant mapped to its in-scope
// fields. Operational fields are excluded; equality checks subtract them from
// the schema-accepted set before comparing (xsvc-17).
//
export const REGISTRY: Record<DispatchVariant, readonly string[]> = {
  "implementer": [
    "plan", "task", "name", "brief", "report_out", "context",
  ],
  "reviewer:task": [
    "plan", "task", "brief", "base", "head", "implementer_report",
    "constraints", "diff",
  ],
  "reviewer:branch": [
    "plan", "brief", "base", "head", "description",
  ],
  "fixer": [
    "plan", "task", "brief", "findings", "findings_text", "tests",
    "report_out", "round",
  ],
  "re-reviewer": [
    "plan", "task", "brief", "findings", "fixer_report", "base", "head",
    "diff", "round",
  ],
  "followup:fix": [
    "findings", "findings_text", "tests", "report_out", "round",
  ],
  "followup:re-review": [
    "findings", "fixer_report", "base", "head", "diff", "round",
  ],
};

// The renderer owns the contract for the variants it renders. `fixer` and
// follow-up `fix` have no Superpowers template — upstream a fix is a follow-up
// to a live implementer — so their prompt text in sdd_prompt.ts is the
// authority, declared here (xsvc-17).
//
export const x_ServiceEntries: readonly ManifestEntry[] = [
  {
    variant: "fixer", field: "plan", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "path", direction: "reads",
    transport: "path_substituted", requiredCondition: "always", derivation: null,
  },
  {
    variant: "fixer", field: "task", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "text", direction: null,
    transport: "not_applicable", requiredCondition: "always", derivation: null,
  },
  {
    variant: "fixer", field: "brief", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "path", direction: "reads",
    transport: "path_substituted", requiredCondition: "always", derivation: null,
  },
  {
    variant: "fixer", field: "findings", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "path", direction: "reads",
    transport: "inlined_contents", requiredCondition: "always", derivation: null,
  },
  {
    variant: "fixer", field: "findings_text", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "text", direction: null,
    transport: "not_applicable", requiredCondition: "always", derivation: null,
  },
  {
    variant: "fixer", field: "tests", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "text", direction: null,
    transport: "not_applicable", requiredCondition: "always", derivation: null,
  },
  {
    variant: "fixer", field: "report_out", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "path", direction: "writes",
    transport: "path_substituted", requiredCondition: "always", derivation: null,
  },
  {
    variant: "fixer", field: "round", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "text", direction: null,
    transport: "not_applicable", requiredCondition: "optional", derivation: null,
  },
  {
    variant: "followup:fix", field: "findings", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "path", direction: "reads",
    transport: "inlined_contents", requiredCondition: "always", derivation: null,
  },
  {
    variant: "followup:fix", field: "findings_text", source: "service",
    rendererOption: null, provenance: "caller_input", surfaceKind: "text",
    direction: null, transport: "not_applicable", requiredCondition: "always",
    derivation: null,
  },
  {
    variant: "followup:fix", field: "tests", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "text", direction: null,
    transport: "not_applicable", requiredCondition: "always", derivation: null,
  },
  {
    variant: "followup:fix", field: "report_out", source: "service",
    rendererOption: null, provenance: "caller_input", surfaceKind: "path",
    direction: "writes", transport: "path_substituted",
    requiredCondition: "always", derivation: null,
  },
  {
    variant: "followup:fix", field: "round", source: "service", rendererOption: null,
    provenance: "caller_input", surfaceKind: "text", direction: null,
    transport: "not_applicable", requiredCondition: "always", derivation: null,
  },
];

export const x_VariantTemplates: Record<string, string | null> = {
  "implementer": "implementer",
  "reviewer:task": "task-reviewer",
  "reviewer:branch": "code-reviewer",
  "re-reviewer": "re-review",
  "followup:re-review": "re-review",
  "fixer": null,
  "followup:fix": null,
};

// Every renderer option the facade sends, per variant. Non-artifact options
// are here too: dpr-10 can name them in a trailer, and xsvc-18 requires every
// allowlisted trailer to resolve to a surface field. An option absent here is
// one the facade never sends, and classification falls back to opaque.
//
export const x_OptionFields: Record<string, Record<string, string>> = {
  "implementer": {
    "--report": "report_out",
    "--brief": "brief",
    "--name": "name",
    "--context": "context",
    "--task": "task",
    "--plan": "plan",
  },
  "reviewer:task": {
    "--report": "implementer_report",
    "--brief": "brief",
    "--constraints": "constraints",
    "--diff": "diff",
    "--base": "base",
    "--head": "head",
    "--task": "task",
    "--plan": "plan",
  },
  "reviewer:branch": {
    "--requirements": "brief",
    "--description": "description",
    "--base": "base",
    "--head": "head",
    "--plan": "plan",
  },
  "re-reviewer": {
    "--report": "fixer_report",
    "--brief": "brief",
    "--findings": "findings",
    "--diff": "diff",
    "--base": "base",
    "--head": "head",
    "--round": "round",
    "--task": "task",
    "--plan": "plan",
  },
  "followup:re-review": {
    "--report": "fixer_report",
    "--brief": "brief",
    "--findings": "findings",
    "--diff": "diff",
    "--base": "base",
    "--head": "head",
    "--round": "round",
    "--task": "task",
    "--plan": "plan",
  },
};

const x_LedgerOptionsByVariant: Record<string, readonly string[]> = {
  "followup:re-review": ["--plan", "--task", "--brief"],
};

const x_PathSurfaceFields = new Set(ARTIFACT_FIELDS);

export type DescribeSlot = {
  readonly option: string;
  readonly token: string;
  readonly kind: string;
  readonly direction: "reads" | "writes" | null;
  readonly has_fallback: boolean;
  readonly derivation: Derivation | null;
};

export type DescribeSlotsDoc = {
  readonly schema_version: number;
  readonly templates: Record<string, readonly DescribeSlot[]>;
};

function RequiredCondition(
  hasFallback: boolean,
  derivation: Derivation | null,
): ManifestEntry["requiredCondition"] {
  if (hasFallback) {
    return "optional";
  }
  if (derivation !== null) {
    return "unless-derivable";
  }
  return "always";
}

// Surface fields the union or reviewer refinement require unconditionally.
// A renderer derivation cannot make these omittable on the public surface —
// intersecting here keeps requiredCondition honest (xsvc-17).
//
const x_UnionAlwaysRequired: Readonly<Record<string, ReadonlySet<string>>> = {
  "implementer": new Set(["plan", "task", "name", "brief", "report_out"]),
  "reviewer:task": new Set([
    "plan", "task", "brief", "base", "head", "implementer_report",
  ]),
  "reviewer:branch": new Set(["plan", "brief", "base", "head", "description"]),
  "fixer": new Set([
    "plan", "task", "brief", "findings", "findings_text", "tests", "report_out",
  ]),
  "re-reviewer": new Set([
    "plan", "task", "brief", "findings", "fixer_report", "base", "head",
  ]),
  "followup:fix": new Set([
    "findings", "findings_text", "tests", "report_out", "round",
  ]),
  "followup:re-review": new Set([
    "findings", "fixer_report", "base", "head", "round",
  ]),
};

function FieldIsUnconditionallyRequired(
  variant: string,
  field: string | null,
): boolean {
  if (field === null) {
    return false;
  }
  return x_UnionAlwaysRequired[variant]?.has(field) === true;
}

function IntersectRequiredCondition(
  variant: string,
  field: string | null,
  fromRenderer: ManifestEntry["requiredCondition"],
): ManifestEntry["requiredCondition"] {
  // Ledger/derived entries carry no surface field; keep the renderer condition.
  //
  if (field === null) {
    return fromRenderer;
  }
  if (FieldIsUnconditionallyRequired(variant, field)) {
    return "always";
  }
  // The union does not require this field. A renderer-side "always" for a
  // synthesized option (e.g. re-reviewer --round, which has a Zod default)
  // must not outrank the schema.
  //
  if (fromRenderer === "always") {
    return "optional";
  }
  return fromRenderer;
}

function TransportFor(
  variant: string,
  option: string,
  slotKind: string | null,
): ManifestEntry["transport"] {
  // Whole-branch brief is a path on the surface and inlined by the renderer.
  //
  if (variant === "reviewer:branch" && option === "--requirements") {
    return "inlined_contents";
  }
  if (slotKind === "filetext") {
    return "inlined_contents";
  }
  if (slotKind === "path" || slotKind === "path_out") {
    return "path_substituted";
  }
  if (option === "--plan") {
    return "path_substituted";
  }
  return "not_applicable";
}

function DirectionFor(
  variant: string,
  option: string,
  field: string | null,
  slot: DescribeSlot | null,
): ManifestEntry["direction"] {
  if (variant === "reviewer:branch" && option === "--requirements") {
    return "reads";
  }
  if (option === "--plan") {
    return "reads";
  }
  if (field !== null && !x_PathSurfaceFields.has(field)) {
    return null;
  }
  if (slot !== null) {
    // Text/literal slots carry no direction even when the surface field is a
    // path delivered through them — handled above for --requirements.
    //
    if (slot.kind === "text" || slot.kind === "literal") {
      return null;
    }
    return slot.direction;
  }
  if (field !== null && x_PathSurfaceFields.has(field)) {
    return "reads";
  }
  return null;
}

function SurfaceKindFor(field: string | null, option: string): ManifestEntry["surfaceKind"] {
  if (field !== null) {
    return x_PathSurfaceFields.has(field) ? "path" : "text";
  }
  if (option === "--plan" || option === "--brief" || option === "--report"
    || option === "--diff" || option === "--constraints" || option === "--findings"
    || option === "--requirements") {
    return "path";
  }
  return "text";
}

function ProvenanceFor(
  variant: string,
  option: string,
): "caller_input" | "ledger" {
  const ledger = x_LedgerOptionsByVariant[variant];
  if (ledger !== undefined && ledger.includes(option)) {
    return "ledger";
  }
  return "caller_input";
}

function NormalizeDerivation(raw: unknown): Derivation | null {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (value.kind === "repo_root") {
    return { kind: "repo_root" };
  }
  if (value.kind === "plan_workspace"
    && typeof value.pattern === "string"
    && typeof value.requires_existing === "boolean") {
    return {
      kind: "plan_workspace",
      pattern: value.pattern,
      requires_existing: value.requires_existing,
    };
  }
  return null;
}

function BuildEntry(args: {
  readonly variant: string;
  readonly option: string;
  readonly provenance: ManifestEntry["provenance"];
  readonly slot: DescribeSlot | null;
}): ManifestEntry {
  const field = args.provenance === "caller_input"
    ? (x_OptionFields[args.variant]?.[args.option] ?? null)
    : null;
  const derivation = args.slot === null ? null : NormalizeDerivation(args.slot.derivation);
  const hasFallback = args.slot?.has_fallback === true;
  const fromRenderer = RequiredCondition(hasFallback, derivation);
  return {
    variant: args.variant,
    field,
    source: "renderer",
    rendererOption: args.option,
    provenance: args.provenance,
    surfaceKind: SurfaceKindFor(field, args.option),
    direction: DirectionFor(args.variant, args.option, field, args.slot),
    transport: TransportFor(args.variant, args.option, args.slot?.kind ?? null),
    requiredCondition: IntersectRequiredCondition(args.variant, field, fromRenderer),
    derivation,
  };
}

export function JoinDescribeSlots(doc: DescribeSlotsDoc): ManifestEntry[] {
  if (doc.schema_version !== 1) {
    throw new Error(
      `unsupported dispatch-prompt --describe-slots schema_version: ${doc.schema_version}`,
    );
  }
  const entries: ManifestEntry[] = [];
  for (const variant of DISPATCH_VARIANTS) {
    const template = x_VariantTemplates[variant];
    if (template === null || template === undefined) {
      continue;
    }
    const slots = doc.templates[template];
    if (slots === undefined) {
      throw new Error(`describe-slots missing template ${template} for ${variant}`);
    }
    const byOption = new Map(slots.map((slot) => [slot.option, slot]));
    const optionFields = x_OptionFields[variant];
    if (optionFields === undefined) {
      throw new Error(`missing option field map for ${variant}`);
    }
    for (const option of Object.keys(optionFields)) {
      const slot = byOption.get(option) ?? null;
      const primary = ProvenanceFor(variant, option);
      entries.push(BuildEntry({ variant, option, provenance: primary, slot }));
      // Derived provenance is only reachable when the caller can omit the
      // surface field. A union-required field is never omitted, so a derived
      // entry would describe an unreachable path (xsvc-17).
      //
      if (
        slot !== null
        && slot.derivation !== null
        && primary === "caller_input"
        && !FieldIsUnconditionallyRequired(variant, optionFields[option] ?? null)
      ) {
        entries.push(BuildEntry({
          variant,
          option,
          provenance: "derived",
          slot,
        }));
      }
    }
  }
  entries.push(...x_ServiceEntries);
  return entries;
}

export type GeneratedManifest = {
  readonly schema_version: 1;
  readonly entries: ManifestEntry[];
};

const x_GeneratedPath = fileURLToPath(
  new URL("./dispatch_manifest.generated.json", import.meta.url),
);

let x_Cached: ManifestEntry[] | undefined;

export function DispatchManifest(): ManifestEntry[] {
  if (x_Cached !== undefined) {
    return x_Cached;
  }
  const raw = JSON.parse(readFileSync(x_GeneratedPath, "utf8")) as GeneratedManifest;
  if (raw.schema_version !== 1) {
    throw new Error(
      `unsupported checked-in dispatch manifest schema_version: ${raw.schema_version}`,
    );
  }
  x_Cached = raw.entries;
  return x_Cached;
}

export function CallerInputProjection(): Array<{ variant: string; field: string }> {
  return DispatchManifest()
    .filter((entry) => entry.provenance === "caller_input" && entry.field !== null)
    .map((entry) => ({ variant: entry.variant, field: entry.field as string }));
}

export function SurfaceFieldFor(variant: string, rendererOption: string): string | null {
  const mapped = x_OptionFields[variant]?.[rendererOption];
  if (mapped === undefined) {
    return null;
  }
  const caller = DispatchManifest().find(
    (entry) => (
      entry.variant === variant
      && entry.rendererOption === rendererOption
      && entry.provenance === "caller_input"
    ),
  );
  return caller?.field ?? null;
}

export function ResolveFaultProvenance(
  variant: string,
  rendererOption: string,
  callerSuppliedOptions: ReadonlySet<string>,
): ManifestEntry["provenance"] | null {
  const entries = DispatchManifest().filter(
    (entry) => entry.variant === variant && entry.rendererOption === rendererOption,
  );
  if (entries.length === 0) {
    return null;
  }
  if (entries.some((entry) => entry.provenance === "ledger")) {
    return "ledger";
  }
  if (callerSuppliedOptions.has(rendererOption)) {
    return "caller_input";
  }
  if (entries.some((entry) => entry.provenance === "derived")) {
    return "derived";
  }
  if (entries.some((entry) => entry.provenance === "caller_input")) {
    return "caller_input";
  }
  return null;
}

export function DiffDerivationPattern(variant: string): string | null {
  const entry = DispatchManifest().find(
    (e) => (
      e.variant === variant
      && e.field === "diff"
      && e.derivation !== null
      && e.derivation.kind === "plan_workspace"
    ),
  );
  if (entry?.derivation?.kind !== "plan_workspace") {
    return null;
  }
  return entry.derivation.pattern;
}
