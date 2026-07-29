import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  CreateSddAgentStore,
  GetSddDatabasePath,
  OpenSddLedgerDatabase,
  SddStoreError,
} from "../src/service/sdd_store.js";

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
    // Seed a v1 user_version without the deleted CreateSddStore factory.
    //
    const databasePath = GetSddDatabasePath(logRoot);
    const seed = new Database(databasePath);
    seed.pragma("user_version = 1");
    seed.close();
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

    // The gate must refuse without touching the file it cannot read.
    const reopened = new Database(databasePath, { readonly: true });
    try {
      assert.equal(reopened.pragma("user_version", { simple: true }), 3);
    } finally {
      reopened.close();
    }
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

test("the v1 store and its schema are gone", async () => {
  const source = await readFile(
    new URL("../../src/service/sdd_store.ts", import.meta.url),
    "utf8",
  );
  for (const symbol of [
    "CreateSddStore", "ReconcileTerminalRuns", "abandonOpenTurns", "MarkRunning",
    "MarkCompleted", "MarkFailed", "MarkAbandoned", "MarkClosed", "GetOpenTurn",
    "GetLatestTurn", "GetTurnByCompletedSequence", "probeClosedSessionTurns",
    "repairClosedSessionTurns", "sdd_dispatch_log", "sdd_sessions", "sdd_turns",
  ]) {
    assert.equal(source.includes(symbol), false, `${symbol} must be deleted`);
  }
  assert.equal(/UPDATE\s+sdd/i.test(source), false);
});

test("a stale v1 ledger refuses at startup with the documented reprovision wording", async () => {
  const logRoot = await mkdtemp(path.join(tmpdir(), "sdd-v1-"));
  try {
    const database = OpenSddLedgerDatabase(GetSddDatabasePath(logRoot));
    database.pragma("user_version = 1");
    database.close();
    assert.throws(() => CreateSddAgentStore(logRoot), (error: unknown) => {
      assert.ok(error instanceof SddStoreError);
      assert.equal(error.code, "sdd_ledger_schema_mismatch");
      assert.match(error.message, /stop the service, delete/);
      assert.match(error.message, /sdd\.sqlite-wal/);
      assert.match(error.message, /sdd\.sqlite-shm/);
      assert.match(error.message, /v1 data is not migrated/);
      return true;
    });
  } finally {
    await rm(logRoot, { recursive: true, force: true });
  }
});
