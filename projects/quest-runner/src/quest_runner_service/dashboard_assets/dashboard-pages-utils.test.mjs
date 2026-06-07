import test from "node:test";
import assert from "node:assert/strict";
import {
  EscapeHtml,
  MarkdownToSafeHtml,
  PlanFileStorageKey,
  SelectPlanFile,
  FileLabelForDiff,
  BuildDiffRowsHtml,
  FormatQuestLastTransitionHtml,
} from "./dashboard-pages-utils.mjs";

test("SelectPlanFile prefers stored when valid", () => {
  assert.equal(SelectPlanFile(["a.md", "b.md"], "b.md"), "b.md");
});

test("SelectPlanFile falls back to first", () => {
  assert.equal(SelectPlanFile(["x.md"], "missing.md"), "x.md");
});

test("SelectPlanFile empty", () => {
  assert.equal(SelectPlanFile([], "x"), null);
  assert.equal(SelectPlanFile(null, null), null);
});

test("PlanFileStorageKey is stable and uses project", () => {
  const key = PlanFileStorageKey("web", "main", 1, 2);
  assert.match(key, /^dash\.planFile:v1\|/);
  assert.ok(key.includes("web"));
});

test("MarkdownToSafeHtml escapes", () => {
  assert.ok(MarkdownToSafeHtml("<x>").includes("&lt;x&gt;"));
});

test("MarkdownToSafeHtml renders basic markdown", () => {
  const html = MarkdownToSafeHtml("# Title\n\n- **bold** item\n\n`code`");
  assert.ok(html.includes("<h1>Title</h1>"));
  assert.ok(html.includes("<ul><li><strong>bold</strong> item</li></ul>"));
  assert.ok(html.includes("<code>code</code>"));
});

test("FileLabelForDiff rename", () => {
  assert.ok(
    FileLabelForDiff({ path: "n", path_before: "o" }).includes("→"),
  );
});

test("BuildDiffRowsHtml covers addition and removal", () => {
  const html = BuildDiffRowsHtml([
    { kind: "removal", old: { line_no: 1, text: "a" }, new: null },
    { kind: "addition", old: null, new: { line_no: 1, text: "b" } },
  ]);
  assert.ok(html.includes("dash-diff-row--del"));
  assert.ok(html.includes("dash-diff-row--add"));
});

test("FormatQuestLastTransitionHtml null", () => {
  assert.equal(FormatQuestLastTransitionHtml(null), "—");
});

test("FormatQuestLastTransitionHtml metadata step and slice chain", () => {
  const html = FormatQuestLastTransitionHtml({
    timestamp: "2026-04-01T12:00:00Z",
    previous_state: "ExecuteSlice",
    next_state: "ExecuteSlice",
    global_step: 3,
    child_chain: [
      {
        machine_path: "quests/main/0001_q",
        machine_name: "quest",
        state_before: "ExecuteSlice",
        state_after: "ExecuteSlice",
      },
      {
        machine_path: "quests/main/0001_q/slices/0000_s",
        machine_name: "slice",
        state_before: "Implementing",
        state_after: "PolishingReview",
      },
    ],
  });
  assert.ok(html.includes("step 3"));
  assert.ok(html.includes("slice:"));
  assert.ok(html.includes("Implementing"));
});
