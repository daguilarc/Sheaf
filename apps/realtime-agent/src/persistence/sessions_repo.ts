import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { CreateSessionInput, SessionRow } from "../types.js";

import type { RealtimeAgentDb } from "./db.js";

interface SessionRowRecord
{
  id: string;
  created_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  system_prompt: string;
  initial_context: string;
  tool_call_set_name: string | null;
  tool_names_json: string;
  model: string;
  session_config_json: string;
}

function MapSessionRow(record: SessionRowRecord): SessionRow
{
  return {
    id: record.id,
    createdAt: record.created_at,
    endedAt: record.ended_at,
    endedReason: record.ended_reason,
    systemPrompt: record.system_prompt,
    initialContext: record.initial_context,
    toolCallSetName: record.tool_call_set_name,
    toolNamesJson: record.tool_names_json,
    model: record.model,
    sessionConfigJson: record.session_config_json,
  };
}

export class SessionsRepo
{
  private m_connection: Database.Database;

  constructor(database: RealtimeAgentDb)
  {
    this.m_connection = database.getConnection();
  }

  createSession(input: CreateSessionInput): SessionRow
  {
    const sessionId = randomUUID();
    const createdAt = new Date().toISOString();
    const toolNamesJson = JSON.stringify(input.toolNames);
    const sessionConfigJson = JSON.stringify(input.sessionConfig);

    this.m_connection
      .prepare(
        `INSERT INTO sessions (
          id,
          created_at,
          system_prompt,
          initial_context,
          tool_call_set_name,
          tool_names_json,
          model,
          session_config_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionId,
        createdAt,
        input.systemPrompt,
        input.initialContext,
        input.toolCallSetName ?? null,
        toolNamesJson,
        input.model,
        sessionConfigJson,
      );

    const session = this.getSession(sessionId);

    if (session === null)
    {
      throw new Error(`Failed to create session ${sessionId}`);
    }

    return session;
  }

  endSession(sessionId: string, endedReason: string): SessionRow
  {
    const endedAt = new Date().toISOString();

    const result = this.m_connection
      .prepare(
        `UPDATE sessions
        SET ended_at = ?, ended_reason = ?
        WHERE id = ?`,
      )
      .run(endedAt, endedReason, sessionId);

    if (result.changes === 0)
    {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const session = this.getSession(sessionId);

    if (session === null)
    {
      throw new Error(`Failed to load ended session ${sessionId}`);
    }

    return session;
  }

  getSession(sessionId: string): SessionRow | null
  {
    const record = this.m_connection
      .prepare(
        `SELECT
          id,
          created_at,
          ended_at,
          ended_reason,
          system_prompt,
          initial_context,
          tool_call_set_name,
          tool_names_json,
          model,
          session_config_json
        FROM sessions
        WHERE id = ?`,
      )
      .get(sessionId) as SessionRowRecord | undefined;

    if (record === undefined)
    {
      return null;
    }

    return MapSessionRow(record);
  }
}
