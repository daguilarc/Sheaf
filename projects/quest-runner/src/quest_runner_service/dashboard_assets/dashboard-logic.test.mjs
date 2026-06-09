import test from "node:test";
import assert from "node:assert/strict";
import {
  BuildAdvanceQuestPayload,
  BuildDashboardSearchParams,
  BuildLandExperimentPayload,
  BuildLandQuestPayload,
  BuildQuestApiQuery,
  BuildRunQuestPayload,
  InferQuestDisplayStatus,
  IsExperimentSelection,
  MergeRunBadge,
  RefreshScheduler,
  ResolveProjectSelection,
  ShouldShowAdvanceButton,
  ShouldShowExperimentLandButton,
  ShouldShowLandButton,
  ShouldShowRunButton,
  StorageProjectKey,
  x_SERVICE_CONTROL_LABELS,
} from "./dashboard-logic.mjs";

test("StorageProjectKey uses quest runner namespace", () => {
  assert.equal(StorageProjectKey(), "quest_runner_dashboard.project");
});

test("ResolveProjectSelection prefers valid query over stored", () => {
  const listed = ["alpha", "beta"];
  const r = ResolveProjectSelection("beta", "alpha", "alpha", listed);
  assert.equal(r.project, "beta");
  assert.equal(r.invalidQueryProject, null);
});

test("ResolveProjectSelection falls back when query not listed", () => {
  const listed = ["alpha"];
  const r = ResolveProjectSelection("nope", "alpha", null, listed);
  assert.equal(r.project, "alpha");
  assert.equal(r.invalidQueryProject, "nope");
});

test("ResolveProjectSelection uses default when query missing", () => {
  const listed = ["x", "y"];
  const r = ResolveProjectSelection(null, null, "y", listed);
  assert.equal(r.project, "y");
});

test("ResolveProjectSelection uses first listed as last resort", () => {
  const listed = ["first", "second"];
  const r = ResolveProjectSelection(null, null, null, listed);
  assert.equal(r.project, "first");
});

test("BuildQuestApiQuery includes project identity", () => {
  const q = BuildQuestApiQuery("web", "main", 4);
  assert.deepEqual(q, {
    project: "web",
    quest_type: "main",
    quest_number: 4,
  });
});

test("BuildQuestApiQuery includes experiment_id when provided", () => {
  const q = BuildQuestApiQuery("web", "main", 4, "experiment_web_main_4_0");
  assert.equal(q.experiment_id, "experiment_web_main_4_0");
});

test("BuildQuestApiQuery omits experiment_id when absent", () => {
  const q = BuildQuestApiQuery("web", "main", 4, null);
  assert.equal(q.experiment_id, undefined);
});

test("BuildDashboardSearchParams encodes project and quest", () => {
  const p = BuildDashboardSearchParams({
    project: "web",
    questType: "main",
    questNumber: 2,
    page: "overview",
  });
  assert.equal(p.get("project"), "web");
  assert.equal(p.get("quest_type"), "main");
  assert.equal(p.get("quest_number"), "2");
  assert.equal(p.get("page"), "overview");
});

test("BuildDashboardSearchParams preserves experiment_id for experiment selection", () => {
  const p = BuildDashboardSearchParams({
    project: "web",
    questType: "main",
    questNumber: 2,
    page: "overview",
    selectedKind: "experiment",
    experimentId: "experiment_web_main_2_0",
  });
  assert.equal(p.get("experiment_id"), "experiment_web_main_2_0");
});

test("BuildDashboardSearchParams omits experiment_id for quest selection", () => {
  const p = BuildDashboardSearchParams({
    project: "web",
    questType: "main",
    questNumber: 2,
    selectedKind: "quest",
    experimentId: "experiment_web_main_2_0",
  });
  assert.equal(p.get("experiment_id"), null);
});

test("BuildRunQuestPayload includes project identity", () => {
  const body = BuildRunQuestPayload("web", "main", 1, 3);
  assert.deepEqual(body, {
    project: "web",
    quest_type: "main",
    quest_number: 1,
    max_steps: 3,
  });
});

test("BuildAdvanceQuestPayload includes project identity", () => {
  const body = BuildAdvanceQuestPayload("web", "side", 2);
  assert.deepEqual(body, {
    project: "web",
    quest_type: "side",
    quest_number: 2,
  });
});

test("BuildLandQuestPayload includes project identity", () => {
  const body = BuildLandQuestPayload("web", "main", 3);
  assert.deepEqual(body, {
    project: "web",
    quest_type: "main",
    quest_number: 3,
  });
});

test("BuildLandExperimentPayload includes experiment_id", () => {
  const body = BuildLandExperimentPayload("web", "main", 3, "experiment_web_main_3_0");
  assert.deepEqual(body, {
    project: "web",
    quest_type: "main",
    quest_number: 3,
    experiment_id: "experiment_web_main_3_0",
  });
});

test("BuildLandQuestPayload does not include experiment_id", () => {
  const body = BuildLandQuestPayload("web", "main", 3);
  assert.equal(body.experiment_id, undefined);
});

test("IsExperimentSelection identifies experiment rows", () => {
  assert.equal(IsExperimentSelection("experiment"), true);
  assert.equal(IsExperimentSelection("quest"), false);
});

test("ShouldShowExperimentLandButton true when experiment can land", () => {
  assert.equal(
    ShouldShowExperimentLandButton({
      experiment: { can_land: true },
    }),
    true
  );
  assert.equal(
    ShouldShowExperimentLandButton({
      experiment: { can_land: false },
    }),
    false
  );
});

test("ShouldShowRunButton true for open idle quest with worktree", () => {
  assert.equal(
    ShouldShowRunButton(
      {
        quest_state: "ExecuteSlice",
        worktree_missing: false,
        execution_overlay_status: "none",
      },
      { execution_overlay_status: "none", active_run: null }
    ),
    true
  );
});

test("ShouldShowRunButton false when completed", () => {
  assert.equal(
    ShouldShowRunButton({ quest_state: "Completed", worktree_missing: false }, null),
    false
  );
});

test("ShouldShowRunButton false when running", () => {
  assert.equal(
    ShouldShowRunButton(
      {
        quest_state: "ExecuteSlice",
        worktree_missing: false,
        execution_overlay_status: "running",
      },
      { active_run: { run_id: "r1" } }
    ),
    false
  );
});

test("ShouldShowRunButton false for human intervention", () => {
  assert.equal(
    ShouldShowRunButton(
      {
        quest_state: "ExecuteSlice",
        worktree_missing: false,
        execution_overlay_status: "human_intervention",
      },
      null
    ),
    false
  );
});

test("ShouldShowRunButton false when worktree missing", () => {
  assert.equal(
    ShouldShowRunButton(
      {
        quest_state: "ExecuteSlice",
        worktree_missing: true,
        execution_overlay_status: "none",
      },
      null
    ),
    false
  );
});

test("ShouldShowAdvanceButton true for stopped incomplete quest with worktree", () => {
  assert.equal(
    ShouldShowAdvanceButton(
      {
        quest_state: "ExecuteSlice",
        worktree_missing: false,
        execution_overlay_status: "none",
      },
      { execution_overlay_status: "none", active_run: null }
    ),
    true
  );
});

test("ShouldShowAdvanceButton true during human intervention recovery", () => {
  assert.equal(
    ShouldShowAdvanceButton(
      {
        quest_state: "ExecuteSlice",
        worktree_missing: false,
        execution_overlay_status: "human_intervention",
      },
      null
    ),
    true
  );
});

test("ShouldShowAdvanceButton false when completed", () => {
  assert.equal(
    ShouldShowAdvanceButton({ quest_state: "Completed", worktree_missing: false }, null),
    false
  );
});

test("ShouldShowAdvanceButton false when running", () => {
  assert.equal(
    ShouldShowAdvanceButton(
      {
        quest_state: "ExecuteSlice",
        worktree_missing: false,
        execution_overlay_status: "running",
      },
      { active_run: { run_id: "r1" } }
    ),
    false
  );
});

test("ShouldShowAdvanceButton false when paused", () => {
  assert.equal(
    ShouldShowAdvanceButton(
      {
        quest_state: "ExecuteSlice",
        worktree_missing: false,
        execution_overlay_status: "paused",
      },
      null
    ),
    false
  );
});

test("ShouldShowAdvanceButton false when worktree missing", () => {
  assert.equal(
    ShouldShowAdvanceButton(
      {
        quest_state: "ExecuteSlice",
        worktree_missing: true,
        execution_overlay_status: "none",
      },
      null
    ),
    false
  );
});

test("ShouldShowAdvanceButton false without overview", () => {
  assert.equal(ShouldShowAdvanceButton(null, null), false);
});

test("ShouldShowLandButton true only for completed quest with worktree", () => {
  assert.equal(
    ShouldShowLandButton(
      {
        quest_state: "Completed",
        worktree_missing: false,
        execution_overlay_status: "none",
      },
      { active_run: null }
    ),
    true
  );
  assert.equal(
    ShouldShowLandButton(
      {
        quest_state: "Completed",
        worktree_missing: true,
        execution_overlay_status: "none",
      },
      null
    ),
    false
  );
  assert.equal(
    ShouldShowLandButton(
      {
        quest_state: "ExecuteSlice",
        worktree_missing: false,
        execution_overlay_status: "none",
      },
      null
    ),
    false
  );
});

test("ShouldShowLandButton false while completed quest is busy", () => {
  assert.equal(
    ShouldShowLandButton(
      {
        quest_state: "Completed",
        worktree_missing: false,
        execution_overlay_status: "running",
      },
      { active_run: { run_id: "r1" } }
    ),
    false
  );
});

test("InferQuestDisplayStatus distinguishes completed and landed", () => {
  assert.equal(
    InferQuestDisplayStatus(
      {
        quest_state: "Completed",
        worktree_missing: false,
        execution_overlay_status: "none",
      },
      null
    ),
    "completed"
  );
  assert.equal(
    InferQuestDisplayStatus(
      {
        quest_state: "Completed",
        worktree_missing: true,
        execution_overlay_status: "none",
      },
      null
    ),
    "landed"
  );
});

test("InferQuestDisplayStatus keeps intervention and running precedence", () => {
  assert.equal(
    InferQuestDisplayStatus(
      {
        quest_state: "Completed",
        worktree_missing: false,
        execution_overlay_status: "human_intervention",
      },
      { active_run: { run_id: "r1" } }
    ),
    "human_intervention"
  );
  assert.equal(
    InferQuestDisplayStatus(
      {
        quest_state: "Completed",
        worktree_missing: false,
        execution_overlay_status: "paused",
      },
      null
    ),
    "paused"
  );
  assert.equal(
    InferQuestDisplayStatus(
      {
        quest_state: "Completed",
        worktree_missing: false,
        execution_overlay_status: "none",
      },
      { active_run: { run_id: "r1" } }
    ),
    "running"
  );
});

test("MergeRunBadge human intervention wins", () => {
  const b = MergeRunBadge(
    { execution_overlay_status: "human_intervention" },
    { active_run: { run_id: "r1" } }
  );
  assert.equal(b.variant, "hi");
});

test("MergeRunBadge running when active_run set", () => {
  const b = MergeRunBadge(
    { execution_overlay_status: "none" },
    { active_run: { run_id: "r1" } }
  );
  assert.equal(b.variant, "running");
});

test("MergeRunBadge reports completed and landed", () => {
  const completed = MergeRunBadge(
    {
      quest_state: "Completed",
      worktree_missing: false,
      execution_overlay_status: "none",
    },
    null
  );
  assert.equal(completed.label, "Completed");
  assert.equal(completed.variant, "completed");

  const landed = MergeRunBadge(
    {
      quest_state: "Completed",
      worktree_missing: true,
      execution_overlay_status: "none",
    },
    null
  );
  assert.equal(landed.label, "Landed");
  assert.equal(landed.variant, "landed");
});

test("service control labels are not part of dashboard navigation copy", () => {
  const navCopy = [
    "Overview",
    "Human intervention",
    "Diffs",
    "Agents",
    "Physical plan issues",
    "Quests",
    "Pages",
    "Project",
    "Run quest",
  ].join(" ");
  for (const label of x_SERVICE_CONTROL_LABELS) {
    assert.ok(!navCopy.includes(label), `unexpected service label: ${label}`);
  }
});

test("RefreshScheduler does not tick while hidden", async () => {
  let visible = false;
  let ticks = 0;
  const s = new RefreshScheduler({
    intervalMs: 20,
    getVisible: () => visible,
    onTick: async () => {
      ticks += 1;
    },
  });
  s.Start();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(ticks, 0);
  visible = true;
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(ticks >= 1);
  s.Stop();
});
