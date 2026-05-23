import type Database from "better-sqlite3";

import type { EventDirection, EventRow, PersistEventInput, RealtimeEvent } from "../types.js";

import type { RealtimeAgentDb } from "./db.js";

const x_inputAudioBufferAppendType = "input_audio_buffer.append";

interface EventRowRecord
{
  id: number;
  session_id: string;
  created_at: string;
  direction: EventDirection;
  event_type: string;
  event_json: string;
  is_audio_buffer_append: number;
}

function MapEventRow(record: EventRowRecord): EventRow
{
  return {
    id: record.id,
    sessionId: record.session_id,
    createdAt: record.created_at,
    direction: record.direction,
    eventType: record.event_type,
    eventJson: record.event_json,
    isAudioBufferAppend: record.is_audio_buffer_append !== 0,
  };
}

export function shouldPersistOutgoingEvent(event: RealtimeEvent): boolean
{
  return event.type !== x_inputAudioBufferAppendType;
}

export class EventsRepo
{
  private m_connection: Database.Database;

  constructor(database: RealtimeAgentDb)
  {
    this.m_connection = database.getConnection();
  }

  shouldPersistOutgoingEvent(event: RealtimeEvent): boolean
  {
    return event.type !== x_inputAudioBufferAppendType;
  }

  persistIncomingEvent(sessionId: string, event: RealtimeEvent): EventRow
  {
    const persisted = this.persistEvent({
      sessionId,
      direction: "incoming",
      event,
    });

    if (persisted === null)
    {
      throw new Error(`Failed to persist incoming event ${event.type}`);
    }

    return persisted;
  }

  persistEvent(input: PersistEventInput): EventRow | null
  {
    if (input.direction === "outgoing" && !shouldPersistOutgoingEvent(input.event))
    {
      return null;
    }

    const createdAt = new Date().toISOString();
    const isAudioBufferAppend =
      input.event.type === x_inputAudioBufferAppendType ? 1 : 0;

    const result = this.m_connection
      .prepare(
        `INSERT INTO events (
          session_id,
          created_at,
          direction,
          event_type,
          event_json,
          is_audio_buffer_append
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId,
        createdAt,
        input.direction,
        input.event.type,
        JSON.stringify(input.event),
        isAudioBufferAppend,
      );

    const record = this.m_connection
      .prepare(
        `SELECT
          id,
          session_id,
          created_at,
          direction,
          event_type,
          event_json,
          is_audio_buffer_append
        FROM events
        WHERE id = ?`,
      )
      .get(result.lastInsertRowid) as EventRowRecord;

    return MapEventRow(record);
  }

  listEvents(sessionId: string): EventRow[]
  {
    const records = this.m_connection
      .prepare(
        `SELECT
          id,
          session_id,
          created_at,
          direction,
          event_type,
          event_json,
          is_audio_buffer_append
        FROM events
        WHERE session_id = ?
        ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId) as EventRowRecord[];

    return records.map(MapEventRow);
  }
}
