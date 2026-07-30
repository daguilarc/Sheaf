## Why

The `xagent_sdd_start` surface advertises field descriptions that contradict the
renderer they feed, and reuses one name for opposite functions. On 2026-07-28 an
opus-5 controller lost ~15 minutes on its first task review to this; on 2026-07-29
a second controller hit the identical wall, escalated it as broken agentic
infrastructure, and stopped a 16-task plan on a root cause that was wrong in both
of its particulars. Two capable controllers, following the advertised contract,
were told the opposite of the truth. The failure is a documentation and naming
defect in the facade, not a defect in the renderer: `dispatch-prompt --help` has
described `--report` correctly as `implementer report file` since it was written.

The service already holds the right principle — xsvc-15 requires that a client
"which has never seen the service can construct a valid call from discovery
alone." Discovery is complete but untruthful, so the requirement passes while its
purpose fails.

## What Changes

**Truthfulness of the advertised contract**

- `report` is advertised as "Absolute path the agent writes its report to" for all
  four start roles. That is true for `implementer` and `fixer`, which write it,
  and false for `reviewer` (task-scoped) and `re-reviewer`, which require it to
  already exist and read it. The renderer types it `path_out` for the first pair
  and `path` for the second.
- `diff` is advertised "Optional precomputed diff file for a reviewer or
  re-reviewer." The `[DIFF_FILE]` slot has no fallback, so the task-review and
  re-review templates hard-require it unless the conventional
  `<repo-root>/.superpowers/sdd/<plan-slug>/review-<base>..<head>.diff` exists.
  The union accepts the call and the render then fails.
- A new requirement SHALL pin advertised descriptions to the renderer's actual
  slot direction and optionality, with a test that fails when they diverge.
  xsvc-15 governs only shape agreement between the advertised schema and the
  union; nothing today governs agreement with the renderer behind them, and
  nothing requires a description to be true.

**One name, one function** — **BREAKING** (no aliases; nothing redeploys until the
change is complete)

- `report` splits by direction: `report_out` where the agent writes it
  (`implementer`, `fixer`, and `xagent_sdd_followup` kind `fix`), and
  `implementer_report` / `fixer_report` where the agent reads an existing one
  (`reviewer` with `task`, `re-reviewer`, and `xagent_sdd_followup` kind
  `re-review`). This also retires the collision with `report.text` in the
  `xagent_await` result, which is final assistant text rather than a path.
- `agent` becomes `model`. It carries a provider model name, is one letter from
  the unrelated `agent_id`, and `xagent_start_non_sdd` already calls the same
  concept `model` — so the surface currently has one name for two functions and
  two names for one function simultaneously.
- The returned `agent_id` becomes `run_id`. It is the same value the generic
  tools take as `run_id`; the schema's own validator message says so
  ("agent_id must be a generated xagent run id"), and both skills have to teach
  the aliasing explicitly ("Record the returned `agent_id` (use it as `run_id`
  for generic tools)"). The immutable `sdd_agents.agent_id` ledger column is
  internal and keeps its name.

**Diagnosable renderer failures**

- Renderer argument failures collapse to `sdd_renderer_failed` with nothing but
  `exitCode: 2`. Suppressing stderr is correct — it can echo brief and plan body
  text — but the current behaviour discards the flag name too, which is
  caller-supplied and leaks nothing. A new `sdd_renderer_bad_input` error SHALL
  carry the offending flag and a fixed reason drawn from a closed allowlist,
  mirroring how `sdd_templates_missing` is already classified.

**Audit of every surface that describes this API**

Corrections land in `plugins/xagent/skills/xagent-subagents/SKILL.md`,
`projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md`, and
`projects/xagent/docs/`. Two ambiguities found in the audit are kept
deliberately and documented rather than renamed: `brief` on `reviewer` (the
implementer's task brief when `task` is present, a purpose-written review brief
when absent — same function, different provenance), and `task` presence
selecting the task-review versus whole-branch template.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `xagent-service`: new requirement that advertised SDD field descriptions match
  the renderer's slot direction and optionality, and that renderer argument
  failures return a structured, allowlisted `sdd_renderer_bad_input`.
- `xagent-sdd-workflow`: the start and follow-up field vocabulary — `report`
  split into `report_out` / `implementer_report` / `fixer_report`, `agent`
  renamed `model`, the returned `agent_id` renamed `run_id`, and `diff` made
  explicitly required for the task-scoped reviewer and re-reviewer unless
  derivable.
- `agents-dispatch-prompt-renderer`: slot direction and required-versus-fallback
  semantics stated normatively, and a stable machine-classifiable grammar for
  argument errors so the facade can translate without echoing template bodies.

## Impact

- `projects/xagent/src/service/tool_schemas.ts` — advertised schema, union,
  refinements, field renames.
- `projects/xagent/src/service/sdd_manager.ts`, `sdd_prompt.ts` — role mapping,
  argument construction, renderer error classification.
- `projects/agents/utils/dispatch-prompt` — argument-error grammar; no change to
  slot semantics, which are already correct.
- Tests: `sdd_prompt.test.ts`, `sdd_manager.test.ts`, `mcp.test.ts`,
  `e2e.test.ts`, `dispatch_prompt_test.py`.
- Skills and docs listed above.
- **Breaking for any live controller mid-plan.** The rename changes required
  field names on both dispatch tools. No compatibility aliases are added; the
  change lands and redeploys as a unit.
