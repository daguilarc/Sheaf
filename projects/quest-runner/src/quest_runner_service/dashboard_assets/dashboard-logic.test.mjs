import test from "node:test";
import assert from "node:assert/strict";
import {
  MergeRunBadge,
  RefreshScheduler,
  ResolveRepositorySelection,
} from "./dashboard-logic.mjs";

test("ResolveRepositorySelection prefers valid query over stored", () => {
  const tracked = ["/a", "/b"];
  const r = ResolveRepositorySelection("/b", "/a", "/a", tracked);
  assert.equal(r.repoPath, "/b");
  assert.equal(r.invalidQueryPath, null);
});

test("ResolveRepositorySelection falls back when query untracked", () => {
  const tracked = ["/a"];
  const r = ResolveRepositorySelection("/nope", "/a", null, tracked);
  assert.equal(r.repoPath, "/a");
  assert.equal(r.invalidQueryPath, "/nope");
});

test("ResolveRepositorySelection uses default when query missing", () => {
  const tracked = ["/x", "/y"];
  const r = ResolveRepositorySelection(null, null, "/y", tracked);
  assert.equal(r.repoPath, "/y");
});

test("ResolveRepositorySelection uses first tracked as last resort", () => {
  const tracked = ["/first", "/second"];
  const r = ResolveRepositorySelection(null, null, null, tracked);
  assert.equal(r.repoPath, "/first");
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
