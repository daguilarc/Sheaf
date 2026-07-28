import Database from "better-sqlite3";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export type SddRole = "implementer" | "task-reviewer" | "code-reviewer";
export type SddTurnKind = "initial" | "fix" | "re_review";
export type SddTurnStatus = "prepared" | "running" | "completed" | "failed" | "abandoned";

export type SddSessionRecord = {
  agent_id: string;
  plan_name: string;
  plan_path: string;
  cwd: string;
  task_number: number | null;
  agent: string;
  harness: string;
  effort: string;
  role: SddRole;
  started_at: string;
  closed_at: string | null;
};

export type SddTurnRecord = {
  id: number;
  agent_id: string;
  turn_number: number;
  kind: SddTurnKind;
  round: number | null;
  brief_path: string;
  brief_text: string;
  report_path: string | null;
  findings_path: string | null;
  findings_text: string | null;
  report_text: string | null;
  resume_sequence: number | null;
  completed_sequence: number | null;
  status: SddTurnStatus;
  created_at: string;
  completed_at: string | null;
};

export type ReserveInitialInput = {
  agentId: string;
  planName: string;
  planPath: string;
  cwd: string;
  taskNumber?: number;
  agent: string;
  harness: string;
  effort: string;
  role: SddRole;
  briefPath: string;
  briefText: string;
  reportPath?: string;
};

export type PrepareFollowupInput = {
  agentId: string;
  kind: "fix" | "re_review";
  round: number;
  briefPath: string;
  briefText: string;
  reportPath?: string;
  findingsPath?: string;
  findingsText?: string;
};

export type SddStore = {
  ReserveInitial(input: ReserveInitialInput): void;
  PrepareFollowup(input: PrepareFollowupInput): number;
  MarkRunning(agentId: string, turnNumber: number, resumeSequence: number): void;
  MarkCompleted(agentId: string, turnNumber: number, reportText: string, completedSequence: number): void;
  MarkFailed(agentId: string, turnNumber: number): void;
  MarkAbandoned(agentId: string, turnNumber: number): void;
  MarkClosed(agentId: string, closedAt: string): void;
  GetSession(agentId: string): SddSessionRecord | undefined;
  GetOpenTurn(agentId: string): SddTurnRecord | undefined;
  GetLatestTurn(agentId: string): SddTurnRecord | undefined;
  GetTurnByCompletedSequence(agentId: string, completedSequence: number): SddTurnRecord | undefined;
  IsSddAgent(agentId: string): boolean;
  ReconcileTerminalRuns(phases: ReadonlyMap<string, string>): void;
  Close(): void;
};

const x_CurrentSchemaVersion = 1;
const x_BusyTimeoutMs = 5000;
const x_DatabaseFileName = "sdd.sqlite";

const x_TerminalPhases = new Set([
  "failed",
  "cancelled",
  "abandoned",
]);

const x_SchemaSql = `
CREATE TABLE sdd_sessions
(
    agent_id TEXT PRIMARY KEY,
    plan_name TEXT NOT NULL,
    plan_path TEXT NOT NULL,
    cwd TEXT NOT NULL,
    task_number INTEGER,
    agent TEXT NOT NULL,
    harness TEXT NOT NULL,
    effort TEXT NOT NULL,
    role TEXT NOT NULL,
    started_at TEXT NOT NULL,
    closed_at TEXT,
    CHECK (task_number IS NULL OR task_number > 0)
);

CREATE TABLE sdd_turns
(
    id INTEGER PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES sdd_sessions(agent_id),
    turn_number INTEGER NOT NULL,
    kind TEXT NOT NULL,
    round INTEGER,
    brief_path TEXT NOT NULL,
    brief_text TEXT NOT NULL,
    report_path TEXT,
    findings_path TEXT,
    findings_text TEXT,
    report_text TEXT,
    resume_sequence INTEGER,
    completed_sequence INTEGER,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    UNIQUE (agent_id, turn_number),
    CHECK (kind IN ('initial', 'fix', 're_review')),
    CHECK (round IS NULL OR round > 0),
    CHECK (status IN ('prepared', 'running', 'completed', 'failed', 'abandoned'))
);

CREATE INDEX sdd_turns_agent_status
    ON sdd_turns(agent_id, status);

CREATE VIEW sdd_dispatch_log AS
SELECT
    t.id,
    s.plan_name,
    s.plan_path,
    s.cwd,
    s.task_number,
    s.agent,
    s.harness,
    s.effort,
    s.role,
    s.agent_id,
    t.turn_number,
    t.kind,
    t.round,
    t.brief_path,
    t.brief_text,
    t.report_path,
    t.findings_path,
    t.findings_text,
    t.report_text,
    t.resume_sequence,
    t.completed_sequence,
    t.status,
    t.created_at,
    t.completed_at
FROM sdd_turns AS t
JOIN sdd_sessions AS s ON s.agent_id = t.agent_id;
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

function MigrateSchema(database: Database.Database): void {
  const userVersion = database.pragma("user_version", { simple: true }) as number;
  if (userVersion > x_CurrentSchemaVersion) {
    throw new SddStoreError(
      `Unsupported SDD database schema version ${userVersion}; service understands version ${x_CurrentSchemaVersion}.`,
    );
  }
  if (userVersion === x_CurrentSchemaVersion) {
    return;
  }

  const migrate = database.transaction(() => {
    database.exec(x_SchemaSql);
    database.pragma(`user_version = ${x_CurrentSchemaVersion}`);
  });
  migrate();
}

function MapSessionRow(row: Record<string, unknown>): SddSessionRecord {
  return {
    agent_id: String(row.agent_id),
    plan_name: String(row.plan_name),
    plan_path: String(row.plan_path),
    cwd: String(row.cwd),
    task_number: row.task_number === null || row.task_number === undefined
      ? null
      : Number(row.task_number),
    agent: String(row.agent),
    harness: String(row.harness),
    effort: String(row.effort),
    role: row.role as SddRole,
    started_at: String(row.started_at),
    closed_at: row.closed_at === null || row.closed_at === undefined
      ? null
      : String(row.closed_at),
  };
}

function MapTurnRow(row: Record<string, unknown>): SddTurnRecord {
  return {
    id: Number(row.id),
    agent_id: String(row.agent_id),
    turn_number: Number(row.turn_number),
    kind: row.kind as SddTurnKind,
    round: row.round === null || row.round === undefined ? null : Number(row.round),
    brief_path: String(row.brief_path),
    brief_text: String(row.brief_text),
    report_path: row.report_path === null || row.report_path === undefined
      ? null
      : String(row.report_path),
    findings_path: row.findings_path === null || row.findings_path === undefined
      ? null
      : String(row.findings_path),
    findings_text: row.findings_text === null || row.findings_text === undefined
      ? null
      : String(row.findings_text),
    report_text: row.report_text === null || row.report_text === undefined
      ? null
      : String(row.report_text),
    resume_sequence: row.resume_sequence === null || row.resume_sequence === undefined
      ? null
      : Number(row.resume_sequence),
    completed_sequence: row.completed_sequence === null || row.completed_sequence === undefined
      ? null
      : Number(row.completed_sequence),
    status: row.status as SddTurnStatus,
    created_at: String(row.created_at),
    completed_at: row.completed_at === null || row.completed_at === undefined
      ? null
      : String(row.completed_at),
  };
}

export function CreateSddStore(logRoot: string, clock: () => Date = () => new Date()): SddStore {
  EnsureOwnerOnlyDirectory(logRoot);
  const databasePath = path.join(logRoot, x_DatabaseFileName);
  if (existsSync(databasePath)) {
    EnsureOwnerOnlyLedgerFiles(databasePath);
  }
  const database = OpenSddLedgerDatabase(databasePath);
  EnsureOwnerOnlyLedgerFiles(databasePath);
  MigrateSchema(database);

  const insertSession = database.prepare(`
    INSERT INTO sdd_sessions (
      agent_id,
      plan_name,
      plan_path,
      cwd,
      task_number,
      agent,
      harness,
      effort,
      role,
      started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTurn = database.prepare(`
    INSERT INTO sdd_turns (
      agent_id,
      turn_number,
      kind,
      round,
      brief_path,
      brief_text,
      report_path,
      findings_path,
      findings_text,
      status,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const selectSession = database.prepare(`
    SELECT
      agent_id,
      plan_name,
      plan_path,
      cwd,
      task_number,
      agent,
      harness,
      effort,
      role,
      started_at,
      closed_at
    FROM sdd_sessions
    WHERE agent_id = ?
  `);

  const selectOpenTurn = database.prepare(`
    SELECT
      id,
      agent_id,
      turn_number,
      kind,
      round,
      brief_path,
      brief_text,
      report_path,
      findings_path,
      findings_text,
      report_text,
      resume_sequence,
      completed_sequence,
      status,
      created_at,
      completed_at
    FROM sdd_turns
    WHERE agent_id = ?
      AND status IN ('prepared', 'running')
    ORDER BY turn_number DESC
    LIMIT 1
  `);

  // The manager's in-process artifact cache does not survive a service
  // restart, but every brief/report path is already durable here. This is how
  // a follow-up recovers them instead of failing sdd_followup_missing_paths.
  //
  const selectLatestTurn = database.prepare(`
    SELECT
      id,
      agent_id,
      turn_number,
      kind,
      round,
      brief_path,
      brief_text,
      report_path,
      findings_path,
      findings_text,
      report_text,
      resume_sequence,
      completed_sequence,
      status,
      created_at,
      completed_at
    FROM sdd_turns
    WHERE agent_id = ?
    ORDER BY turn_number DESC
    LIMIT 1
  `);

  const selectTurnByCompletedSequence = database.prepare(`
    SELECT
      id,
      agent_id,
      turn_number,
      kind,
      round,
      brief_path,
      brief_text,
      report_path,
      findings_path,
      findings_text,
      report_text,
      resume_sequence,
      completed_sequence,
      status,
      created_at,
      completed_at
    FROM sdd_turns
    WHERE agent_id = ?
      AND completed_sequence = ?
      AND status = 'completed'
    ORDER BY turn_number DESC
    LIMIT 1
  `);

  const markRunning = database.prepare(`
    UPDATE sdd_turns
    SET status = 'running',
        resume_sequence = ?
    WHERE agent_id = ?
      AND turn_number = ?
      AND status = 'prepared'
  `);

  const markCompleted = database.prepare(`
    UPDATE sdd_turns
    SET status = 'completed',
        report_text = ?,
        completed_sequence = ?,
        completed_at = ?
    WHERE agent_id = ?
      AND turn_number = ?
      AND status = 'running'
  `);

  const markFailed = database.prepare(`
    UPDATE sdd_turns
    SET status = 'failed',
        completed_at = ?
    WHERE agent_id = ?
      AND turn_number = ?
      AND status IN ('prepared', 'running')
  `);

  const markAbandoned = database.prepare(`
    UPDATE sdd_turns
    SET status = 'abandoned',
        completed_at = ?
    WHERE agent_id = ?
      AND turn_number = ?
      AND status IN ('prepared', 'running')
  `);

  const markClosed = database.prepare(`
    UPDATE sdd_sessions
    SET closed_at = ?
    WHERE agent_id = ?
      AND closed_at IS NULL
  `);

  const abandonOpenTurns = database.prepare(`
    UPDATE sdd_turns
    SET status = 'abandoned',
        completed_at = ?
    WHERE agent_id = ?
      AND status IN ('prepared', 'running')
  `);

  // One-shot repair for ledgers written before close resolved its open turns.
  // Idempotent: it only touches prepared/running turns whose session already
  // has a closed_at.
  //
  const repairClosedSessionTurns = database.prepare(`
    UPDATE sdd_turns
    SET status = 'abandoned',
        completed_at = COALESCE(
          (SELECT closed_at FROM sdd_sessions WHERE sdd_sessions.agent_id = sdd_turns.agent_id),
          completed_at
        )
    WHERE status IN ('prepared', 'running')
      AND agent_id IN (SELECT agent_id FROM sdd_sessions WHERE closed_at IS NOT NULL)
  `);
  repairClosedSessionTurns.run();

  let closed = false;

  function AssertOpen(): void {
    if (closed) {
      throw new SddStoreError("SDD store is closed.");
    }
  }

  function RequireSession(agentId: string): SddSessionRecord {
    const row = selectSession.get(agentId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new SddStoreError(`SDD session not found: ${agentId}`);
    }
    return MapSessionRow(row);
  }

  return {
    ReserveInitial(input: ReserveInitialInput): void {
      AssertOpen();
      const startedAt = clock().toISOString();
      const reserve = database.transaction(() => {
        insertSession.run(
          input.agentId,
          input.planName,
          input.planPath,
          input.cwd,
          input.taskNumber ?? null,
          input.agent,
          input.harness,
          input.effort,
          input.role,
          startedAt,
        );
        insertTurn.run(
          input.agentId,
          1,
          "initial",
          null,
          input.briefPath,
          input.briefText,
          input.reportPath ?? null,
          null,
          null,
          "prepared",
          startedAt,
        );
      });
      reserve();
    },

    PrepareFollowup(input: PrepareFollowupInput): number {
      AssertOpen();
      const session = RequireSession(input.agentId);
      if (session.closed_at !== null) {
        throw new SddStoreError(`SDD session is closed: ${input.agentId}`);
      }
      if (selectOpenTurn.get(input.agentId)) {
        throw new SddStoreError(`SDD session has an open turn: ${input.agentId}`, "open_turn");
      }

      const createdAt = clock().toISOString();
      let turnNumber = 0;
      const prepare = database.transaction(() => {
        const row = database
          .prepare("SELECT COALESCE(MAX(turn_number), 0) AS max_turn FROM sdd_turns WHERE agent_id = ?")
          .get(input.agentId) as { max_turn: number };
        turnNumber = Number(row.max_turn) + 1;
        insertTurn.run(
          input.agentId,
          turnNumber,
          input.kind,
          input.round,
          input.briefPath,
          input.briefText,
          input.reportPath ?? null,
          input.findingsPath ?? null,
          input.findingsText ?? null,
          "prepared",
          createdAt,
        );
      });
      prepare();
      return turnNumber;
    },

    MarkRunning(agentId: string, turnNumber: number, resumeSequence: number): void {
      AssertOpen();
      const result = markRunning.run(resumeSequence, agentId, turnNumber);
      if (result.changes === 0) {
        throw new SddStoreError(
          `Cannot mark turn ${turnNumber} running for ${agentId}: expected prepared turn.`,
        );
      }
    },

    MarkCompleted(
      agentId: string,
      turnNumber: number,
      reportText: string,
      completedSequence: number,
    ): void {
      AssertOpen();
      const completedAt = clock().toISOString();
      const result = markCompleted.run(
        reportText,
        completedSequence,
        completedAt,
        agentId,
        turnNumber,
      );
      if (result.changes === 0) {
        throw new SddStoreError(
          `Cannot mark turn ${turnNumber} completed for ${agentId}: expected running turn.`,
        );
      }
    },

    MarkFailed(agentId: string, turnNumber: number): void {
      AssertOpen();
      const completedAt = clock().toISOString();
      const result = markFailed.run(completedAt, agentId, turnNumber);
      if (result.changes === 0) {
        throw new SddStoreError(
          `Cannot mark turn ${turnNumber} failed for ${agentId}: expected prepared or running turn.`,
        );
      }
    },

    MarkAbandoned(agentId: string, turnNumber: number): void {
      AssertOpen();
      const completedAt = clock().toISOString();
      const result = markAbandoned.run(completedAt, agentId, turnNumber);
      if (result.changes === 0) {
        throw new SddStoreError(
          `Cannot mark turn ${turnNumber} abandoned for ${agentId}: expected prepared or running turn.`,
        );
      }
    },

    MarkClosed(agentId: string, closedAt: string): void {
      AssertOpen();
      // Closing must also resolve any turn still prepared/running. Before this,
      // `abandonOpenTurns` ran only from startup reconciliation and only for
      // failed/cancelled/abandoned phases, so a normal close left the turn row
      // `running` with a null completed_at forever and every ledger reader saw
      // phantom in-flight work.
      //
      const close = database.transaction(() => {
        const result = markClosed.run(closedAt, agentId);
        if (result.changes === 0) {
          throw new SddStoreError(
            `Cannot close SDD session ${agentId}: session missing or already closed.`,
          );
        }
        abandonOpenTurns.run(closedAt, agentId);
      });
      close();
    },

    GetSession(agentId: string): SddSessionRecord | undefined {
      AssertOpen();
      const row = selectSession.get(agentId) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }
      const session = MapSessionRow(row);
      return session;
    },

    GetOpenTurn(agentId: string): SddTurnRecord | undefined {
      AssertOpen();
      const row = selectOpenTurn.get(agentId) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }
      const turn = MapTurnRow(row);
      return turn;
    },

    GetLatestTurn(agentId: string): SddTurnRecord | undefined {
      AssertOpen();
      const row = selectLatestTurn.get(agentId) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }
      return MapTurnRow(row);
    },

    GetTurnByCompletedSequence(
      agentId: string,
      completedSequence: number,
    ): SddTurnRecord | undefined {
      AssertOpen();
      const row = selectTurnByCompletedSequence.get(agentId, completedSequence) as
        | Record<string, unknown>
        | undefined;
      if (!row) {
        return undefined;
      }
      return MapTurnRow(row);
    },

    IsSddAgent(agentId: string): boolean {
      AssertOpen();
      return selectSession.get(agentId) !== undefined;
    },

    ReconcileTerminalRuns(phases: ReadonlyMap<string, string>): void {
      AssertOpen();
      const completedAt = clock().toISOString();
      const reconcile = database.transaction(() => {
        for (const [agentId, phase] of phases) {
          if (!x_TerminalPhases.has(phase)) {
            continue;
          }
          abandonOpenTurns.run(completedAt, agentId);
        }
      });
      reconcile();
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
