## 1. Renderer: declare the contract it already enforces (dpr-5, dpr-10)

- [ ] 1.1 Add an explicit `direction` to each `Slot` in `dispatch-prompt` (`reads`, `writes`, `inlines`) derived from the existing `path` / `path_out` / `filetext` / `literal` kinds, keeping current validation behaviour byte-identical
- [ ] 1.2 Make fallback-absence the single marker of requiredness in the render loop, and drop or align the now-redundant `required=True` flag so the two cannot disagree
- [ ] 1.3 Bring `--help` text in line with the slot directions, notably `--report` per template and `--diff` on the task-review and re-review templates
- [ ] 1.4 Normalize argument-fault diagnostics to the `dpr-10` single-line grammar and add a test asserting no inlined constraints or findings content reaches stderr
- [ ] 1.5 Add a machine-readable slot-table dump (`--describe-slots`, JSON: template, option, token, direction, required) for embedders to assert against
- [ ] 1.6 Extend `dispatch_prompt_test.py` for the new dpr-5 scenarios: write-direction path need not exist, read-direction path must exist, fallback-less slot is required

## 2. Facade: rename the fields (xsdd-2, xsdd-3, xsdd-9)

- [ ] 2.1 Rename `agent` to `model` across `tool_schemas.ts`, `sdd_manager.ts`, and the advertised schema
- [ ] 2.2 Split the report field: `report_out` for `implementer` / `fixer` / follow-up `fix`; `implementer_report` for task-scoped `reviewer`; `fixer_report` for `re-reviewer` and follow-up `re-review`
- [ ] 2.3 Rename the returned identifier and the follow-up input from `agent_id` to `run_id`, leaving the `sdd_agents.agent_id` column untouched
- [ ] 2.4 Update `BuildDispatchArgs`, `ResolveBriefPath`, `ResolveReportPath`, and `FormatFixFollowup` for the new field names
- [ ] 2.5 Confirm the strict union rejects the retired `agent`, `report`, and `agent_id` names, and add a test pinning that rejection

## 3. Facade: close the renderer boundary (xsdd-2, xsvc-17)

- [ ] 3.1 Require `diff` for a task-scoped `reviewer` and a `re-reviewer` in the union refinement unless the derivable `review-<base>..<head>.diff` exists in the plan workspace
- [ ] 3.2 Rewrite every advertised description to state direction and true optionality, replacing the shared "Absolute path the agent writes its report to"
- [ ] 3.3 Add the tool-surface test that reads `--describe-slots` and fails when an advertised direction or optionality disagrees with the renderer
- [ ] 3.4 Verify the existing xsvc-15 superset property still holds: every payload the union accepts is accepted by the advertised schema

## 4. Facade: diagnosable renderer failures (xsvc-18)

- [ ] 4.1 Add `sdd_renderer_bad_input` with `{ flag, reason }`, classified from a closed allowlist of `dpr-10` forms, alongside the existing `sdd_templates_missing` branch
- [ ] 4.2 Keep `sdd_renderer_failed` as the fallback for unmatched non-zero exits, and assert no renderer stderr appears in either response
- [ ] 4.3 Add `sdd_prompt.test.ts` cases for a missing input file, a required-but-underivable input, an unmatched failure, and a stderr-carrying-body-text failure

## 5. Audit: docs, specs, and skills

- [ ] 5.1 Update `plugins/xagent/skills/xagent-subagents/SKILL.md` — remove the `agent_id`-as-`run_id` aliasing instructions now that the value has one name, and state the report direction per role
- [ ] 5.2 Update `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md` for the same three renames and the `diff` requirement
- [ ] 5.3 Sweep `projects/xagent/docs/` for retired field names and stale directions
- [ ] 5.4 Grep the whole repo for `agent_id`, `\bagent:`, and `report` in an SDD dispatch context, excluding `openspec/changes/archive/`, and fix or consciously leave each hit
- [ ] 5.5 Record in the skill that a reviewer reads the implementer's report and a re-reviewer reads the fixer's, so a controller never passes its own output path

## 6. Verification

- [ ] 6.1 `make -C projects/xagent test` green, including the new tool-surface and renderer-classification tests
- [ ] 6.2 `python3 projects/agents/utils/dispatch_prompt_test.py` green
- [ ] 6.3 End-to-end: dispatch an implementer, then a task-scoped reviewer against its report and a generated diff, on a scratch plan — the exact sequence that failed in session `85b47883`
- [ ] 6.4 Negative end-to-end: omit `diff`, then pass a nonexistent `implementer_report`, and confirm each returns a structured error naming the field before any agent is dispatched
- [ ] 6.5 `openspec validate clarify-sdd-dispatch-api` passes and the specs sync cleanly
