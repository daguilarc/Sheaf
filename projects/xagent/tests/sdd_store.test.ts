import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  CreateSddStore,
  GetSddDatabasePath,
  SddStoreError,
  type SddSessionRecord,
  type SddTurnRecord,
} from "../src/service/sdd_store.js";

const sampleAgentId = "xrun_20260726000000000_00000001";

const sampleInitialInput = {
  agentId: sampleAgentId,
  planName: "xagent-sdd-mode",
  planPath: "/tmp/plan.md",
  cwd: "/tmp/worktree",
  taskNumber: 1,
  agent: "composer-2.5",
  harness: "cursor",
  effort: "high",
  role: "implementer" as const,
  briefPath: "/tmp/task-1-brief.md",
  briefText: "Implement the versioned SDD ledger.\n",
  reportPath: "/tmp/task-1-report.md",
};

function AssertNoPromptOrOffsetFields(record: SddSessionRecord | SddTurnRecord): void {
  const keys = Object.keys(record);
  assert.equal(keys.includes("rendered_prompt"), false);
  assert.equal(keys.includes("renderedPrompt"), false);
  assert.equal(keys.includes("jsonl_offset"), false);
  assert.equal(keys.includes("jsonlOffset"), false);
}

test("creates version-1 schema with WAL, foreign keys, and owner-only permissions", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-schema-"));
  try {
    const store = CreateSddStore(logRoot, () => new Date("2026-07-26T00:00:00.000Z"));
    store.Close();

    const databasePath = GetSddDatabasePath(logRoot);
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.pragma("user_version", { simple: true }), 1);
    assert.equal(database.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1);
    database.close();

    const stat = statSync(GetSddDatabasePath(logRoot));
    const parentStat = statSync(logRoot);
    assert.equal(Number(stat.mode) & 0o777, 0o600);
    assert.equal(Number(parentStat.mode) & 0o077, 0);
  }
  finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("rejects unknown newer schema versions without mutating user_version", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-newer-"));
  try {
    const databasePath = GetSddDatabasePath(logRoot);
    const database = new Database(databasePath);
    database.pragma("user_version = 2");
    database.close();

    assert.throws(
      () => CreateSddStore(logRoot),
      (error: unknown) => {
        assert.ok(error instanceof SddStoreError);
        assert.match(error.message, /Unsupported SDD database schema version 2/);
        return true;
      },
    );

    const reopened = new Database(databasePath, { readonly: true });
    assert.equal(reopened.pragma("user_version", { simple: true }), 2);
    reopened.close();
  }
  finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("reserves initial turns, follow-ups, lifecycle transitions, and restart reads", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-lifecycle-"));
  const clock = () => new Date("2026-07-26T10:00:00.000Z");

  try {
    const store = CreateSddStore(logRoot, clock);
    store.ReserveInitial(sampleInitialInput);

    let session = store.GetSession(sampleAgentId);
    assert.ok(session);
    AssertNoPromptOrOffsetFields(session);
    assert.equal(session.plan_name, "xagent-sdd-mode");
    assert.equal(session.closed_at, null);

    let openTurn = store.GetOpenTurn(sampleAgentId);
    assert.ok(openTurn);
    AssertNoPromptOrOffsetFields(openTurn);
    assert.equal(openTurn.turn_number, 1);
    assert.equal(openTurn.kind, "initial");
    assert.equal(openTurn.brief_text, "Implement the versioned SDD ledger.\n");
    assert.equal(openTurn.report_path, "/tmp/task-1-report.md");
    assert.equal(openTurn.status, "prepared");

    store.MarkRunning(sampleAgentId, 1, 10);
    store.MarkCompleted(sampleAgentId, 1, "Status: DONE\n", 42);

    const turnTwo = store.PrepareFollowup({
      agentId: sampleAgentId,
      kind: "fix",
      round: 2,
      briefPath: sampleInitialInput.briefPath,
      briefText: sampleInitialInput.briefText,
      reportPath: sampleInitialInput.reportPath,
      findingsPath: "/tmp/findings.md",
      findingsText: "Missing WAL assertion.\n",
    });
    assert.equal(turnTwo, 2);

    store.MarkRunning(sampleAgentId, 2, 43);
    store.MarkCompleted(sampleAgentId, 2, "Status: DONE\nFix applied.\n", 44);

    const completedTurnOne = store.GetOpenTurn(sampleAgentId);
    assert.equal(completedTurnOne, undefined);

    const database = new Database(GetSddDatabasePath(logRoot), { readonly: true });
    const turnOne = database
      .prepare("SELECT report_text FROM sdd_turns WHERE agent_id = ? AND turn_number = 1")
      .get(sampleAgentId) as { report_text: string };
    const turnTwoRow = database
      .prepare("SELECT report_text, findings_text FROM sdd_turns WHERE agent_id = ? AND turn_number = 2")
      .get(sampleAgentId) as { report_text: string; findings_text: string };
    database.close();

    assert.equal(turnOne.report_text, "Status: DONE\n");
    assert.equal(turnTwoRow.report_text, "Status: DONE\nFix applied.\n");
    assert.equal(turnTwoRow.findings_text, "Missing WAL assertion.\n");

    store.MarkClosed(sampleAgentId, "2026-07-26T11:00:00.000Z");
    session = store.GetSession(sampleAgentId);
    assert.equal(session?.closed_at, "2026-07-26T11:00:00.000Z");
    store.Close();

    const restarted = CreateSddStore(logRoot, clock);
    session = restarted.GetSession(sampleAgentId);
    assert.ok(session);
    assert.equal(session.closed_at, "2026-07-26T11:00:00.000Z");
    assert.equal(restarted.IsSddAgent(sampleAgentId), true);
    restarted.Close();
  }
  finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("rejects illegal transitions and follow-ups while a turn is open", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-illegal-"));
  try {
    const store = CreateSddStore(logRoot);
    store.ReserveInitial(sampleInitialInput);

    assert.throws(
      () => store.PrepareFollowup({
        agentId: sampleAgentId,
        kind: "fix",
        round: 2,
        briefPath: sampleInitialInput.briefPath,
        briefText: sampleInitialInput.briefText,
      }),
      SddStoreError,
    );

    assert.throws(() => store.MarkCompleted(sampleAgentId, 1, "done", 2), SddStoreError);
    store.MarkRunning(sampleAgentId, 1, 1);
    assert.throws(() => store.MarkRunning(sampleAgentId, 1, 2), SddStoreError);
    store.MarkFailed(sampleAgentId, 1);
    assert.throws(() => store.MarkCompleted(sampleAgentId, 1, "done", 2), SddStoreError);
    store.Close();
  }
  finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("marks prepared or running turns abandoned during terminal reconciliation", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-reconcile-"));
  const clock = () => new Date("2026-07-26T12:00:00.000Z");

  try {
    const store = CreateSddStore(logRoot, clock);
    store.ReserveInitial(sampleInitialInput);
    store.MarkRunning(sampleAgentId, 1, 5);

    const otherAgentId = "xrun_20260726000000000_00000002";
    store.ReserveInitial({
      ...sampleInitialInput,
      agentId: otherAgentId,
      briefText: "Second session brief.\n",
    });

    store.ReconcileTerminalRuns(new Map([
      [sampleAgentId, "abandoned"],
      [otherAgentId, "running"],
    ]));

    const abandonedTurn = store.GetOpenTurn(sampleAgentId);
    assert.equal(abandonedTurn, undefined);

    const database = new Database(GetSddDatabasePath(logRoot), { readonly: true });
    const abandonedRow = database
      .prepare("SELECT status FROM sdd_turns WHERE agent_id = ? AND turn_number = 1")
      .get(sampleAgentId) as { status: string };
    const preparedRow = database
      .prepare("SELECT status FROM sdd_turns WHERE agent_id = ? AND turn_number = 1")
      .get(otherAgentId) as { status: string };
    database.close();

    assert.equal(abandonedRow.status, "abandoned");
    assert.equal(preparedRow.status, "prepared");
    store.Close();
  }
  finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});
