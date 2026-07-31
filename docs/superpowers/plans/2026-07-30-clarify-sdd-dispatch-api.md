# SDD Dispatch API Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every advertised `xagent_sdd_start` / `xagent_sdd_followup` field description true against the prompt that consumes it, give every field one name for one function, and make renderer argument faults name the caller's own field.

**Architecture:** The renderer (`dispatch-prompt`) already owns a correct contract for five of the seven public dispatch variants; it gains explicit direction metadata, a versioned `--describe-slots` dump, and a coded JSON trailer for argument faults. The facade (`tool_schemas.ts`, `sdd_prompt.ts`, `sdd_manager.ts`) stops restating that contract in prose and instead derives its advertised descriptions from a **dispatch field manifest** joining the renderer's dump with a service-owned declaration for the two service-formatted variants (`fixer`, follow-up `fix`). Field names are split by direction so no name means two things.

**Tech Stack:** Python 3 (renderer, `unittest` + `subprocess`), TypeScript strict + Zod (service), `node --test` (service tests), OpenSpec, Superpowers.

## Global Constraints

- All work happens in the worktree at `/Users/joyo/Sheaf/.claude/worktrees/dazzling-montalcini-2603a4` on branch `claude/hello-ffa06c`. Base commit: `1301bd0e`.
- Every task must leave the tree compiling and its tests green. TypeScript is `strict`.
- Code style in `projects/xagent/src/service/`: Allman braces in `sdd_manager.ts`, K&R elsewhere — match the file you are editing. Module-private constants are prefixed `x_`. Exported store/manager functions are `PascalCase`.
- The renderer is Python 3 with no third-party dependencies. Keep it dependency-free.
- **No compatibility aliases.** Retired names (`agent`, `report`, `agent_id` as a tool field) must be rejected, never accepted-and-ignored.
- Do not modify anything under `projects/agents/vendor/superpowers/` — it is a faithful vendored copy of upstream.
- Do not modify `openspec/changes/archive/`.
- Commit after every task; no squashing.
- The governing requirements are in `openspec/changes/clarify-sdd-dispatch-api/specs/`. Read your task's cited requirement IDs before starting.

---

### Task 1: Renderer — direction metadata, `--describe-slots`, coded fault trailer

**Requirements:** dpr-5, dpr-10, dpr-11

**Files:**
- Modify: `projects/agents/utils/dispatch-prompt`
- Test: `projects/agents/utils/dispatch_prompt_test.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `python3 dispatch-prompt --describe-slots` → JSON on stdout, shape
  `{"schema_version": 1, "templates": {"<name>": [{"option": str, "token": str, "kind": str, "direction": "reads"|"writes"|null, "has_fallback": bool, "derivation": Derivation|null}, ...]}}`
  where `Derivation` is `{"kind": "repo_root"}` or `{"kind": "plan_workspace", "pattern": str, "requires_existing": bool}` with `{task}`, `{short(base)}`, `{short(head)}` placeholders.
  Also produces the stderr trailer `{"error": <code>, "option": str, "path"?: str, "template"?: str}` where `<code>` is one of `no_such_file`, `empty_file`, `parent_missing`, `not_accepted`, `required_missing`. Task 3 consumes both.

- [ ] **Step 1: Write the failing tests for direction and the slot dump**

Append to `projects/agents/utils/dispatch_prompt_test.py`:

```python
class DescribeSlotsTests(unittest.TestCase):
    def run_util(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["python3", str(UTIL), *args], capture_output=True, text=True
        )

    def test_describe_slots_needs_no_plan(self):
        result = self.run_util("--describe-slots")
        self.assertEqual(result.returncode, 0, result.stderr)
        doc = json.loads(result.stdout)
        self.assertEqual(doc["schema_version"], 1)

    def test_every_template_and_slot_appears(self):
        doc = json.loads(self.run_util("--describe-slots").stdout)
        self.assertEqual(
            set(doc["templates"]),
            {"implementer", "task-reviewer", "re-review", "code-reviewer"},
        )
        options = {s["option"] for s in doc["templates"]["task-reviewer"]}
        self.assertIn("--brief", options)
        self.assertIn("--report", options)
        self.assertIn("--diff", options)

    def test_directions_are_declared_only_for_artifact_slots(self):
        doc = json.loads(self.run_util("--describe-slots").stdout)
        by_option = {
            s["option"]: s for s in doc["templates"]["implementer"]
        }
        self.assertEqual(by_option["--brief"]["direction"], "reads")
        self.assertEqual(by_option["--report"]["direction"], "writes")
        self.assertIsNone(by_option["--context"]["direction"])
        self.assertIsNone(by_option["--name"]["direction"])

    def test_reviewer_report_reads_and_diff_derives(self):
        doc = json.loads(self.run_util("--describe-slots").stdout)
        by_option = {s["option"]: s for s in doc["templates"]["task-reviewer"]}
        self.assertEqual(by_option["--report"]["direction"], "reads")
        self.assertFalse(by_option["--report"]["has_fallback"])
        self.assertEqual(
            by_option["--diff"]["derivation"],
            {"kind": "plan_workspace",
             "pattern": "review-{short(base)}..{short(head)}.diff",
             "requires_existing": True},
        )
        self.assertTrue(by_option["--constraints"]["has_fallback"])
```

Add `import json` to the file's imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 projects/agents/utils/dispatch_prompt_test.py DescribeSlotsTests -v`
Expected: FAIL — `unrecognized arguments: --describe-slots`, exit code 2.

- [ ] **Step 3: Add direction and derivation to `Slot`**

In `projects/agents/utils/dispatch-prompt`, extend the `Slot` dataclass and add the kind→direction map immediately above it:

```python
# Direction is declared only for slots whose value is a caller-supplied
# filesystem path. `text` and `literal` carry inline values, so they have no
# direction and requiring one would force an invented semantic (dpr-5).
DIRECTIONS: dict[str, str | None] = {
    "path": "reads",
    "filetext": "reads",
    "path_out": "writes",
    "text": None,
    "literal": None,
}


@dataclass(frozen=True)
class Slot:
    token: str
    option: str
    kind: str
    required: bool = False
    fallback: str | None = None
    # The conventional plan-workspace filename `_supplied` can satisfy this
    # slot with when the caller omits it. A fallback-less slot with a
    # derivation is renderable without the caller supplying anything, so
    # fallback absence alone does not mean "the caller must provide this".
    derivation: str | None = None

    @property
    def direction(self) -> str | None:
        return DIRECTIONS[self.kind]
```

- [ ] **Step 4: Declare the structured derivations on the slots that have them**

These must mirror `_supplied` exactly — a consumer reproduces the filename from them, so an approximation sends the facade looking for a file that is not there. Add above `TEMPLATES`:

```python
def workspace_derivation(pattern: str, *, requires_existing: bool = True) -> dict:
    """A file `_supplied` looks for in the plan's SDD workspace (dpr-11).

    `{task}` is the task number; `{short(base)}` and `{short(head)}` are
    `git rev-parse --short` of those revisions, falling back to the first
    seven characters — see `short_sha`.
    """
    return {"kind": "plan_workspace", "pattern": pattern,
            "requires_existing": requires_existing}


REPO_ROOT_DERIVATION = {"kind": "repo_root"}
REVIEW_DIFF_PATTERN = "review-{short(base)}..{short(head)}.diff"
```

Then add `derivation=` to every slot `_supplied` can fill:

- `implementer` `[REPORT_FILE]` → `workspace_derivation("task-{task}-report.md", requires_existing=False)` — an implementer writes it, so `_supplied` derives it unconditionally
- `implementer` `[directory]` → `REPO_ROOT_DERIVATION`
- `task-reviewer` `[REPORT_FILE]` → `workspace_derivation("task-{task}-report.md")`
- `task-reviewer` `[GLOBAL_CONSTRAINTS]` → `workspace_derivation("global-constraints.md")`
- `task-reviewer` `[DIFF_FILE]` → `workspace_derivation(REVIEW_DIFF_PATTERN)`
- `re-review` `[REPORT_FILE]` → `workspace_derivation("task-{task}-report.md")`
- `re-review` `[DIFF_FILE]` → `workspace_derivation(REVIEW_DIFF_PATTERN)`

Leave every other slot's `derivation` at `None`.

Add a test asserting the described pattern resolves to the filename `_supplied` actually opens, so the two cannot drift:

```python
    def test_described_diff_pattern_matches_what_supplied_looks_for(self) -> None:
        self.seed_report()
        doc = json.loads(self.run_util("--describe-slots").stdout)
        entry = next(s for s in doc["templates"]["task-reviewer"]
                     if s["option"] == "--diff")
        sha = self.short()
        resolved = (entry["derivation"]["pattern"]
                    .replace("{short(base)}", sha)
                    .replace("{short(head)}", sha))
        self.assertTrue((self.workspace / resolved).is_file())
```

- [ ] **Step 5: Implement `--describe-slots`**

Add the emitter above `main`:

```python
DESCRIBE_SCHEMA_VERSION = 1


def describe_slots() -> str:
    """A machine-readable slot table so embedders describe, never restate (dpr-11)."""
    return json.dumps(
        {
            "schema_version": DESCRIBE_SCHEMA_VERSION,
            "templates": {
                name: [
                    {
                        "option": slot.option,
                        "token": slot.token,
                        "kind": slot.kind,
                        "direction": slot.direction,
                        "has_fallback": slot.fallback is not None,
                        "derivation": slot.derivation,
                    }
                    for slot in template.slots
                ]
                for name, template in TEMPLATES.items()
            },
        },
        indent=2,
        sort_keys=True,
    )
```

Add `import json` to the renderer's imports. In `build_parser`, make the positional template optional and add the flag:

```python
    parser.add_argument("template", nargs="?", choices=sorted(TEMPLATES), help="template role name")
    parser.add_argument("--describe-slots", action="store_true",
                        help="print the machine-readable slot table and exit")
```

Change `--plan` from `required=True` to `required=False`, and at the top of `main`, before `template = TEMPLATES[args.template]`:

```python
def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)

    if args.describe_slots:
        print(describe_slots())
        return 0

    if args.template is None:
        print("dispatch-prompt: a template name is required", file=sys.stderr)
        return 2
    if args.plan is None:
        print("dispatch-prompt: --plan is required", file=sys.stderr)
        return 2

    template = TEMPLATES[args.template]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python3 projects/agents/utils/dispatch_prompt_test.py DescribeSlotsTests -v`
Expected: PASS, 4 tests.

Then run the whole suite to confirm nothing regressed:
Run: `python3 projects/agents/utils/dispatch_prompt_test.py -v`
Expected: PASS, all tests.

- [ ] **Step 7: Write the failing tests for the fault trailer**

Append to `dispatch_prompt_test.py`:

Subclass the existing `DispatchPromptTestCase`, which already provides `setUp` (a seeded git repo at `self.repo`, `self.plan`, `self.brief` containing `BRIEF-BODY-SENTINEL`, and templates under `self.roots`), plus the `run_util`, `reviewer`, `short`, and `seed_report` helpers. Do not write new fixtures.

```python
class FaultTrailerTests(DispatchPromptTestCase):
    def trailer(self, result) -> dict:
        lines = [line for line in result.stderr.splitlines() if line.strip()]
        self.assertTrue(lines, "expected stderr output")
        return json.loads(lines[-1])

    def test_no_such_file_names_option_and_path(self) -> None:
        self.seed_report()
        missing = str(self.repo / "absent.md")
        result = self.reviewer("--brief", missing)
        self.assertEqual(result.returncode, 2)
        body = self.trailer(result)
        self.assertEqual(body["error"], "no_such_file")
        self.assertEqual(body["option"], "--brief")
        self.assertEqual(body["path"], missing)

    def test_empty_file_is_distinct(self) -> None:
        self.seed_report()
        empty = self.repo / "empty.md"
        empty.write_text("", encoding="utf-8")
        body = self.trailer(self.reviewer("--brief", str(empty)))
        self.assertEqual(body["error"], "empty_file")

    def test_not_accepted_names_template(self) -> None:
        self.seed_report()
        body = self.trailer(self.reviewer("--dir", str(self.repo)))
        self.assertEqual(body["error"], "not_accepted")
        self.assertEqual(body["option"], "--dir")
        self.assertEqual(body["template"], "task-reviewer")

    def test_required_missing_when_no_derivation(self) -> None:
        # No seed_report(), so neither the report nor the diff can be derived.
        body = self.trailer(self.reviewer())
        self.assertEqual(body["error"], "required_missing")
        self.assertIn(body["option"], {"--report", "--diff"})
        self.assertEqual(body["template"], "task-reviewer")

    def test_parent_missing_for_a_write_slot(self) -> None:
        result = self.run_util(
            "implementer", "--plan", str(self.plan), "--task", "1",
            "--name", "Thing", "--brief", str(self.brief),
            "--report", str(self.repo / "nodir" / "r.md"),
            root=str(self.roots / "6.2.0" / "skills"),
        )
        self.assertEqual(self.trailer(result)["error"], "parent_missing")

    def test_trailer_never_carries_file_contents(self) -> None:
        # self.brief holds BRIEF-BODY-SENTINEL; a constraints file is inlined.
        constraints = self.repo / "constraints.md"
        constraints.write_text("CONSTRAINTS-BODY-SENTINEL\n", encoding="utf-8")
        result = self.reviewer("--constraints", str(constraints))
        self.assertNotIn("BRIEF-BODY-SENTINEL", result.stderr)
        self.assertNotIn("CONSTRAINTS-BODY-SENTINEL", result.stderr)

    def test_non_argument_failure_emits_no_trailer(self) -> None:
        result = self.reviewer(root=str(self.tmp / "no-such-root"))
        self.assertEqual(result.returncode, 2)
        lines = [line for line in result.stderr.splitlines() if line.strip()]
        with self.assertRaises(json.JSONDecodeError):
            json.loads(lines[-1])
```

Have `DescribeSlotsTests` subclass `DispatchPromptTestCase` too, replacing its local `run_util` with the inherited one.

- [ ] **Step 8: Run the trailer tests to verify they fail**

Run: `python3 projects/agents/utils/dispatch_prompt_test.py FaultTrailerTests -v`
Expected: FAIL — no JSON on the final stderr line.

- [ ] **Step 9: Emit the trailer**

Give `Fail` a structured payload, keeping its human message:

```python
class Fail(Exception):
    """A user-facing failure. Nothing is written when this is raised."""

    def __init__(self, message: str, *, error: str | None = None,
                 option: str | None = None, path: str | None = None,
                 template: str | None = None) -> None:
        super().__init__(message)
        # Only enumerated argument faults carry a code; template-resolution
        # and drift failures deliberately do not, so an embedder classifying
        # by trailer treats them as unrecognized (dpr-10).
        self.error = error
        self.option = option
        self.path = path
        self.template = template

    def trailer(self) -> str | None:
        if self.error is None:
            return None
        body: dict[str, str] = {"error": self.error, "option": self.option or ""}
        if self.path is not None:
            body["path"] = self.path
        if self.template is not None:
            body["template"] = self.template
        return json.dumps(body, sort_keys=True)
```

Attach codes at the five raise sites — `read_file` (`no_such_file`, `empty_file`), `slot_value`'s `path_out` branch (`parent_missing`), `main`'s unaccepted-option check (`not_accepted`), and the render loop's unsatisfied-slot check (`required_missing`). For example, in `read_file`:

```python
    if not path.is_file():
        raise Fail(f"{option}: no such file: {path}",
                   error="no_such_file", option=option, path=path_str)
    content = path.read_text(encoding="utf-8")
    if not content.strip():
        raise Fail(f"{option}: file is empty: {path}",
                   error="empty_file", option=option, path=path_str)
```

Then print the trailer in `main`'s handler:

```python
    except Fail as exc:
        print(f"dispatch-prompt: {exc}", file=sys.stderr)
        trailer = exc.trailer()
        if trailer is not None:
            print(trailer, file=sys.stderr)
        return 2
```

Pass `template=args.template` at the two sites that know it (`not_accepted`, `required_missing`).

- [ ] **Step 10: Run the trailer tests to verify they pass**

Run: `python3 projects/agents/utils/dispatch_prompt_test.py -v`
Expected: PASS, all tests including both new classes.

- [ ] **Step 11: Align `--help`**

Update the four `help=` strings so they match the declared directions:

```python
    parser.add_argument("--brief", help="task or review brief FILE — must exist, substituted as a path")
    parser.add_argument("--report", help="implementer/fixer report FILE to READ (task-reviewer, re-review); WRITE destination (implementer)")
    parser.add_argument("--diff", help="review package diff FILE — required for task-reviewer and re-review unless derivable")
    parser.add_argument("--constraints", help="global constraints file (contents inlined); defaults to the workspace file")
```

- [ ] **Step 12: Commit**

```bash
git add projects/agents/utils/dispatch-prompt projects/agents/utils/dispatch_prompt_test.py
git commit -m "feat(agents): declare slot direction, dump the slot table, code argument faults (dpr-5, dpr-10, dpr-11)"
```

---

### Task 2: Facade — rename the fields

**Requirements:** xsvc-11, xsvc-12, xsdd-1, xsdd-2, xsdd-3, xsdd-6, xsdd-9

Independent of Task 1 — may run concurrently, but do not let it touch `sdd_prompt.ts`'s error-classification block, which Task 3 owns.

**Files:**
- Modify: `projects/xagent/src/service/tool_schemas.ts`
- Modify: `projects/xagent/src/service/sdd_manager.ts`
- Modify: `projects/xagent/src/service/sdd_prompt.ts` (argument construction only)
- Test: `projects/xagent/tests/sdd_manager.test.ts`, `projects/xagent/tests/mcp.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces the final field vocabulary Task 3 and Task 4 depend on:
  - `xagent_sdd_start`: `model` (was `agent`); `report_out` for `implementer`/`fixer`; `implementer_report` for task-scoped `reviewer`; `fixer_report` for `re-reviewer`; result `{ run_id, sequence, brief_path, report_out_path?, prompt_path?, renderer_path? }`.
  - `xagent_sdd_followup`: `run_id` (was `agent_id`); `report_out` for kind `fix`; `fixer_report` for kind `re-review`; result `{ run_id, sequence }`.

- [ ] **Step 1: Write the failing tests for retired names at the MCP boundary**

The union alone is not enough: the SDK validates against the advertised `z.object` first, and a plain object schema strips undeclared keys before the handler runs. Add to `projects/xagent/tests/mcp.test.ts`:

```typescript
test("retired field names are rejected, not stripped", async (t) => {
  const harness = await startMcpService(t);
  for (const retired of ["agent", "report", "agent_id"]) {
    const response = await harness.callTool("xagent_sdd_start", {
      role: "implementer",
      cwd: harness.worktree,
      plan: harness.planPath,
      task: 1,
      name: "n",
      brief: harness.briefPath,
      report_out: harness.reportPath,
      model: "opus",
      harness: "claude_code",
      effort: "high",
      [retired]: "leftover",
    });
    assert.match(JSON.stringify(response), /invalid_tool_input|unrecognized/i,
      `${retired} must be rejected, not silently stripped`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd projects/xagent && npx tsx --test tests/mcp.test.ts`
Expected: FAIL — the retired keys are stripped and the call succeeds.

- [ ] **Step 3: Rename in the union and the advertised schemas**

In `tool_schemas.ts`:
- `SddAssignmentFields`: `agent:` → `model:`.
- `ImplementerStartSchema`, `FixerStartSchema`: `report:` → `report_out:`.
- `ReviewerStartObject`: `report:` → `implementer_report:`; update `ReviewerRefinement`'s messages and its `["report", "constraints", "diff"]` list to `["implementer_report", "constraints", "diff"]`.
- `ReReviewerStartSchema`: `report:` → `fixer_report:`.
- `FixFollowupSchema`: `agent_id:` → `run_id:`; `report:` → `report_out:`.
- `ReReviewFollowupSchema`: `agent_id:` → `run_id:`; `report:` → `fixer_report:`.
- `AgentIdSchema`: rename to `RunIdSchema` and change its message to `"run_id must be a generated xagent run id"`.
- In both `*AdvertisedSchema` objects: rename the same fields, and append `.passthrough()` to each object so undeclared keys survive to the union:

```typescript
export const XagentSddStartAdvertisedSchema = z.object({
  // ...fields...
}).passthrough();
```

Add the comment explaining why, matching the existing `xagent_await` note in the same file.

- [ ] **Step 4: Rename through the manager and argument construction**

In `sdd_manager.ts`: `input.agent` → `input.model`; every `input.report` → the role's new field; every public result key, structured error detail key, and validation message using `agent_id` → `run_id`. Leave `sdd_agents.agent_id` column references and ledger-internal locals alone.

In `sdd_prompt.ts` `BuildDispatchArgs`, the renderer flags are unchanged — only the source field names change:

```typescript
    case "implementer":
      args.push("--task", String(input.task));
      args.push("--name", input.name);
      args.push("--brief", input.brief);
      if (input.reportOut !== undefined) {
        args.push("--report", input.reportOut);
      }
```

- [ ] **Step 5: Specify the per-role start result**

In `sdd_manager.ts`, build the result so `fixer` omits the renderer keys rather than returning empty strings:

```typescript
  const result: SddStartResult = {
    run_id: runId,
    sequence,
    brief_path: briefPath,
  };
  if (reportOutPath !== undefined)
  {
    result.report_out_path = reportOutPath;
  }
  if (promptPath !== "")
  {
    result.prompt_path = promptPath;
    result.renderer_path = rendererPath;
  }
  return result;
```

- [ ] **Step 6: Add result-shape tests for all four roles**

In `sdd_manager.test.ts`, assert: implementer and fixer return `report_out_path`; task-scoped reviewer and re-reviewer do not; fixer omits `prompt_path` and `renderer_path` entirely (`assert.ok(!("prompt_path" in result))`); every role returns `run_id` and no result carries an `agent_id` key.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `make -C projects/xagent test`
Expected: PASS. Fix any call sites the compiler flags — `strict` will find them.

- [ ] **Step 8: Commit**

```bash
git add projects/xagent/src projects/xagent/tests
git commit -m "feat(xagent): one name per function on the SDD dispatch surface (xsvc-11, xsvc-12, xsdd-9)"
```

---

### Task 3: Facade — dispatch field manifest, truthful descriptions, coded errors

**Requirements:** xsvc-15, xsvc-17, xsvc-18, xsdd-2, xsdd-3

Depends on Task 1 (`--describe-slots`, the fault trailer) and Task 2 (the field vocabulary).

**Files:**
- Create: `projects/xagent/src/service/dispatch_manifest.ts` (the registry, the entry type, and the generated-artifact loader)
- Create: `projects/xagent/src/service/dispatch_manifest.generated.json` (checked in, produced by the packaging step)
- Modify: `projects/xagent/src/service/tool_schemas.ts`
- Modify: `projects/xagent/src/service/sdd_prompt.ts`
- Modify: `plugins/xagent/scripts/package_xagent.py` (generate + `--check` the manifest)
- Test: `projects/xagent/tests/dispatch_manifest.test.ts`, `projects/xagent/tests/sdd_prompt.test.ts`

**Interfaces:**
- Consumes: Task 1's `--describe-slots` JSON and stderr trailer; Task 2's field names.
- Produces:
  - `DISPATCH_VARIANTS`: the closed registry, exactly `["implementer", "reviewer:task", "reviewer:branch", "fixer", "re-reviewer", "followup:fix", "followup:re-review"]`.
  - `REGISTRY: Record<Variant, readonly string[]>` — the matrix: each variant mapped to its in-scope public fields. `OPERATIONAL_FIELDS` is exactly `role`, `kind`, `cwd`, `model`, `harness`, `effort`, `policy`, `note`, `run_id`, and is subtracted before any comparison.
  - `ManifestEntry = { variant: string; field: string | null; source: "renderer" | "service"; rendererOption: string | null; provenance: "caller_input" | "ledger" | "derived"; surfaceKind: "path" | "text"; direction: "reads" | "writes" | null; transport: "path_substituted" | "inlined_contents" | "not_applicable"; requiredCondition: "always" | "unless-derivable" | "optional"; derivation: Derivation | null }`. Entries are keyed by `(variant, rendererOption, provenance)` — one per **reachable** provenance, so `--diff` on a task-scoped reviewer has both a `caller_input` and a `derived` entry. Only `caller_input` entries carry a non-null `field`.
  - `DispatchManifest(): ManifestEntry[]` — **synchronous**, reading the checked-in generated JSON. No subprocess at runtime.
  - `CallerInputProjection(): Array<{variant: string, field: string}>` — the `caller_input` entries reduced to variant/field pairs. This is what equals `REGISTRY`; the full manifest is a superset.
  - `SurfaceFieldFor(variant: string, rendererOption: string): string | null` — **synchronous**; null for an option the facade never sends *and* for `ledger`/`derived` options, which the caller routes to `sdd_stored_artifact_missing` or `sdd_renderer_failed` respectively.

- [ ] **Step 1: Write the failing manifest-coverage test**

Create `projects/xagent/tests/dispatch_manifest.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { LoadDispatchManifest, SurfaceFieldFor } from "../src/service/dispatch_manifest.ts";
import { XagentSddStartAdvertisedSchema } from "../src/service/tool_schemas.ts";

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
  const manifest = DispatchManifest().concat([{
    variant: "reviewer:security", field: "brief", source: "service",
    rendererOption: null, surfaceKind: "path", direction: "reads",
    transport: "path_substituted", requiredCondition: "always", derivation: null,
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
  assert.equal(SurfaceFieldFor("followup:re-review", "--brief"), null);
  assert.equal(SurfaceFieldFor("followup:re-review", "--plan"), null);
  // An option the facade never sends.
  assert.equal(SurfaceFieldFor("implementer", "--out"), null);
});

test("advertised descriptions agree with the manifest", () => {
  const shape = XagentSddStartAdvertisedSchema.shape;
  for (const entry of DispatchManifest().filter((e) => e.direction !== null)) {
    const described = shape[entry.field]?.description ?? "";
    const expected = entry.direction === "writes" ? /writes/i : /reads|must already exist/i;
    assert.match(described, expected,
      `${entry.field} (${entry.variant}) is ${entry.direction} but described as "${described}"`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd projects/xagent && npx tsx --test tests/dispatch_manifest.test.ts`
Expected: FAIL — `Cannot find module '../src/service/dispatch_manifest.ts'`.

- [ ] **Step 3: Build the manifest module and its generator**

The manifest is a **checked-in generated artifact**, not a runtime subprocess: the advertised schemas are module-level constants and MCP registration is synchronous, so the renderer must not be on the service's boot path. `package_xagent.py` gains a generation step that runs `dispatch-prompt --describe-slots`, joins it with the service-owned declaration, and writes `dispatch_manifest.generated.json`; its existing `--check` mode compares the checked-in copy and fails on divergence. Generation aborts if `schema_version !== 1`.

Create `projects/xagent/src/service/dispatch_manifest.ts` holding the registry, the entry type, the service-owned declaration, the variant→template and option→field maps, and a synchronous loader over the generated JSON:

```typescript
// The renderer owns the contract for the variants it renders. `fixer` and
// follow-up `fix` have no Superpowers template — upstream a fix is a follow-up
// to a live implementer — so their prompt text in sdd_prompt.ts is the
// authority, declared here (xsvc-17).
const x_ServiceEntries: readonly ManifestEntry[] = [
  { variant: "fixer", field: "brief", source: "service", rendererOption: null,
    direction: "reads", requiredCondition: "always", derivation: null },
  { variant: "fixer", field: "findings", source: "service", rendererOption: null,
    direction: "reads", requiredCondition: "always", derivation: null },
  { variant: "fixer", field: "report_out", source: "service", rendererOption: null,
    direction: "writes", requiredCondition: "always", derivation: null },
  { variant: "fix", field: "findings", source: "service", rendererOption: null,
    direction: "reads", requiredCondition: "always", derivation: null },
  { variant: "fix", field: "report_out", source: "service", rendererOption: null,
    direction: "writes", requiredCondition: "always", derivation: null },
];

export const DISPATCH_VARIANTS = [
  "implementer", "reviewer:task", "reviewer:branch", "fixer",
  "re-reviewer", "followup:fix", "followup:re-review",
] as const;

const x_VariantTemplates: Record<string, string | null> = {
  "implementer": "implementer",
  "reviewer:task": "task-reviewer",
  "reviewer:branch": "code-reviewer",
  "re-reviewer": "re-review",
  "followup:re-review": "re-review",
  "fixer": null,          // service-formatted
  "followup:fix": null,   // service-formatted
};

// Every renderer option the facade sends, per variant. Non-artifact options
// are here too: dpr-10 can name them in a trailer, and xsvc-18 requires every
// allowlisted trailer to resolve to a surface field. An option absent here is
// one the facade never sends, and classification falls back to opaque.
const x_OptionFields: Record<string, Record<string, string>> = {
  "implementer": {
    "--report": "report_out", "--brief": "brief", "--name": "name",
    "--context": "context", "--task": "task", "--plan": "plan",
  },
  "reviewer:task": {
    "--report": "implementer_report", "--brief": "brief",
    "--constraints": "constraints", "--diff": "diff",
    "--base": "base", "--head": "head", "--task": "task", "--plan": "plan",
  },
  "reviewer:branch": {
    "--requirements": "brief", "--description": "description",
    "--base": "base", "--head": "head", "--plan": "plan",
  },
  "re-reviewer": {
    "--report": "fixer_report", "--brief": "brief", "--findings": "findings",
    "--diff": "diff", "--base": "base", "--head": "head",
    "--round": "round", "--task": "task", "--plan": "plan",
  },
  "followup:re-review": {
    "--report": "fixer_report", "--brief": "brief", "--findings": "findings",
    "--diff": "diff", "--base": "base", "--head": "head",
    "--round": "round", "--task": "task", "--plan": "plan",
  },
};
```

Note `reviewer:branch`'s `brief` maps to `--requirements`, a `text` slot the renderer gives no direction. The entry records `surfaceKind: "path"`, `direction: "reads"`, `transport: "inlined_contents"` — both statements true at once (xsvc-17, design D11).

`DispatchManifest()` reads the generated JSON synchronously and returns `ManifestEntry[]`; `requiredCondition` is computed at generation time as `has_fallback ? "optional" : derivation ? "unless-derivable" : "always"`. `SurfaceFieldFor(variant, option)` reads `x_OptionFields` and returns `null` for an unknown option — never a dash-stripped guess, which would leak renderer vocabulary into a public error.

- [ ] **Step 4: Generate the descriptions from the manifest**

In `tool_schemas.ts`, replace each hand-written artifact-field description with one built from the manifest entry — direction phrase, the variants that require it, and the derivation where one exists. Keep transport in the prose for `brief` and `findings` without renaming them (xsdd-9):

```typescript
  brief: SddArtifactPathSchema.optional()
    .describe(AdvertisedFor("implementer, reviewer, fixer, re-reviewer",
      "Absolute path to the assignment document the agent READS. A task-scoped "
      + "reviewer receives its path; a whole-branch reviewer has its contents "
      + "inlined into the prompt.")),
  implementer_report: SddArtifactPathSchema.optional()
    .describe(AdvertisedFor("reviewer (task-scoped)",
      "Absolute path to the implementer's EXISTING report, which the reviewer READS. "
      + "Not the reviewer's own output path.")),
  report_out: SddArtifactPathSchema.optional()
    .describe(AdvertisedFor("implementer, fixer",
      "Absolute path the agent WRITES its report to; it need not exist yet.")),
  diff: SddArtifactPathSchema.optional()
    .describe(AdvertisedFor("reviewer (task-scoped), re-reviewer",
      "Absolute path to the review-package diff. REQUIRED unless the plan "
      + "workspace already holds review-<base>..<head>.diff.")),
```

- [ ] **Step 5: Require `diff` unless derivable**

Add to `ReviewerRefinement` and the re-reviewer/`re-review` refinements: when `diff` is absent, check for `<repoRoot>/.superpowers/sdd/<plan-slug>/review-<shortBase>..<shortHead>.diff`; if missing, add an issue naming `diff`. Reuse the manifest's `derivation` string rather than hardcoding the filename a second time.

- [ ] **Step 6: Classify the renderer trailer**

In `sdd_prompt.ts`, replace the opaque fallback with trailer classification, keeping stderr withheld:

```typescript
const x_RendererFaultCodes = new Set([
  "no_such_file", "empty_file", "parent_missing", "not_accepted", "required_missing",
]);

const x_PathFaults = new Set(["no_such_file", "empty_file", "parent_missing"]);

function ClassifyRendererFault(stderr: string, variant: string): SddPromptError | null {
  const lines = stderr.split(/\r?\n/).filter((line) => line.trim() !== "");
  const last = lines.at(-1);
  if (last === undefined) { return null; }
  let body: { error?: string; option?: string; path?: string };
  try { body = JSON.parse(last); }
  catch { return null; }
  if (body.error === undefined || !x_RendererFaultCodes.has(body.error)) { return null; }
  // The renderer only knows --report; the caller sent implementer_report.
  // A null field means an option the facade never sends — stay opaque rather
  // than leak renderer vocabulary (xsvc-18).
  const field = SurfaceFieldFor(variant, body.option ?? "");
  if (field === null) { return null; }
  return new SddPromptError({
    error: "sdd_renderer_bad_input",
    message: "dispatch-prompt rejected an input argument.",
    // Exactly {reason, field}, plus `path` only for the three path faults.
    // Never the renderer template or option.
    details: x_PathFaults.has(body.error) && body.path !== undefined
      ? { reason: body.error, field, path: body.path }
      : { reason: body.error, field },
  });
}
```

Call it after the `sdd_templates_missing` branch and before the `sdd_renderer_failed` fallback.

- [ ] **Step 7: Add the error-classification tests**

In `sdd_prompt.test.ts`, drive `RenderSddPrompt` with a stubbed `execFile` that rejects with each trailer form and assert: the reason code round-trips; the field is `implementer_report` for a task-scoped reviewer and `report_out` for an implementer given the same `--report` trailer; an unparseable last line yields `sdd_renderer_failed`; and a stderr containing a body-text marker never appears in the thrown error.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `make -C projects/xagent test`
Expected: PASS, including `dispatch_manifest.test.ts`.

- [ ] **Step 9: Commit**

```bash
git add projects/xagent/src projects/xagent/tests
git commit -m "feat(xagent): derive SDD descriptions from a dispatch field manifest, code renderer faults (xsvc-17, xsvc-18)"
```

---

### Task 4: Audit and ship — docs, skills, package

**Requirements:** xsdd-9

Depends on Tasks 2 and 3 — the vocabulary and error surface must be final.

**Files:**
- Modify: `plugins/xagent/skills/xagent-subagents/SKILL.md`
- Modify: `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md`
- Modify: `projects/xagent/docs/` as the sweep finds
- Modify: `plugins/xagent/assets/xagent/dist/**` (generated)

**Interfaces:**
- Consumes: the final field vocabulary from Tasks 2 and 3.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Fix the aliasing instructions in the xagent skill**

`plugins/xagent/skills/xagent-subagents/SKILL.md` currently teaches the collision as a workaround. Replace the aliasing sentences — "Controllers now use `xagent_await` / `xagent_close` with `run_id` (the same value returned as `agent_id`)" and "Record the returned `agent_id` (use it as `run_id` for generic tools)" — with plain statements that the dispatch tools return `run_id` and the generic tools take it unchanged. Update the `report` sentence to name the direction per role.

- [ ] **Step 2: Fix the workflow skill**

`projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md`: same three renames at lines describing the SDD flow, plus the `diff` requirement for task-scoped reviews and re-reviews.

- [ ] **Step 3: Sweep the docs**

Run: `grep -rn "agent_id\|\bagent:\|\breport\b" projects/xagent/docs/ plugins/xagent/skills/ projects/agents/global/skills/`
Fix each hit that describes the dispatch API; leave hits that legitimately mean the ledger column or an agent's prose report.

- [ ] **Step 4: Verify no retired vocabulary survives**

Run: `grep -rn "xagent_sdd_start" --include=*.md . | grep -v openspec/changes/archive | grep -n "agent_id\|report\b"`
Expected: no hit that describes a tool field.

- [ ] **Step 5: Rebuild the shipped package**

Run: `python3 plugins/xagent/scripts/package_xagent.py`
Then: `make xagent-plugin-test`
Expected: PASS — `package_xagent.py --check` confirms the shipped `dist/` matches source.

- [ ] **Step 6: Commit**

```bash
git add plugins projects/agents/global/skills projects/xagent/docs
git commit -m "docs(xagent,agents): sync skills, docs, and the shipped package to the SDD vocabulary"
```

---

### Task 5: Verification and OpenSpec sync

**Files:**
- Modify: `openspec/changes/clarify-sdd-dispatch-api/tasks.md`

- [ ] **Step 1: Full suites**

Run: `make -C projects/xagent test`
Run: `python3 projects/agents/utils/dispatch_prompt_test.py`
Run: `make xagent-plugin-test`
Expected: all PASS.

- [ ] **Step 2: Positive end-to-end**

Dispatch an `implementer` on a scratch plan, then a task-scoped `reviewer` with `implementer_report` pointing at the implementer's real report and a generated `diff`. Expected: both render and start — the exact sequence that failed in session `85b47883`.

- [ ] **Step 3: Negative end-to-end**

Three calls, each expecting a structured error naming the caller's own field before any agent is dispatched:
- a task-scoped `reviewer` with no `diff` and no derivable file → names `diff`
- a task-scoped `reviewer` with a nonexistent `implementer_report` → `sdd_renderer_bad_input`, reason `no_such_file`, field `implementer_report`
- any start carrying a retired `report` field → rejected, not stripped

- [ ] **Step 4: Tick the OpenSpec checkboxes and validate**

Run: `openspec validate clarify-sdd-dispatch-api --strict`
Expected: valid.

- [ ] **Step 5: Commit**

```bash
git add openspec/changes/clarify-sdd-dispatch-api/tasks.md
git commit -m "docs(openspec): mark clarify-sdd-dispatch-api tasks complete"
```
