import Database from "better-sqlite3";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export type SddStartRole = "implementer" | "reviewer" | "fixer" | "re-reviewer";

export type SddAgentRecord = {
  readonly agent_id: string;
  readonly plan_path: string;
  readonly task: number | null;
  readonly role: SddStartRole;
  readonly brief_path: string;
  readonly brief_text: string;
  readonly cwd: string;
  readonly dispatched_at: string;
};

export type InsertSddAgentInput = {
  readonly agentId: string;
  readonly planPath: string;
  readonly task?: number;
  readonly role: SddStartRole;
  readonly briefPath: string;
  readonly briefText: string;
  readonly cwd: string;
};

export type SddAgentStore = {
  Insert(input: InsertSddAgentInput): void;
  Get(agentId: string): SddAgentRecord | undefined;
  ListAll(): readonly SddAgentRecord[];
  IsSddAgent(agentId: string): boolean;
  Close(): void;
};

const x_BusyTimeoutMs = 5000;
const x_DatabaseFileName = "sdd.sqlite";
const x_AgentSchemaVersion = 2;

const x_AgentSchemaSql = `
CREATE TABLE sdd_agents
(
    agent_id      TEXT PRIMARY KEY,
    plan_path     TEXT NOT NULL,
    task          INTEGER,
    role          TEXT NOT NULL CHECK (role IN
                      ('implementer', 'reviewer', 'fixer', 're-reviewer')),
    brief_path    TEXT NOT NULL,
    brief_text    TEXT NOT NULL,
    cwd           TEXT NOT NULL,
    dispatched_at TEXT NOT NULL,
    CHECK (task IS NULL OR task > 0)
);

CREATE INDEX sdd_agents_assignment ON sdd_agents(plan_path, task, role);
`;

export class SddStoreError extends Error {
  readonly code: string;

  constructor(message: string, code = "sdd_store_error") {
    super(message);
    this.name = "SddStoreError";
    this.code = code;
  }
}

function EnsureOwnerOnlyDirectory(directoryPath: string): void {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  }
}

function EnsureOwnerOnlyDatabaseFile(databasePath: string): void {
  chmodSync(databasePath, 0o600);
}

function EnsureOwnerOnlyLedgerFiles(databasePath: string): void {
  EnsureOwnerOnlyDatabaseFile(databasePath);
  const walPath = `${databasePath}-wal`;
  const shmPath = `${databasePath}-shm`;
  if (existsSync(walPath)) {
    chmodSync(walPath, 0o600);
  }
  if (existsSync(shmPath)) {
    chmodSync(shmPath, 0o600);
  }
}

export function OpenSddLedgerDatabase(databasePath: string): Database.Database {
  const database = new Database(databasePath);
  database.pragma(`busy_timeout = ${x_BusyTimeoutMs}`);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  return database;
}

function MapAgentRow(row: Record<string, unknown>): SddAgentRecord
{
  return {
    agent_id: String(row.agent_id),
    plan_path: String(row.plan_path),
    task: row.task === null || row.task === undefined ? null : Number(row.task),
    role: row.role as SddStartRole,
    brief_path: String(row.brief_path),
    brief_text: String(row.brief_text),
    cwd: String(row.cwd),
    dispatched_at: String(row.dispatched_at),
  };
}

// The v2 ledger is an immutable dispatch index. It is provisioned at
// user_version 2 and never migrated: a v1 file is refused outright, because a
// half-working ledger is worse than a loud one. No UPDATE or DELETE statement
// against sdd_agents is prepared here, so no code path can rot a row.
//
export function CreateSddAgentStore(
  logRoot: string,
  clock: () => Date = () => new Date(),
): SddAgentStore {
  EnsureOwnerOnlyDirectory(logRoot);
  const databasePath = path.join(logRoot, x_DatabaseFileName);
  if (existsSync(databasePath)) {
    EnsureOwnerOnlyLedgerFiles(databasePath);
  }
  const database = OpenSddLedgerDatabase(databasePath);
  EnsureOwnerOnlyLedgerFiles(databasePath);

  const userVersion = database.pragma("user_version", { simple: true }) as number;
  if (userVersion !== 0 && userVersion !== x_AgentSchemaVersion) {
    database.close();
    const remediation = userVersion < x_AgentSchemaVersion
      ? "v1 data is not migrated: stop the service, delete "
        + `${databasePath}, ${databasePath}-wal, and ${databasePath}-shm, `
        + "then start the service to provision a fresh v2 ledger."
      : "this build is older than the ledger; upgrade the service — do not delete the ledger.";
    throw new SddStoreError(
      `SDD ledger at ${databasePath} is schema version ${userVersion}; `
      + `this service requires version ${x_AgentSchemaVersion}. `
      + remediation,
      "sdd_ledger_schema_mismatch",
    );
  }
  if (userVersion === 0) {
    const provision = database.transaction(() => {
      database.exec(x_AgentSchemaSql);
      database.pragma(`user_version = ${x_AgentSchemaVersion}`);
    });
    provision();
  }

  const insertAgent = database.prepare(`
    INSERT INTO sdd_agents (
      agent_id, plan_path, task, role, brief_path, brief_text, cwd, dispatched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectAgent = database.prepare(
    "SELECT agent_id, plan_path, task, role, brief_path, brief_text, cwd, dispatched_at "
    + "FROM sdd_agents WHERE agent_id = ?",
  );
  const selectAllAgents = database.prepare(
    "SELECT agent_id, plan_path, task, role, brief_path, brief_text, cwd, dispatched_at "
    + "FROM sdd_agents ORDER BY dispatched_at",
  );

  let closed = false;

  function AssertAgentStoreOpen(): void {
    if (closed) {
      throw new SddStoreError("SDD agent store is closed.");
    }
  }

  return {
    Insert(input: InsertSddAgentInput): void {
      AssertAgentStoreOpen();
      try {
        insertAgent.run(
          input.agentId,
          input.planPath,
          input.task ?? null,
          input.role,
          input.briefPath,
          input.briefText,
          input.cwd,
          clock().toISOString(),
        );
      } catch (error) {
        if (
          error instanceof Error
          && "code" in error
          && (error as { code: string }).code === "SQLITE_CONSTRAINT_PRIMARYKEY"
        ) {
          throw new SddStoreError(
            `SDD agent already exists: ${input.agentId}`,
            "sdd_agent_already_exists",
          );
        }
        throw error;
      }
    },
    Get(agentId: string): SddAgentRecord | undefined {
      AssertAgentStoreOpen();
      const row = selectAgent.get(agentId) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : MapAgentRow(row);
    },
    ListAll(): readonly SddAgentRecord[] {
      AssertAgentStoreOpen();
      return (selectAllAgents.all() as Array<Record<string, unknown>>).map(MapAgentRow);
    },
    IsSddAgent(agentId: string): boolean {
      AssertAgentStoreOpen();
      return selectAgent.get(agentId) !== undefined;
    },
    Close(): void {
      if (!closed) {
        closed = true;
        database.close();
      }
    },
  };
}

export function GetSddDatabasePath(logRoot: string): string {
  return path.join(logRoot, x_DatabaseFileName);
}
