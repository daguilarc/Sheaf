## Context

The SDD dispatch surface has three layers: `dispatch-prompt` (the renderer,
which owns the contract for five of the seven public dispatch variants —
`re-reviewer` and `followup:re-review` reuse one template but stay distinct
manifest variants), `sdd_prompt.ts` /
`sdd_manager.ts` (the facade, which translates MCP input into renderer arguments
and formats the two variants the renderer has no template for), and
`tool_schemas.ts` (the advertised schema plus the enforcing union). The
renderer's own contract has been correct throughout — `--help` reads
`--report: implementer report file`. The facade's advertised description says the
opposite for half the roles, and the facade is the only layer a controller sees.

Two controllers built wrong calls from it. The 2026-07-28 opus-5 session
(`afc24542`) recovered in about fifteen minutes by running the renderer by hand;
the 2026-07-29 session (`85b47883`) escalated with a diagnosis wrong in both
particulars — it blamed a `--dir` flag the facade never sends, and concluded the
task-reviewer template had "zero placeholders" after grepping `\[[a-z ]*\]`
against a template whose six placeholders are uppercase.

A pre-plan spec review by gpt-5.6-sol against the first draft of these artifacts
returned thirteen findings, two Critical. This design incorporates all of them.

Constraints: only `main` is deployed, nothing redeploys until this change is
complete, and implementation happens in isolated worktrees. That removes the
usual reason to carry compatibility aliases.

## Goals / Non-Goals

**Goals:**

- Every advertised description is true against the prompt that consumes it, and
  a test fails when it stops being true.
- No field name means two things; no value has two names — including in error
  payloads, which are tool outputs.
- A renderer argument fault tells the caller which of *its own* fields was
  wrong, without disclosing template or brief bodies.
- Every doc, spec, skill, and shipped package that describes this API agrees
  with it.

**Non-Goals:**

- Changing renderer slot semantics. They are correct; their *declaration* and
  their normative statement in dpr-5 change.
- Adding fixer prompts to the vendored Superpowers tree.
- Compatibility aliases or a deprecation window.
- Redesigning the role union, the ledger schema, or the await/close lifecycle.

## Decisions

**D1 — Split `report` by direction rather than adding a role-conditional
description.** `report_out` where the agent writes (`implementer`, `fixer`,
follow-up `fix`); `implementer_report` and `fixer_report` where it reads an
existing file (`reviewer` with `task`, `re-reviewer`, follow-up `re-review`).

*Alternative considered:* keep `report` and make the description role-conditional.
Rejected — a description is advisory and a name is not. The controller that
escalated read a role-scoped description (`AdvertisedFor(...)` already names
roles) and still built the wrong call, because the field name told it the field
was uniform.

**D2 — Rename `agent` to `model`.** It holds a provider model name, sits one
letter from the unrelated `agent_id`, and `xagent_start_non_sdd` already calls the
identical concept `model`. This fixes a name-with-two-meanings and a
concept-with-two-names in one move, and leaves "agent" meaning the dispatched
worker everywhere — including `sdd_agent_not_live` and `sdd_agent_busy`, which
become unambiguous rather than needing to be read against an `agent: "opus"`
field.

**D3 — Return `run_id`, not `agent_id`, on every public surface.** Same value the
generic tools take; the schema's own validator message says so. The rename covers
results, structured error details, and validation message text, because those are
all tool outputs — a rename scoped to the success path could be completed while
still violating xsdd-9. The internal `sdd_agents.agent_id` column keeps its name.

**D4 — "Function" is logical purpose, not transport.** The spec review argued
that `brief` and `findings` also carry two functions, since a task reviewer's
`brief` is path-substituted (`--brief`) while a whole-branch reviewer's is
contents-inlined (`--requirements @FILE`), and `findings` splits the same way
between `fixer` and `re-review`. The owner ruled that the principle keys on
logical purpose. xsdd-9 now says so explicitly, and xsvc-17's "direction" is
narrowed to read-versus-write on caller-supplied paths.

The reasoning: a caller supplying "the findings for this task" supplies the same
artifact regardless of how the prompt ingests it, and no controller has ever
erred on that axis. What two controllers *did* get wrong is supplying a path they
intended to be written where an existing file was required. Transport is
described in the field description; direction is enforced by name.

*Consequence:* `brief` and `findings` keep single names, and the tool-surface
test asserts direction only on artifact-bearing path fields.

**D5 — Make the renderer boundary visible instead of moving it.** `diff` is
required by the task-review and re-review templates and advertised optional.
Rather than give `[DIFF_FILE]` a fallback — which would silently render a review
prompt with no diff, worse than failing — the union and the advertised schema
learn the renderer's rule: required unless the plan workspace holds the derivable
`review-<base>..<head>.diff`. This applies to the `reviewer` and `re-reviewer`
start roles **and** to follow-up kind `re-review`, which renders the same
template.

This is a third asymmetry the xsvc-15 comment block did not anticipate. It
reasons about the advertised schema versus the union and concludes only
over-strict advertisement is a defect. The union accepting a payload the
*renderer* then rejects is equally a defect, and xsvc-17 names it.

**D6 — Two manifest sources, because the renderer is not the whole surface.**
`fixer` and follow-up `fix` have no `dispatch-prompt` template. Superpowers ships
`implementer-prompt.md`, `task-reviewer-prompt.md`, and `re-review-prompt.md` and
no fix template, because upstream a fix is a follow-up to a live implementer or a
fresh implementer — the skill's own flowchart says "R≤3 resume implementer; R≥4
fresh implementer." `fixer` is a Sheaf-local recovery role added by the ledger-v2
four-way union, and its prompt is formatted in TypeScript so a fresh fixer's
prompt is byte-identical to the same-agent continuation plus a two-line preamble.

So the manifest joins the renderer's `--describe-slots` output with a
service-owned declaration for `fixer`/`fix`, and xsvc-17 requires their union to
cover every advertised artifact field.

*Alternative considered:* author `fixer-prompt.md` in the vendored Superpowers
tree. Rejected — it invents upstream content inside a tree whose value is being a
faithful copy, forces a dpr-2 change (which pins the renderer to exactly the four
upstream template names), and reintroduces the start/continuation drift the
current TypeScript formatting exists to prevent.

**D7 — Classify renderer argument faults from a structured trailer, not from
prose.** `sdd_prompt.ts` already classifies `sdd_templates_missing` by substring
match. Rather than extend prose matching, dpr-10 has the renderer emit a
single-line JSON object as the final stderr line, with an enumerated `error` code
and only enumerated keys — so no inlined body text can reach the stream through
it. The facade parses that last line, checks the code against a closed allowlist,
and otherwise falls back to the opaque `sdd_renderer_failed`. Raw stderr stays
withheld.

The reverse mapping matters as much as the code: the renderer only ever knows
`--report`, and the caller sent `implementer_report`. xsvc-18 requires the facade
to translate through the same manifest xsvc-17 describes the schema from, so the
error names the caller's field.

**D8 — Preserve unknown keys on both advertised dispatch schemas.** The SDK
validates against the advertised schema before the handler runs, and a plain
`z.object` strips undeclared keys — so a retired `agent` or `report` sent
alongside a valid payload would vanish before the strict union could reject it,
turning a loud error into a wrong dispatch. The repo already documents this
hazard and its fix for `xagent_await`. Union-level tests are insufficient here;
the tests must go through the real MCP boundary.

**D9 — A closed variant registry, compared for exact equality.** The second
review round found the seam: the advertised schemas are flat supersets carrying
no variant association, and task-scoped versus whole-branch reviewer lives in a
refinement. So a coverage check against the advertised field set cannot notice a
new variant that reuses only existing fields. xsvc-17 therefore declares seven
variants explicitly — `implementer`, `reviewer:task`, `reviewer:branch`,
`fixer`, `re-reviewer`, `followup:fix`, `followup:re-review` — and requires the
manifest's `(variant, field)` pairs to *equal* the registry's, not merely cover
it. A mutation test adds a field-reusing variant and asserts the suite fails
until it is registered.

**D10 — The manifest is a generated, checked-in artifact, not a startup
subprocess.** The advertised schemas are module-level constants and MCP
registration is synchronous, so building the manifest at startup would add
Python availability, renderer resolution, and schema-version negotiation to the
service's boot path — for data that changes only when the renderer does.
Generating it at packaging time with a `--check` verification mode makes drift a
build failure instead, matching how `package_xagent.py --check` already gates the
shipped plugin. A test-only comparison was rejected: it would leave production
descriptions independently authored, which is precisely what xsvc-17 forbids.

**D11 — Direction is a property of the surface field; transport is a property of
the slot.** A whole-branch reviewer's `brief` is a path the agent reads,
delivered through the renderer's `--requirements` *text* slot, which dpr-5
correctly gives no direction. Recording `direction: reads` alongside
`transport: inlined_contents` lets both statements be true at once. Without the
split, the narrowed direction rule and dpr-5 contradict each other on the one
field that most needed describing.

## Risks / Trade-offs

- **A live controller mid-plan breaks on the rename.** → Accepted and intended:
  nothing redeploys until the change is complete, and the union rejects retired
  names loudly rather than ignoring them (D8 is what makes that true).
- **The tool-surface test couples the service suite to a Python utility.** →
  The coupling already exists at runtime; the test makes it visible, and dpr-11
  gives it a versioned interface rather than parsing Python source.
- **Two manifest sources can drift from each other.** → The suite fails when
  their union does not cover every advertised artifact field, so a new variant
  in either source without a description is a red build.
- **dpr-10's trailer constrains renderer error output.** → It constrains only
  the enumerated argument faults, and it is additive: human-readable lines may
  still precede it.
- **The shipped plugin package can lag the source.** → `make xagent-plugin-test`
  runs `package_xagent.py --check` and root `make test` depends on it, so a stale
  package is already a failing build. The change adds the rebuild as an explicit
  task rather than relying on someone noticing.

## Migration Plan

Task dependency edges are real and were mis-stated in the first draft:

1. **Task 1 (renderer)** — dpr-5 declarations, dpr-10 trailer, dpr-11
   `--describe-slots`. No facade dependency. **Produces the interfaces Tasks 3
   and 4 consume**, so it lands first.
2. **Task 2 (facade renames)** — independent of Task 1; touches the union,
   results, and error details.
3. **Task 3 (facade manifest, descriptions, `diff`, error classification)** —
   consumes Task 1's `--describe-slots` and trailer, and Task 2's vocabulary.
4. **Task 4 (docs, skills, package rebuild)** — consumes the finished
   vocabulary and error surface.

Rollback is `git revert` of the whole change plus a redeploy; there is no data
migration, since no renamed field is persisted — `sdd_agents` columns are
untouched.

## Open Questions

None blocking. One deferred: whether `constraints` should be required for a
task-scoped reviewer rather than falling back to "None beyond the task brief."
The fallback is real optionality, so the advertisement is truthful today; whether
a review *should* proceed without global constraints is a workflow question for
the Superpowers plan template, not an API-clarity defect.
