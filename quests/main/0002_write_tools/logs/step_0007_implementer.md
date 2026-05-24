# step 7 — implementer

**thread:** Sheaf_quest_0002_slice_0003_implementer

## output

# Implementer Role

You are the implementer for the current quest slice. Your job is to execute the
slice physical plan and deliver working code for that slice.

## Primary Responsibilities

- Implement the current slice according to `slices/<slice>/physicalplan/*.md`.
- Use existing APIs and patterns where appropriate.
- Keep changes clean, maintainable, and idiomatic for this repository.
- Ensure the slice is fully implemented before signaling completion.

## Implementation Expectations

- Follow the spec and physical plan as written.
- Keep scope limited to the current slice unless an explicit prerequisite is required.
- Add/update tests and validations needed to support the slice.
- Run relevant tests for the slice changes before signaling completion.
- Avoid unnecessary duplication and avoid over-generalizing abstractions.
- Remove obsolete code tied to replaced behavior unless otherwise specified.

## Completion Protocol

- Continue implementing until the full current slice plan is complete.
- When prompted:
  - If the full slice plan is complete, create `implementation_done.md` in the
    current slice directory with a brief completion summary.
  - If the slice is not fully complete, continue implementation work and do not
    create `implementation_done.md`.

## Escalation Rules

- If the physical plan cannot be completed without changing the spec, making major
  unspecified decisions, or resolving ambiguous requirements, create/update quest-root
  `human_intervention_request.md` with rationale and exit.
- If there is a critical blocker requiring human input, create/update quest-root
  `human_intervention_request.md` with clear details and exit.

## Scope Limits

- Do not modify `physicalplan_issues.md`.
- Do not mark reviewer-owned issues as `completed`.
- Do not edit role files.
- Focus on implementation artifacts for the current slice; use
  `human_intervention_request.md` only for escalation.


---

Quest Runtime Context
- Quest: main/0002_write_tools (Write Tools)
- Quest directory: /Users/joyo/Sheaf/quests/main/0002_write_tools
- Role: implementer
- Current slice: 0003_system_prompt_and_docs
- Current slice directory: /Users/joyo/Sheaf/quests/main/0002_write_tools/slices/0003_system_prompt_and_docs
- Quest documentation directory: /Users/joyo/conductor/docs/quest

Use the quest's `specs/` directory as the implementation specification for this quest. Use the quest documentation directory above as the stable reference for quest schemas, file formats, and workflow rules.

Quest Schemas Reference (`schemas.md`)
```markdown
# Quest Schemas

This document describes the quest runtime files Conductor reads and writes now.
Where older quests still use legacy formats, the compatibility rules are called
out explicitly.

## Quest State File

Path:

```text
<quest_dir>/state.md
```

Canonical format for active v2 quests:

```markdown
# State

- global_step: 18
- machine_name: quest
- machine_path: quests/main/0002_state_machine_abstraction
- state: ExecuteSlice
- updated_at: 2026-04-01T12:00:00Z

## Tags

- active_slice: 0001_example_slice
- quest_number: 2
- quest_slug: state_machine_abstraction
- quest_type: main
```

Rules:

- The first non-empty line is `# State`.
- The state block uses `- key: value` lines.
- Allowed state keys are `global_step`, `machine_name`, `machine_path`, `state`,
  and `updated_at`.
- Quest-root normalized state always uses `machine_name: quest`.
- `global_step` is required for committed v2 top-level quest state and increments
  once per successful top-level runner step commit.
- `machine_path` is repo-relative and points to the quest directory.
- `## Tags` is required, even when empty.
- Tags are string-to-string entries.
- The runner writes `quest_type`, `quest_number`, and `quest_slug` tags.
- During `ExecuteSlice`, `tags.active_slice` is required and must be a slice
  directory name such as `0001_example_slice`.
- Outside `ExecuteSlice` and `PrepareNextSlice`, `active_slice` is omitted.

Compatibility:

- Readers also accept the legacy quest format:

```markdown
# Quest State

state: ExecuteSlice
current_slice: 1
updated_at: 2026-04-01T12:00:00Z
active_slice: 0001_example_slice
global_step: 18
```

- `read_quest_state` auto-detects the format by heading.
- `create_quest` still scaffolds new quests with the legacy `# Quest State`
  layout.
- Once the v2 runner commits a top-level step, it rewrites quest-root `state.md`
  in normalized form.

Supported quest filesystem states:

- `PrePlanning`
- `PhysicalPlanning`
- `ReviewPhysicalPlan`
- `ExecuteSlice`
- `QuestDocumenting`
- `Completed`

The quest machine also uses `PrepareNextSlice` internally, but that logical node
does not persist as a distinct quest filesystem state.

## Slice State File

Path:

```text
<slice_dir>/state.md
```

Format:

```markdown
# Slice State

state: NotStarted|Implementing|PolishingReview|PolishingFix|Done
updated_at: <ISO-8601 UTC timestamp>
```

Rules:

- Slice state files remain in the legacy key/value format.
- The first non-empty line is `# Slice State`.
- The runner persists only the filesystem states above.
- The recursive slice machine also uses logical nodes such as `SliceSetup` and
  `Completed`, but those map onto the persisted slice states rather than changing
  the file schema.

## Step Commit Metadata

Each successful top-level runner step for the canonical v2 runner creates one git
commit whose message carries recursive state-machine metadata.

Commit message shape:

```text
quest-step: 18
state-machine-path: quests/main/0002_state_machine_abstraction
node: ExecuteActiveSliceNode
state-before: ExecuteSlice
state-after: ExecuteSlice

recursive-snapshot-json:
{
  "global_step": 18,
  "snapshot": {
    "child": {
      "child": null,
      "machine_name": "slice",
      "machine_path": "quests/main/0002_state_machine_abstraction/slices/0001_example_slice",
      "node_name": "SliceImplementingNode",
      "role": "implementer",
      "state_after": "Implementing",
      "state_before": "Implementing",
      "tags": {},
      "thread_name": "repo_quest_0002_slice_0001_implementer"
    },
    "machine_name": "quest",
    "machine_path": "quests/main/0002_state_machine_abstraction",
    "node_name": "ExecuteActiveSliceNode",
    "state_after": "ExecuteSlice",
    "state_before": "ExecuteSlice",
    "tags": {
      "active_slice": "0001_example_slice",
      "quest_number": "2",
      "quest_slug": "state_machine_abstraction",
      "quest_type": "main"
    }
  }
}
```

Rules:

- `quest-step` must equal JSON `global_step`.
- Header `state-machine-path`, `node`, `state-before`, and `state-after` must match
  the root JSON snapshot.
- The JSON payload must be pretty-printed multi-line JSON after the
  `recursive-snapshot-json:` marker.
- `snapshot.child` recursively represents nested machine execution for a slice step,
  or `null` for a quest-only step.
- `role` and `thread_name` appear when the step executed an agent-backed node.
- If metadata validation fails, the runner writes
  `logs/commit_metadata_validation_*.md`, creates
  `human_intervention_request.md`, and does not commit the step.
- On a noop top-level step with no filesystem changes, the runner skips the commit
  and does not increment `global_step`.

Compatibility:

- Older quests may still rely on `state_history.md` and older transition commit
  titles.
- Dashboard history readers merge commit metadata with `state_history.md` and prefer
  metadata when the same commit appears in both sources.

## Issue Response Files

Responder-written records of how open reviewer issues were handled. These files are
separate from reviewer-owned issue lists (`physicalplan_issues.md`,
`polishing_issues.md`).

Paths:

```text
<quest_dir>/physicalplan_issue_responses.md
<slice_dir>/polishing_issue_responses.md
```

Write authority:

- `physicalplan_issue_responses.md`: `physical_planner` only.
- `polishing_issue_responses.md`: `polisher` only for the current slice.

Read authority:

- `physical_plan_reviewer` must read `physicalplan_issue_responses.md` when
  verifying open physical plan issues.
- `polisher_reviewer` must read `polishing_issue_responses.md` when verifying open
  polishing issues.

Reviewers must not create, edit, or delete entries in either responses file.

Full normative schema: [`schemas/issue-responses.md`](schemas/issue-responses.md).

## Issue Files

Paths:

```text
<quest_dir>/physicalplan_issues.md
<slice_dir>/polishing_issues.md
```

Format:

```markdown
# Issues

## Issue QP-0001

- status: open|completed
- owner_role: physical_plan_reviewer|polisher_reviewer
- created_at: <ISO-8601 UTC timestamp>
- updated_at: <ISO-8601 UTC timestamp>
- title: <short title>
- details: <markdown text>
- resolution_notes: <markdown text or none>
```

Rules:

- `status` may only be `open` or `completed`.
- Reviewer roles are the only roles allowed to mark issues `completed`.
- `details` and `resolution_notes` may span multiple lines.
- `resolution_notes: none` means the field is unset.

## State History Files

Paths:

```text
<quest_dir>/state_history.md
<slice_dir>/state_history.md
```

Format:

```markdown
# State Transition History

## 2026-03-29T00:00:00Z

- previous_state: <state name>
- next_state: <state name>
- commit: <git commit hash>
- thread_name: <thread name or none>
- notes: <short summary>
```

Current behavior:

- `create_quest` still scaffolds quest-root `state_history.md`.
- Slice scaffolding still creates slice `state_history.md`.
- The canonical v2 runner does not append new transition rows for top-level step
  history.
- Older quests and older runner paths may still contain authoritative history rows,
  and dashboard readers continue to support them.

## Thread Registry

Path:

```text
<quest_dir>/thread_registry.json
```

Format:

```json
{
  "implementer": {
    "thread_name": "myrepo_quest_0002_slice_0001_implementer",
    "harness_kind": "cursor",
    "provider_thread_id": "provider-thread-id",
    "pass_id": 0,
    "round_count": 3,
    "created_at": "2026-03-29T00:00:00Z",
    "last_used_at": "2026-03-29T00:00:00Z"
  }
}
```

Current naming:

- Quest-scoped v2 roles use `<repo>_quest_<quest_number:04d>_<role>`.
- Slice-scoped v2 roles use
  `<repo>_quest_<quest_number:04d>_slice_<slice_number:04d>_<role>`.
- Older threads may still use the legacy slug-based pattern
  `<repo>_quest_<quest_slug>_<role>_0`.

## Execution Config

Path:

```text
<quest_dir>/state_execution_config.yaml
```

Shape:

```yaml
version: 2
harnesses:
  claude_code:
    cli_path: /path/to/claude
profiles:
  implementer:
    harness: cursor
    model: composer-2
    reasoning_effort: high
    idle_timeout_seconds: 3600
    modify_allow:
      - "$currentQuest/human_intervention_request.md"
      - "$currentSlice/implementation_done.md"
      - "$currentSlice/notes/**"
    modify_block:
      - "**"
```

Rules:

- `profiles` keys are role names.
- Allowed harness values are `codex`, `cursor`, and `claude_code`.
- `reasoning_effort` is optional. When present, it must be a string.
- `version: 2` adds optional per-profile `modify_allow` and `modify_block`
  repo-root-relative glob lists.
- `modify_allow` may use only `$currentQuest` and `$currentSlice`.
- `modify_block` must not contain `$` placeholders.
- When both lists match the same path, allow wins.
- The runner refuses to invoke a harness when the target repository working tree is
  not fully clean, including untracked files.
- After each harness turn, the runner compares the repository to the pre-turn
  snapshot, reverts changes outside the role's allowed paths, records those reverts
  in the step log, and sends a follow-up in the same thread telling the agent to
  continue within its allowed paths.
- `version: 1` configs keep legacy behavior: no path-rule enforcement and empty
  parsed allow/block lists.

## Human Intervention Request

Path:

```text
<quest_dir>/human_intervention_request.md
```

Minimum content:

```markdown
# Human intervention requested

**Reason:** <short reason>

<details>
```

Presence of this file blocks further automatic quest progress until a human resolves
the condition.

## Implementer Completion Marker

Path:

```text
<slice_dir>/implementation_done.md
```

Purpose:

- Signals that the implementer believes the full current slice plan is complete.
- The runner advances out of `Implementing` only when this file exists.

## Physical Plan Acceptance Marker

Path:

```text
<quest_dir>/physicalplan_accepted.md
```

Purpose:

- Signals that `physical_plan_reviewer` found no remaining open physical plan issues
  and accepts the quest-level plan review.
- The runner advances out of `ReviewPhysicalPlan` only when this file exists and
  `physicalplan_issues.md` has no open entries.

## Implementation Acceptance Marker

Path:

```text
<slice_dir>/implementation_accepted.md
```

Purpose:

- Signals that `polisher_reviewer` found no remaining open polishing issues and
  accepts the current slice implementation.
- The runner advances the slice to logical completion only when this file exists and
  `polishing_issues.md` has no open entries.
```

Task:
Implement the plan described in `0003_system_prompt_and_docs/physicalplan/`. Keep working until the full plan is complete. When the full plan is complete, create `implementation_done.md` in this slice with a brief completion summary.The user wants me to implement the system prompt and documentation for slice 0003_system_prompt_and_docs in the quest main/0002_write_tools.
```Implementing slice 0003 per the physical plan. Reading the plan and exploring the codebase.
I need to update prompts.ts with a comprehensive yet concise prompt.To test prompts, I need to mock `vscode.workspace.getConfiguration` since `config.getSystemPrompt()` depends on it.

Let me check if there are existing tests that mock vscode for configuration.

The testing plan includes verifying:
- Empty configured prompt returns built-in prompt containing "sheaf VS Code"
- Built-in prompt mentions "modifyFile"
- Built-in prompt mentions exact target/context validation
- Non-empty configured prompt overrides built-in prompt

For the override test, I can either test BASELINE_VOICE_NAV_SYSTEM_PROMPT directly for content checks or extract GetEffectiveSystemPrompt logic and test with mocked vscode.No VSCode mocking in tests. I can:

Tests can directly evaluate `BASELINE_VOICE_NAV_SYSTEM_PROMPT` in `prompts.test.ts`. For override logic, a pure function `resolveSystemPrompt(configured: string | undefined, baseline: string): string` could replace the current config.ts behavior, though that might be over-engineering. Alternatively, duplicating the trim logic in tests works:

```ts
function resolveLikeGetSystemPrompt(value: string | undefined): string {
  const trimmed = value?.trim();
  if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  return BASELINE_VOICE_NAV_SYSTEM_PROMPT;
}
```

Testing duplicate logic is undesirable. A better approach exports a helper from config.ts:

```ts
export function resolveSystemPrompt(configured: string | undefined, baseline = BASELINE_VOICE_NAV_SYSTEM_PROMPT): string
```

This helper can then be used by getSystemPrompt while keeping existing behavior intact. The test should verify that an empty configured prompt returns the built-in prompt containing `sheaf VS Code`, and that the built-in prompt includes modifyFile and related terms.

Non-empty configured prompts still override the baseline. Tests can directly evaluate the baseline content, and for override logic, either inline the same logic in tests or extract a `resolveSystemPrompt` helper. Exporting this helper from `config.ts` allows reuse and simplifies testing without modifying the existing API.The plan specifically states to update:

The plan requires updating VSCODE_EXTENSION.md and apps/vscode-extension/README.md, with a manual scan for stale sheaf_vscode_read_nav references. The ARCHITECTURE.md file should also be updated to reflect current extension capabilities, including write tools, not just read/navigation features.

The plan specifies updating VSCODE_EXTENSION.md and apps/vscode-extension/README.md, with a manual scan for stale sheaf_vscode_read_nav references. ARCHITECTURE.md should also be updated to reflect current extension capabilities, including write tools, not just read/navigation features. The TEST_STRATEGY.md mentions read/navigation tool contracts, but the plan doesn't explicitly list modifyFile. Since the plan limits scope to the current slice and only mentions 4 key files, a grep for sheaf_vscode_read_nav across the repo will identify stale references to update only non-quest documentation describing the current toolset.I'll lightly update ARCHITECTURE.md lines 20 and 59 to reflect the current extension, as the plan indicates scanning for stale references.

Not required by key files list but aligns with scan instruction.

Now let me write the prompt. It should be concise but cover all requirements. Using join(" ") like existing style.

```ts
export const BASELINE_VOICE_NAV_SYSTEM_PROMPT = [
  "You are a voice-driven coding assistant inside VS Code.",
  "The developer speaks through the microphone; you receive committed audio turns when they ask for a response.",
  "Help them navigate, read, and edit their codebase; prefer concise spoken-friendly answers.",
```

When sheaf VS Code tools are available, use them instead of guessing editor state or file contents. These tools read and navigate the workspace and edit the current VS Code text buffer through modifyFile, not shell commands or external patch tools. Before modifyFile, gather fresh context with read tools unless exact target text and up to three full lines of surrounding context are already available from recent tool results.

modifyFile requires precise start and end positions, exactText, replacementText, and matching contextBeforeText and contextAfterText, including whitespace and line breaks. Provide up to three full lines of context before and after the edit when possible, or shorter context only at file boundaries. If modifyFile reports a mismatch, reread the file or visible range and compute a new edit rather than retrying the same arguments.

"If the user, formatter, language server, git, or another non-agent source changes a buffer you observed, trust tools over stale memory. When the user speaks or describes code without naming a file or range, assume insertion at the current cursor unless they say otherwise; query cursor position first if unknown, then use modifyFile with empty exactText and start equal to end at the cursor."

Let me trim slightly while keeping all requirements.

Use sheaf VS Code tools instead of guessing editor state or file contents. When editing, use modifyFile to change the current VS Code text buffer rather than shell commands. Provide up to three full lines of context before and after the edit, or shorter context at file boundaries. If modifyFile reports a mismatch, reread the file or visible range and compute a new edit rather than retrying the same arguments. When the user speaks or describes code without naming a file or range, assume insertion at the current cursor unless they say otherwise; query cursor position first if unknown.

For tests, I'll create prompts.test.ts and add ResolveSystemPrompt to config.ts for override testing. Instead of refactoring config, I can test the logic by importing BASELINE and asserting the trim logic. I'll export ResolveSystemPrompt from config.ts as a minimal change.

```ts
export function ResolveSystemPrompt(configured: string | undefined): string
{
  const trimmed = configured?.trim();
  if (trimmed !== undefined && trimmed.length > 0)
  {
    return trimmed;
  }
```

return BASELINE_VOICE_NAV_SYSTEM_PROMPT;
}

export function getSystemPrompt(): string
{
  const value = vscode.workspace.getConfiguration(x_configSection).get<string>("systemPrompt");
  return ResolveSystemPrompt(value);
}

Tests in prompts.test.ts:
```ts
import { BASELINE_VOICE_NAV_SYSTEM_PROMPT } from "../src/prompts.js";
import { ResolveSystemPrompt } from "../src/config.js";

test("built-in prompt names sheaf VS Code toolset", () => {
  assert.match(BASELINE_VOICE_NAV_SYSTEM_PROMPT, /sheaf VS Code/);
});

test("built-in prompt documents modifyFile workflow", () => {
```

assert.match(BASELINE_VOICE_NAV_SYSTEM_PROMPT, /modifyFile/);
assert.match(BASELINE_VOICE_NAV_SYSTEM_PROMPT, /exactText|exact target/i);
assert.match(BASELINE_VOICE_NAV_SYSTEM_PROMPT, /contextBeforeText|context.*before/i);

test("ResolveSystemPrompt uses built-in when configured prompt is empty", () => {
  assert.equal(ResolveSystemPrompt(undefined), BASELINE_VOICE_NAV_SYSTEM_PROMPT);
  assert.equal(ResolveSystemPrompt("  \t"), BASELINE_VOICE_NAV_SYSTEM_PROMPT);
});

test("ResolveSystemPrompt overrides built-in when configured prompt is non-empty", () => {
```Tests import the sessionController from the src directory.

Tests import from ../src/ and may load vscode modules when importing config.ts. To avoid this, consider moving ResolveSystemPrompt to configCore.ts, which has no vscode dependencies and is alongside ResolveOpenAiApiKey. This approach keeps configCore in src/ but avoids circular dependencies since prompts.ts doesn't import configCore. Alternatively, resolve could be moved to prompts.ts.Implementing prompt, documentation, and tests.
I'll add ResolveSystemPrompt to configCore.ts and use it in config.ts.config.ts is properly configured. Proceeding to generate prompts.The package.json description for systemPrompt setting needs updating from "voice-navigation" to match the plan's guidance to retain unchanged settings unless navigation-only wording applies.All tests passed. Creating the completion marker.
Slice **0003_system_prompt_and_docs** is complete. Here is what changed:

### Built-in system prompt (`prompts.ts`)
The default prompt now describes the **`sheaf VS Code`** toolset: use tools instead of guessing state, **`modifyFile`** on the VS Code buffer (not shell/filesystem), required arguments (`start`, `end`, `exactText`, `replacementText`, `contextBeforeText`, `contextAfterText`), three-line context rules, mismatch recovery (reread, do not retry blindly), freshness notifications for non-agent edits, and spoken-code insertion at the cursor (query position first if unknown).

### Config / tests
- **`ResolveSystemPrompt`** in `configCore.ts` centralizes empty-vs-custom prompt resolution; `getSystemPrompt()` behavior is unchanged.
- **`test/prompts.test.ts`** checks built-in content and override behavior.

### Documentation
- **`docs/architecture/VSCODE_EXTENSION.md`**: toolset renamed to `sheaf VS Code`, `modifyFile` documented, read/navigation-only wording removed.
- **`docs/architecture/ARCHITECTURE.md`**, **`apps/vscode-extension/README.md`**, and the `systemPrompt` setting description updated to match.

### Validation
- Lint and tests pass (90 tests).

`implementation_done.md` is in the slice directory.

