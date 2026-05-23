import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import type { DatabaseConfig } from "../types.js";

const x_packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const DEFAULT_DATABASE_PATH = path.join(
  x_packageRoot,
  "data",
  "realtime-agent.sqlite",
);

const x_sessionsTableSql = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT,
  system_prompt TEXT NOT NULL,
  initial_context TEXT NOT NULL,
  tool_call_set_name TEXT,
  tool_names_json TEXT NOT NULL,
  model TEXT NOT NULL,
  session_config_json TEXT NOT NULL
)`;

const x_eventsTableSql = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  direction TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  is_audio_buffer_append INTEGER NOT NULL DEFAULT 0
)`;

const x_eventsSessionCreatedAtIndexSql = `
CREATE INDEX IF NOT EXISTS idx_events_session_created_at
ON events(session_id, created_at)`;

const x_eventsEventTypeIndexSql = `
CREATE INDEX IF NOT EXISTS idx_events_event_type
ON events(event_type)`;

export function resolveDatabasePath(config?: DatabaseConfig): string
{
  return config?.path ?? DEFAULT_DATABASE_PATH;
}

export function runMigrations(connection: Database.Database): void
{
  connection.exec(x_sessionsTableSql);
  connection.exec(x_eventsTableSql);
  connection.exec(x_eventsSessionCreatedAtIndexSql);
  connection.exec(x_eventsEventTypeIndexSql);
}

export class RealtimeAgentDb
{
  private m_connection: Database.Database;

  private constructor(connection: Database.Database)
  {
    this.m_connection = connection;
    runMigrations(this.m_connection);
  }

  static open(config?: DatabaseConfig): RealtimeAgentDb
  {
    const databasePath = resolveDatabasePath(config);
    const ensureDirectory = config?.ensureDirectory ?? true;

    if (ensureDirectory)
    {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    const connection = new Database(databasePath);
    return new RealtimeAgentDb(connection);
  }

  getConnection(): Database.Database
  {
    return this.m_connection;
  }

  close(): void
  {
    this.m_connection.close();
  }
}
