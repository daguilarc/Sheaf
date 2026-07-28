import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  CreateSddAgentStore,
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

test("marks prepared or running turns abandoned during reportless terminal reconciliation", async () => {
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

    const completedPhaseAgentId = "xrun_20260726000000000_00000003";
    store.ReserveInitial({
      ...sampleInitialInput,
      agentId: completedPhaseAgentId,
      briefText: "Completed-phase session brief.\n",
    });
    store.MarkRunning(completedPhaseAgentId, 1, 9);

    store.ReconcileTerminalRuns(new Map([
      [sampleAgentId, "abandoned"],
      [otherAgentId, "running"],
      [completedPhaseAgentId, "completed"],
    ]));

    const abandonedTurn = store.GetOpenTurn(sampleAgentId);
    assert.equal(abandonedTurn, undefined);
    assert.equal(store.GetOpenTurn(completedPhaseAgentId)?.status, "running");

    const database = new Database(GetSddDatabasePath(logRoot), { readonly: true });
    const abandonedRow = database
      .prepare("SELECT status FROM sdd_turns WHERE agent_id = ? AND turn_number = 1")
      .get(sampleAgentId) as { status: string };
    const preparedRow = database
      .prepare("SELECT status FROM sdd_turns WHERE agent_id = ? AND turn_number = 1")
      .get(otherAgentId) as { status: string };
    const completedPhaseRow = database
      .prepare("SELECT status FROM sdd_turns WHERE agent_id = ? AND turn_number = 1")
      .get(completedPhaseAgentId) as { status: string };
    database.close();

    assert.equal(abandonedRow.status, "abandoned");
    assert.equal(preparedRow.status, "prepared");
    assert.equal(completedPhaseRow.status, "running");
    store.Close();
  }
  finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("closing a session abandons its unresolved turns", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-close-"));
  const logRoot = path.join(parentRoot, "sdd-log");

  try {
    const store = CreateSddStore(logRoot);
    store.ReserveInitial(sampleInitialInput);
    store.MarkRunning(sampleAgentId, 1, 2);

    store.MarkClosed(sampleAgentId, "2026-07-27T20:00:00.000Z");
    assert.equal(store.GetOpenTurn(sampleAgentId), undefined);
    store.Close();

    const database = new Database(GetSddDatabasePath(logRoot), { readonly: true });
    const row = database
      .prepare("SELECT status, completed_at FROM sdd_turns WHERE agent_id = ? AND turn_number = 1")
      .get(sampleAgentId) as { status: string; completed_at: string | null };
    database.close();
    assert.equal(row.status, "abandoned");
    assert.equal(row.completed_at, "2026-07-27T20:00:00.000Z");
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("opening the store repairs turns left running under a closed session", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-repair-"));
  const logRoot = path.join(parentRoot, "sdd-log");

  try {
    const first = CreateSddStore(logRoot);
    first.ReserveInitial(sampleInitialInput);
    first.MarkRunning(sampleAgentId, 1, 2);
    first.Close();

    // The pre-fix production state: the session row is closed while its turn
    // is still `running` with a null completed_at.
    const database = new Database(GetSddDatabasePath(logRoot));
    database
      .prepare("UPDATE sdd_sessions SET closed_at = ? WHERE agent_id = ?")
      .run("2026-07-27T20:00:00.000Z", sampleAgentId);
    database.close();

    const second = CreateSddStore(logRoot);
    assert.equal(second.GetOpenTurn(sampleAgentId), undefined);
    second.Close();

    const verify = new Database(GetSddDatabasePath(logRoot), { readonly: true });
    const row = verify
      .prepare("SELECT status, completed_at FROM sdd_turns WHERE agent_id = ? AND turn_number = 1")
      .get(sampleAgentId) as { status: string; completed_at: string | null };
    verify.close();
    assert.equal(row.status, "abandoned");
    assert.equal(row.completed_at, "2026-07-27T20:00:00.000Z");
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("closing an already-closed session is a no-op, not a persistence failure", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-reclose-"));
  const logRoot = path.join(parentRoot, "sdd-log");
  try {
    const store = CreateSddStore(logRoot);
    store.ReserveInitial(sampleInitialInput);
    store.MarkClosed(sampleAgentId, "2026-07-28T00:00:00.000Z");
    // A client that lost the first confirmation retries; that must succeed.
    store.MarkClosed(sampleAgentId, "2026-07-28T00:01:00.000Z");
    store.Close();
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

test("closing a session that never existed still fails", async () => {
  const parentRoot = await mkdtemp(path.join(tmpdir(), "xagent-sdd-noclose-"));
  const logRoot = path.join(parentRoot, "sdd-log");
  try {
    const store = CreateSddStore(logRoot);
    assert.throws(
      () => store.MarkClosed("xrun_20260101000000000_deadbeef", "2026-07-28T00:00:00.000Z"),
      SddStoreError,
    );
    store.Close();
  } finally {
    await rm(parentRoot, { recursive: true, force: true });
  }
});

const x_V2AgentInput = {
  agentId: "xrun_20260728000000000_0000000a",
  planPath: "/tmp/plans/2026-07-28-redesign-sdd-ledger.md",
  task: 4,
  role: "implementer" as const,
  briefPath: "/tmp/sdd/task-4-brief.md",
  briefText: "Implement the v2 ledger store.\n",
  cwd: "/private/tmp/worktree",
};

test("v2 provisions exactly sdd_agents and its index at user_version 2", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    const store = CreateSddAgentStore(logRoot);
    store.Close();
    const database = new Database(GetSddDatabasePath(logRoot), { readonly: true });
    try {
      assert.equal(database.pragma("user_version", { simple: true }), 2);
      const tables = database
        .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view','index') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string; type: string }>;
      assert.deepEqual(tables, [
        { name: "sdd_agents", type: "table" },
        { name: "sdd_agents_assignment", type: "index" },
      ]);
    } finally {
      database.close();
    }
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("v2 inserts are readable and carry the brief text as dispatched", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    const store = CreateSddAgentStore(logRoot, () => new Date("2026-07-28T10:00:00.000Z"));
    store.Insert(x_V2AgentInput);
    const row = store.Get(x_V2AgentInput.agentId);
    assert.deepEqual(row, {
      agent_id: x_V2AgentInput.agentId,
      plan_path: x_V2AgentInput.planPath,
      task: 4,
      role: "implementer",
      brief_path: x_V2AgentInput.briefPath,
      brief_text: x_V2AgentInput.briefText,
      cwd: x_V2AgentInput.cwd,
      dispatched_at: "2026-07-28T10:00:00.000Z",
    });
    assert.equal(store.IsSddAgent(x_V2AgentInput.agentId), true);
    assert.equal(store.IsSddAgent("xrun_20260728000000000_ffffffff"), false);
    store.Close();
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("a task-less reviewer row stores NULL task", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    const store = CreateSddAgentStore(logRoot);
    store.Insert({ ...x_V2AgentInput, role: "reviewer", task: undefined });
    assert.equal(store.Get(x_V2AgentInput.agentId)!.task, null);
    store.Close();
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("multiple agents may share plan, task, and role", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    const store = CreateSddAgentStore(logRoot);
    store.Insert(x_V2AgentInput);
    store.Insert({ ...x_V2AgentInput, agentId: "xrun_20260728000000000_0000000b" });
    assert.equal(store.ListAll().length, 2);
    store.Close();
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("opening a v1 ledger refuses with an actionable reprovision message", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    CreateSddStore(logRoot).Close();          // writes user_version = 1
    assert.throws(
      () => CreateSddAgentStore(logRoot),
      (error: unknown) => {
        assert.ok(error instanceof SddStoreError);
        assert.match(error.message, /sdd\.sqlite/);
        assert.match(error.message, /-wal/);
        assert.match(error.message, /-shm/);
        assert.match(error.message, /not migrated/);
        return true;
      },
    );
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("opening a newer ledger refuses without offering delete", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-newer-"));
  try {
    const databasePath = GetSddDatabasePath(logRoot);
    const database = new Database(databasePath);
    database.pragma("user_version = 3");
    database.close();

    assert.throws(
      () => CreateSddAgentStore(logRoot),
      (error: unknown) => {
        assert.ok(error instanceof SddStoreError);
        assert.equal(error.code, "sdd_ledger_schema_mismatch");
        assert.match(error.message, /schema version 3/);
        assert.match(error.message, /older than the ledger/);
        assert.match(error.message, /upgrade/);
        assert.match(error.message, /do not delete/);
        assert.equal(/not migrated/.test(error.message), false);
        assert.equal(/stop the service, delete/.test(error.message), false);
        return true;
      },
    );
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

function DigestPathOrNull(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function DigestLedgerBundle(databasePath: string): {
  readonly db: string;
  readonly wal: string | null;
  readonly shm: string | null;
} {
  return {
    db: createHash("sha256").update(readFileSync(databasePath)).digest("hex"),
    wal: DigestPathOrNull(`${databasePath}-wal`),
    shm: DigestPathOrNull(`${databasePath}-shm`),
  };
}

test("reopening a v2 ledger writes nothing", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-"));
  try {
    const first = CreateSddAgentStore(logRoot);
    first.Insert(x_V2AgentInput);
    first.Close();
    const databasePath = GetSddDatabasePath(logRoot);
    const before = DigestLedgerBundle(databasePath);
    const digestBefore = CreateSddAgentStore(logRoot);
    const rows = digestBefore.ListAll();
    digestBefore.Close();
    assert.equal(rows.length, 1);
    assert.deepEqual(DigestLedgerBundle(databasePath), before);
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("no update or delete statement against sdd_agents is compiled", async () => {
  // Resolves only when running from dist/tests/ (npm test / node --test dist/...).
  //
  const serviceDir = new URL("../../src/service/", import.meta.url);
  const entries = await readdir(serviceDir);
  const sources = await Promise.all(
    entries
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFile(new URL(name, serviceDir), "utf8")),
  );
  const corpus = sources.join("\n");
  const mutatesAgents =
    /(?:UPDATE|REPLACE\s+INTO)\s+(?:\w+\.)?["`]?sdd_agents["`]?/i.test(corpus)
    || /DELETE\s+FROM\s+(?:\w+\.)?["`]?sdd_agents["`]?/i.test(corpus);
  assert.equal(mutatesAgents, false);
});

test("v1 adapter maps session roles onto SddStartRole", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v1-role-map-"));
  try {
    const store = CreateSddStore(logRoot);
    store.ReserveInitial({
      ...sampleInitialInput,
      role: "task-reviewer",
    });
    const record = store.Get(sampleAgentId);
    assert.equal(record?.role, "reviewer");
    store.Close();
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("v1 Insert refuses SddStartRoles with no v1 equivalent", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v1-role-refuse-"));
  try {
    const store = CreateSddStore(logRoot);
    assert.throws(
      () => store.Insert({ ...x_V2AgentInput, role: "fixer" }),
      (error: unknown) => {
        assert.ok(error instanceof SddStoreError);
        assert.equal(error.code, "sdd_role_unmapped");
        return true;
      },
    );
    store.Close();
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("v2 Insert wraps duplicate agent_id as SddStoreError", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-dup-"));
  try {
    const store = CreateSddAgentStore(logRoot);
    store.Insert(x_V2AgentInput);
    assert.throws(
      () => store.Insert(x_V2AgentInput),
      (error: unknown) => {
        assert.ok(error instanceof SddStoreError);
        assert.equal(error.code, "sdd_agent_already_exists");
        return true;
      },
    );
    store.Close();
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});

test("v2 reads after Close throw SddStoreError", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v2-closed-"));
  try {
    const store = CreateSddAgentStore(logRoot);
    store.Close();
    assert.throws(() => store.Get(x_V2AgentInput.agentId), SddStoreError);
    assert.throws(() => store.ListAll(), SddStoreError);
    assert.throws(() => store.IsSddAgent(x_V2AgentInput.agentId), SddStoreError);
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});
