## Context

The SDD dispatch surface has three layers: `dispatch-prompt` (the renderer, which
owns the real contract), `sdd_prompt.ts` / `sdd_manager.ts` (the facade, which
translates MCP input into renderer arguments), and `tool_schemas.ts` (the
advertised schema plus the enforcing union). The renderer's own contract has been
correct throughout — `--help` reads `--report: implementer report file`. The
facade's advertised description says the opposite for half the roles, and the
facade is the only layer a controller can see.

Two controllers built wrong calls from it. The 2026-07-28 opus-5 session
(`afc24542`) recovered in about fifteen minutes by running the renderer by hand;
the 2026-07-29 session (`85b47883`) escalated with a diagnosis that was wrong
twice over — it blamed a `--dir` flag the facade never sends, and concluded the
task-reviewer template had "zero placeholders" after grepping `\[[a-z ]*\]`
against a template whose six placeholders are uppercase.

Constraints: only `main` is deployed, nothing redeploys until this change is
complete, and implementation happens in isolated worktrees. That removes the
usual reason to carry compatibility aliases.

## Goals / Non-Goals

**Goals:**

- Every advertised description is true against the renderer, and a test fails
  when it stops being true.
- No field name means two things; no value has two names.
- A renderer argument fault tells the caller which of its own arguments was
  wrong, without disclosing template or brief bodies.
- Every doc, spec, and skill that describes this API agrees with it.

**Non-Goals:**

- Changing renderer slot semantics. They are correct; only their description and
  their normative statement in `dpr-5` change.
- Compatibility aliases or a deprecation window.
- Redesigning the role union, the ledger schema, or the await/close lifecycle.
- Changing the vendored Superpowers templates, which are upstream.

## Decisions

**D1 — Split `report` by direction rather than adding a role-conditional
description.** `report_out` where the agent writes (`implementer`, `fixer`,
follow-up `fix`); `implementer_report` and `fixer_report` where it reads an
existing file (`reviewer` with `task`, `re-reviewer`, follow-up `re-review`).

*Alternative considered:* keep `report` and make the description role-conditional.
Rejected — a description is advisory and a name is not. The controller that
escalated read a role-scoped description (`AdvertisedFor(...)` already names
roles) and still built the wrong call, because the field name told it the field
was uniform. Naming the reader's input after the writer that produced it also
makes the data flow legible: a reviewer reads the `implementer_report`.

*Secondary benefit:* `report` as a bare input name disappears, ending its
collision with `report.text` in the `xagent_await` result, which is final
assistant text rather than a path.

**D2 — Rename `agent` to `model`.** It holds a provider model name, it sits one
letter from the unrelated `agent_id`, and `xagent_start_non_sdd` already calls the
identical concept `model`. Renaming fixes a name-with-two-meanings and a
concept-with-two-names in one move, and leaves "agent" meaning the dispatched
worker everywhere on the surface — including the `sdd_agent_not_live` and
`sdd_agent_busy` error names, which become unambiguous rather than needing to be
read against a `agent: "opus"` field.

**D3 — Return `run_id`, not `agent_id`.** It is the same value the generic tools
take as `run_id`; the schema's own validator message says so. Both skills
currently teach the aliasing in prose, which is the tell. The internal
`sdd_agents.agent_id` column keeps its name — it is a ledger identity, never a
tool field, and `xsdd-4` is untouched.

*Alternative considered:* rename `run_id` to `agent_id` on the generic tools
instead. Rejected — the generic tools serve non-SDD runs that have no agent
identity, and the blast radius is much larger.

**D4 — Make the renderer boundary visible instead of moving it.** `diff` is
required by the task-review and re-review templates and advertised optional.
Rather than give `[DIFF_FILE]` a fallback (which would silently render a review
prompt with no diff — worse than failing), the union and the advertised schema
learn the renderer's rule: required unless the plan workspace holds the derivable
`review-<base>..<head>.diff`. The service validates before dispatch, so the
failure arrives as a structured input error rather than an opaque exit 2.

This is a third asymmetry the `xsvc-15` comment block did not anticipate. It
reasons about the advertised schema versus the union, and concludes only
over-strict advertisement is a defect. The union accepting a payload the
*renderer* then rejects is equally a defect, and `xsvc-17` names it.

**D5 — Classify renderer argument errors from an allowlist, keep stderr
suppressed.** `sdd_prompt.ts` already does exactly this for
`sdd_templates_missing` by matching a fixed substring; the new
`sdd_renderer_bad_input` follows the same shape, matching the `dpr-10` grammar and
returning `{ flag, reason }`. Raw stderr stays withheld because it can carry
inlined brief and findings text. An option name and a caller-supplied path are
already in the caller's request, so returning them discloses nothing new.

*Alternative considered:* pass stderr through when the exit is an argument fault.
Rejected — classification is what makes the disclosure boundary auditable; a
passthrough would depend on the renderer never inlining a body into an argument
diagnostic, which `dpr-10` can require but a passthrough cannot verify.

**D6 — Keep `brief` and keep `task`-presence as the review-mode discriminator.**
The audit flagged both. `brief` names the assignment document for the dispatch in
every role; the task-scoped reviewer's is the implementer's task brief and the
whole-branch reviewer's is purpose-written, but the function is identical, so
`xsdd-9` records this as documented rather than renamed. `task` presence
selecting the template is the existing discriminated-union design and is already
enforced by refinements that reject the wrong companion fields; splitting
`reviewer` into two roles would reverse a deliberate v2 unification for no
clarity the descriptions cannot supply.

**D7 — The renderer is the single source of truth, enforced by test.** The
tool-surface suite reads the renderer's slot table — direction and fallback
presence — and asserts the advertised descriptions and union optionality agree.
This is the requirement that keeps the class of defect from recurring; the
renames only fix today's instance.

## Risks / Trade-offs

- **A live controller mid-plan breaks on the rename.** → Accepted and intended:
  nothing redeploys until the change is complete, and the strict union rejects
  retired names loudly rather than ignoring them. The stuck session is unblocked
  by the corrected invocation, not by this change landing.
- **The slot-table test couples the service suite to a Python utility.** →
  The coupling already exists at runtime; the test makes it visible. The renderer
  exposes its table through a machine-readable dump rather than the suite parsing
  Python source.
- **`dpr-10`'s grammar constrains future renderer error text.** → It constrains
  only argument faults, which are already one line and already name their option.
- **Splitting `report` into three names grows the field list.** → The union is
  already role-discriminated, so each role still sees exactly one report field;
  only the advertised superset grows, and its job is description, not enforcement.
- **The audit corrects skills that in-flight sessions have already read.** →
  Skill text is read at session start, so corrections reach new sessions only.
  This is why the renames must land with the docs, not before them.

## Migration Plan

1. Land the renderer changes first (`dpr-5` declarations, `dpr-10` grammar,
   slot-table dump) — additive, no facade dependency.
2. Land the facade renames, the `diff` requirement, and error classification
   together; they share the union and would leave the surface inconsistent if
   split.
3. Land the doc, spec, and skill corrections in the same change so no published
   surface describes a retired name.
4. Rebuild and redeploy the service as one unit. There is no partial-deploy
   state: a renamed union and an old skill would produce exactly the failure this
   change exists to remove.

Rollback is `git revert` of the whole change plus a redeploy; there is no data
migration, since no renamed field is persisted — `sdd_agents` columns are
untouched.

## Open Questions

None blocking. One deferred: whether `constraints` should also be required for a
task-scoped reviewer rather than falling back to "None beyond the task brief."
The fallback is real optionality, so it is truthful today; whether a review
*should* proceed without global constraints is a workflow question for the
Superpowers plan template, not an API-clarity defect.
