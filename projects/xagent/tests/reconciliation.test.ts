import assert from "node:assert/strict";
import test from "node:test";

import {
  isDegradedReconciliationCleanup,
  logReconciliationResults,
  reconciliationWarning,
} from "../src/service/reconciliation.js";
import type { ReconciliationResult } from "../src/supervision/reconcile.js";

test("reconciliationWarning is undefined for clean or empty reconciliation", () => {
  assert.equal(reconciliationWarning([]), undefined);
  assert.equal(
    reconciliationWarning([
      { run_id: "a", cleanup: "terminated" },
    ]),
    undefined,
  );
  assert.equal(
    reconciliationWarning([
      { run_id: "a", cleanup: "terminated" },
      { run_id: "b", cleanup: "process_not_found" },
    ]),
    undefined,
  );
});

test("reconciliationWarning reports a bounded degraded message for any non-clean outcome", () => {
  const degraded: ReconciliationResult[] = [
    { run_id: "a", cleanup: "identity_mismatch" },
    { run_id: "b", cleanup: "process_group_unproven" },
    { run_id: "c", cleanup: "inspection_failed" },
    { run_id: "d", cleanup: "termination_failed" },
    { run_id: "e", cleanup: "persistence_failed" },
  ];
  const warning = reconciliationWarning(degraded);
  assert.equal(typeof warning, "string");
  assert.match(warning!, /supervision_degraded/);
  assert.match(warning!, /5/);
  assert.ok(warning!.length <= 256, "warning must be bounded");

  // A single degraded outcome among clean ones still raises the warning.
  const mixed = reconciliationWarning([
    { run_id: "clean1", cleanup: "terminated" },
    { run_id: "degraded1", cleanup: "termination_failed" },
    { run_id: "clean2", cleanup: "process_not_found" },
  ]);
  assert.match(mixed!, /supervision_degraded/);
  assert.match(mixed!, /1 stale run/);
});

test("isDegradedReconciliationCleanup classifies only non-clean outcomes as degraded", () => {
  assert.equal(isDegradedReconciliationCleanup("terminated"), false);
  assert.equal(isDegradedReconciliationCleanup("process_not_found"), false);
  assert.equal(isDegradedReconciliationCleanup("identity_mismatch"), true);
  assert.equal(isDegradedReconciliationCleanup("process_group_unproven"), true);
  assert.equal(isDegradedReconciliationCleanup("inspection_failed"), true);
  assert.equal(isDegradedReconciliationCleanup("termination_failed"), true);
  assert.equal(isDegradedReconciliationCleanup("persistence_failed"), true);
});

test("logReconciliationResults writes one bounded stderr line per result", () => {
  const lines: string[] = [];
  logReconciliationResults(
    [
      { run_id: "run_a", cleanup: "terminated" },
      { run_id: "run_b", cleanup: "termination_failed" },
    ],
    (message) => lines.push(message),
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "xagent service reconciliation: run_id=run_a cleanup=terminated");
  assert.equal(lines[1], "xagent service reconciliation: run_id=run_b cleanup=termination_failed");
  for (const line of lines) {
    assert.ok(line.length <= 256, "log line must be bounded");
  }
});

test("logReconciliationResults writes nothing for an empty reconciliation", () => {
  const lines: string[] = [];
  logReconciliationResults([], (message) => lines.push(message));
  assert.equal(lines.length, 0);
});
