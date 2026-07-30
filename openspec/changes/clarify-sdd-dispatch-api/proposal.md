## Why

The `xagent_sdd_start` surface advertises field descriptions that contradict the
prompts they feed, and reuses one name for opposite functions. On 2026-07-28 an
opus-5 controller lost ~15 minutes on its first task review to this; on
2026-07-29 a second controller hit the identical wall, escalated it as broken
agentic infrastructure, and stopped a 16-task plan on a root cause that was wrong
in both of its particulars. Two capable controllers, following the advertised
contract, were told the opposite of the truth. The failure is a documentation and
naming defect in the facade, not in the renderer: `dispatch-prompt --help` has
described `--report` correctly as `implementer report file` since it was written.

The service already holds the right principle — xsvc-15 requires that a client
"which has never seen the service can construct a valid call from discovery
alone." Discovery is complete but untruthful, so the requirement passes while its
purpose fails.

## What Changes

**Truthfulness of the advertised contract**

- `report` is advertised as "Absolute path the agent writes its report to" for
  all four start roles. That is true for `implementer`, whose renderer slot is a
  write destination, and false for `reviewer` (task-scoped) and `re-reviewer`,
  whose slots require the file to already exist and be read.
- `diff` is advertised "Optional precomputed diff file for a reviewer or
  re-reviewer." The `[DIFF_FILE]` slot has no fallback, so the task-review and
  re-review templates require it unless the conventional
  `review-<base>..<head>.diff` exists in the plan workspace. The union accepts
  the call and the render then fails. The same gap exists on follow-up kind
  `re-review`, which renders the same template.
- A new requirement (xsvc-17) SHALL derive every artifact-field description from
  a **dispatch field manifest** and fail the tool-surface suite when a
  description disagrees with it. xsvc-15 governs only shape agreement between the
  advertised schema and the union; nothing today governs agreement with the
  prompts behind them, and nothing requires a description to be true.
- The manifest has two sources, because the renderer is not the whole surface.
  `dispatch-prompt` renders `implementer`, both `reviewer` variants, and
  `re-reviewer`, and exposes its slot table through a new versioned
  `--describe-slots` (dpr-11). The `fixer` start role and follow-up kind `fix`
  have **no renderer template at all** — Superpowers ships none, because upstream
  a fix is a follow-up to a live implementer or a fresh implementer, so `fixer`
  is a service-local recovery role whose prompt is formatted in TypeScript to
  stay byte-identical to the same-agent continuation. Those variants get a
  service-owned declaration, and the suite joins both.

**One name, one function** — **BREAKING** (no aliases; nothing redeploys until
the change is complete)

- `report` splits by direction: `report_out` where the agent writes it
  (`implementer`, `fixer`, follow-up kind `fix`), and `implementer_report` /
  `fixer_report` where the agent reads an existing one (`reviewer` with `task`,
  `re-reviewer`, follow-up kind `re-review`). This also retires the collision
  with `report.text` in the `xagent_await` result, which is final assistant text
  rather than a path.
- `agent` becomes `model`. It carries a provider model name, is one letter from
  the unrelated `agent_id`, and `xagent_start_non_sdd` already calls the same
  concept `model`.
- `agent_id` becomes `run_id` in every tool input, tool result, structured error
  detail, and validation message — error payloads are tool outputs, so a rename
  scoped to the success path would satisfy the letter and miss the point. The
  internal `sdd_agents.agent_id` ledger column keeps its name.
- xsdd-9 fixes what "function" means: the logical role the artifact plays, not
  the transport that delivers it. `brief` and `findings` therefore keep single
  names across variants whose prompts inline rather than path-substitute them.

**Diagnosable renderer failures**

- Renderer argument failures collapse to `sdd_renderer_failed` with nothing but
  `exitCode: 2`. Suppressing stderr is correct — it can echo brief and plan body
  text — but the current behaviour discards the flag name too, which is
  caller-supplied and leaks nothing.
- dpr-10 makes the renderer emit a single-line JSON trailer on stderr for
  argument faults, with an enumerated `error` code (`no_such_file`,
  `empty_file`, `parent_missing`, `not_accepted`, `required_missing`) and no key
  that could carry file contents. xsvc-18 classifies from that closed set and —
  critically — maps the renderer option back to the **caller's own field name**,
  which is role-dependent: one `--report` backs three differently named surface
  fields.

**Enforcement that actually enforces**

- The MCP SDK validates against the advertised schema before the handler runs,
  and a plain object schema strips undeclared keys. A retired `agent`, `report`,
  or `agent_id` sent alongside a valid payload would be silently removed before
  the strict union could reject it. Both advertised dispatch schemas must
  preserve unknown keys — the repo already documents this exact hazard for
  `xagent_await`.

**Audit of every surface that describes this API**

Corrections land in `plugins/xagent/skills/xagent-subagents/SKILL.md`,
`projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md`, and
`projects/xagent/docs/`. The tracked plugin package under
`plugins/xagent/assets/xagent/dist/` carries compiled copies of these schemas and
is verified by `make xagent-plugin-test`, so it is rebuilt as part of the change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `xagent-service`: xsvc-11 and xsvc-12 restated in the new field vocabulary;
  xsvc-15 extended to preserve unknown keys so the union can reject retired
  names; new xsvc-17 (descriptions derived from a two-source dispatch field
  manifest) and xsvc-18 (coded `sdd_renderer_bad_input` with role-aware
  reverse mapping to surface field names).
- `xagent-sdd-workflow`: xsdd-1 and xsdd-6 restated for `run_id`; xsdd-2 gains
  the field vocabulary, the per-role result payload, and the `diff` condition;
  xsdd-3 gains the same for follow-ups; new xsdd-9 defines "one name, one
  function" on logical purpose rather than transport.
- `agents-dispatch-prompt-renderer`: dpr-5 states slot direction for
  artifact-bearing slots only and separates renderability from
  caller-must-supply; new dpr-10 (coded argument-fault trailer) and dpr-11
  (versioned `--describe-slots` slot table).

## Impact

- `projects/xagent/src/service/tool_schemas.ts` — advertised schemas, union,
  refinements, field renames, unknown-key preservation.
- `projects/xagent/src/service/sdd_manager.ts`, `sdd_prompt.ts` — role mapping,
  argument construction, result payloads, error details, renderer error
  classification and reverse mapping, the service-owned fixer manifest.
- `projects/agents/utils/dispatch-prompt` — slot direction metadata,
  `--describe-slots`, argument-fault trailer.
- `plugins/xagent/assets/xagent/dist/**` — rebuilt via
  `plugins/xagent/scripts/package_xagent.py`; `make xagent-plugin-test` gates it.
- Tests: `sdd_prompt.test.ts`, `sdd_manager.test.ts`, `mcp.test.ts`,
  `e2e.test.ts`, `dispatch_prompt_test.py`.
- Skills and docs listed above.
- **Breaking for any live controller mid-plan.** The rename changes required
  field names on both dispatch tools. No compatibility aliases are added; the
  change lands and redeploys as a unit.
