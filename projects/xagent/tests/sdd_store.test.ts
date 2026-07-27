import assert from "node:assert/strict";
import { chmodSync, existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  CreateSddStore,
  GetSddDatabasePath,
  OpenSddLedgerDatabase,
  SddStoreError,
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

const x_ForbiddenLedgerColumns = [
  "rendered_prompt",
  "renderedPrompt",
  "jsonl_offset",
  "jsonlOffset",
];

function AssertLedgerSchemaExcludesPromptAndOffsetColumns(database: Database.Database): void {
  const sessionColumns = database
    .prepare("PRAGMA table_info(sdd_sessions)")
    .all() as Array<{ name: string }>;
  const turnColumns = database
    .prepare("PRAGMA table_info(sdd_turns)")
    .all() as Array<{ name: string }>;

  for (const columnName of x_ForbiddenLedgerColumns) {
    assert.equal(sessionColumns.some((column) => column.name === columnName), false);
    assert.equal(turnColumns.some((column) => column.name === columnName), false);
  }
}

test("creates version-1 schema with WAL and owner-only permissions for a new log root", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-schema-"));
  const logRoot = path.join(parentRoot, "sdd-log");

  try {
    const store = CreateSddStore(logRoot, () => new Date("2026-07-26T00:00:00.000Z"));
    store.Close();

    const databasePath = GetSddDatabasePath(logRoot);
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.pragma("user_version", { simple: true }), 1);
    assert.equal(database.pragma("journal_mode", { simple: true }), "wal");
    AssertLedgerSchemaExcludesPromptAndOffsetColumns(database);
    database.close();

    const stat = statSync(GetSddDatabasePath(logRoot));
    const createdLogRootStat = statSync(logRoot);
    assert.equal(Number(stat.mode) & 0o777, 0o600);
    assert.equal(Number(createdLogRootStat.mode) & 0o077, 0);
  }
  finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

function AssertOwnerOnlyFileMode(filePath: string): void {
  const stat = statSync(filePath);
  assert.equal(Number(stat.mode) & 0o777, 0o600);
}

test("re-secures permissions on an existing sdd.sqlite file and WAL sidecars after writes", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-resecure-"));

  try {
    const initial = CreateSddStore(logRoot);
    initial.ReserveInitial(sampleInitialInput);
    initial.Close();

    chmodSync(logRoot, 0o755);
    const databasePath = GetSddDatabasePath(logRoot);
    chmodSync(databasePath, 0o644);

    const reopened = CreateSddStore(logRoot);
    reopened.ReserveInitial({
      ...sampleInitialInput,
      agentId: "xrun_20260726000000000_00000002",
      briefText: "Second session brief.\n",
    });

    AssertOwnerOnlyFileMode(databasePath);
    AssertOwnerOnlyFileMode(`${databasePath}-wal`);
    assert.equal(existsSync(`${databasePath}-shm`), true);
    AssertOwnerOnlyFileMode(`${databasePath}-shm`);

    reopened.Close();
  }
  finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("rejects orphan turn inserts when the ledger connection enables foreign keys", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-fk-"));

  try {
    const store = CreateSddStore(logRoot);
    store.ReserveInitial(sampleInitialInput);
    store.Close();

    const database = OpenSddLedgerDatabase(GetSddDatabasePath(logRoot));
    assert.throws(
      () => database.prepare(`
        INSERT INTO sdd_turns (
          agent_id,
          turn_number,
          kind,
          brief_path,
          brief_text,
          status,
          created_at
        ) VALUES (?, 99, 'fix', '/b', 'brief', 'prepared', '2026-01-01')
      `).run("missing-session-id"),
      /FOREIGN KEY constraint failed/,
    );
    database.close();
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
    assert.equal(session.plan_name, "xagent-sdd-mode");
    assert.equal(session.closed_at, null);

    let openTurn = store.GetOpenTurn(sampleAgentId);
    assert.ok(openTurn);
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
      (error: unknown) =>
      {
        assert.ok(error instanceof SddStoreError);
        assert.equal(error.code, "open_turn");
        return true;
      },
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
