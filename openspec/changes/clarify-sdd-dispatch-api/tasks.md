## 1. Renderer: declare the contract, expose it, code the faults (dpr-5, dpr-10, dpr-11)

Lands first: tasks 3 and 4 consume its `--describe-slots` output and its
argument-fault trailer.

- [ ] 1.1 Add a `direction` field to `Slot` populated only for artifact-bearing kinds — `path` and `filetext` are `reads`, `path_out` is `writes` — leaving `text` and `literal` with no direction, and keeping `kind` as the complete per-slot description
- [ ] 1.2 Add a `derivation` field to `Slot` naming the conventional plan-workspace filename that `_supplied` can satisfy it with (`task-<N>-report.md`, `global-constraints.md`, `review-<base>..<head>.diff`), or `None`, so renderability and caller-must-supply stop being conflated
- [ ] 1.3 Bring `--help` text in line with the directions, notably `--report` per template and `--diff` on the task-review and re-review templates
- [ ] 1.4 Emit the dpr-10 argument-fault trailer: a single-line JSON object as the final stderr line carrying `error` (one of `no_such_file`, `empty_file`, `parent_missing`, `not_accepted`, `required_missing`), `option`, and where applicable `path` and `template` — emitted for those faults only, never for template-resolution or drift failures
- [ ] 1.5 Add `--describe-slots`: writes one versioned JSON document to stdout and exits zero without reading a plan, creating a workspace, or requiring any other option
- [ ] 1.6 Extend `dispatch_prompt_test.py`: direction per kind, a fallback-less slot satisfied by derivation, a `writes` path that does not exist rendering fine, a `reads` path that does not exist failing, every trailer code, no trailer on non-argument failures, and no inlined file contents in any trailer

## 2. Facade: rename the fields (xsvc-11, xsvc-12, xsdd-1, xsdd-2, xsdd-3, xsdd-6, xsdd-9)

Independent of Task 1; may run concurrently.

- [ ] 2.1 Rename `agent` to `model` across `tool_schemas.ts`, `sdd_manager.ts`, and the advertised schemas
- [ ] 2.2 Split the report field: `report_out` for `implementer` / `fixer` / follow-up `fix`; `implementer_report` for a task-scoped `reviewer`; `fixer_report` for `re-reviewer` and follow-up `re-review`
- [ ] 2.3 Rename `agent_id` to `run_id` in every tool input, tool result, structured error detail, and validation message — including `AgentIdSchema`'s message text — leaving the `sdd_agents.agent_id` column and ledger-internal variables alone
- [ ] 2.4 Update `BuildDispatchArgs`, `ResolveBriefPath`, `ResolveReportPath`, `FormatFixFollowup`, and `FormatFixDispatch` for the new field names
- [ ] 2.5 Specify the per-role start result: `run_id`, `sequence`, `brief_path`, `report_out_path` for the roles that write one, and `prompt_path`/`renderer_path` omitted entirely for `fixer` rather than returned empty
- [ ] 2.6 Make both advertised dispatch schemas preserve unknown keys so the strict union receives retired names instead of having them stripped
- [ ] 2.7 Add tests through the real MCP boundary — not just the union — sending each of `agent`, `report`, and `agent_id` alongside an otherwise valid payload, asserting a structured rejection naming the retired field; plus result-shape tests for all four start roles

## 3. Facade: manifest, truthful descriptions, and coded errors (xsvc-15, xsvc-17, xsvc-18)

Consumes Task 1 (1.4, 1.5) and Task 2's vocabulary.

- [ ] 3.1 Build the dispatch field manifest: parse `--describe-slots` for the renderer-backed variants, and add a service-owned declaration for `fixer` and follow-up `fix`, each entry carrying surface field, prompt source, renderer option or service-formatted marker, direction, required condition, and derivation
- [ ] 3.2 Generate every artifact-field description from the manifest, replacing the shared "Absolute path the agent writes its report to", and state transport (path-substituted vs contents-inlined) for `brief` and `findings` without renaming them
- [ ] 3.3 Require `diff` for a task-scoped `reviewer`, a `re-reviewer`, and follow-up kind `re-review` unless the derivable `review-<base>..<head>.diff` exists in the plan workspace
- [ ] 3.4 Add the tool-surface test that fails when a description disagrees with the manifest, when an advertised artifact field appears in neither manifest source, or when a direction or required condition drifts
- [ ] 3.5 Add `sdd_renderer_bad_input` classified from the dpr-10 trailer's closed allowlist, with the role-aware reverse mapping from renderer option to surface field so a bad `--report` returns `report_out`, `implementer_report`, or `fixer_report` per role
- [ ] 3.6 Keep `sdd_renderer_failed` for unmatched exits, and assert no renderer stderr appears in either response
- [ ] 3.7 Verify the xsvc-15 superset property still holds after the renames: every payload the union accepts is accepted by the advertised schema

## 4. Audit and ship: docs, skills, package (xsdd-9)

- [ ] 4.1 Update `plugins/xagent/skills/xagent-subagents/SKILL.md` — delete the `agent_id`-as-`run_id` aliasing instructions now that the value has one name, and state the report direction per role
- [ ] 4.2 Update `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md` for the same renames, the `diff` requirement, and the report directions
- [ ] 4.3 Sweep `projects/xagent/docs/` for retired field names and stale directions
- [ ] 4.4 Grep the repo for `agent_id`, `\bagent:`, and `report` in an SDD dispatch context, excluding `openspec/changes/archive/`, and fix or consciously leave each hit
- [ ] 4.5 Rebuild the tracked plugin package with `python3 plugins/xagent/scripts/package_xagent.py` so `plugins/xagent/assets/xagent/dist/` no longer ships the retired schemas

## 5. Verification

- [ ] 5.1 `make -C projects/xagent test` green, including the new tool-surface, manifest-agreement, and error-classification tests
- [ ] 5.2 `python3 projects/agents/utils/dispatch_prompt_test.py` green
- [ ] 5.3 `make xagent-plugin-test` green — `package_xagent.py --check` confirms the shipped package matches source
- [ ] 5.4 End-to-end: dispatch an implementer, then a task-scoped reviewer against its `implementer_report` and a generated diff — the exact sequence that failed in session `85b47883`
- [ ] 5.5 Negative end-to-end: omit `diff`; pass a nonexistent `implementer_report`; send a retired `report` field — each returns a structured error naming the caller's own field, before any agent is dispatched
- [ ] 5.6 `openspec validate clarify-sdd-dispatch-api --strict` passes and the specs sync cleanly
