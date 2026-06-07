import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DATABASE_PATH,
  RealtimeAgentDb,
  resolveDatabasePath,
} from "../../../src/agent/src/index.js";

import {
  CleanupPersistenceTestContext,
  CreatePersistenceTestContext,
} from "./helpers.js";

test("DEFAULT_DATABASE_PATH points at apps/realtime-agent/data/realtime-agent.sqlite", () =>
{
  assert.match(DEFAULT_DATABASE_PATH, /data[\\/]realtime-agent\.sqlite$/);
});

test("resolveDatabasePath uses configured path when provided", () =>
{
  assert.equal(resolveDatabasePath({ path: "/tmp/custom.sqlite" }), "/tmp/custom.sqlite");
  assert.equal(resolveDatabasePath(), DEFAULT_DATABASE_PATH);
});

test("opening the database twice is idempotent", () =>
{
  const context = CreatePersistenceTestContext();

  try
  {
    const reopened = RealtimeAgentDb.open({
      path: context.databasePath,
      ensureDirectory: false,
    });

    reopened.close();
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});

test("schema defines expected sessions and events columns and indexes", () =>
{
  const context = CreatePersistenceTestContext();

  try
  {
    const connection = context.database.getConnection();

    const sessionColumns = connection
      .prepare("PRAGMA table_info(sessions)")
      .all() as Array<{ name: string }>;
    assert.deepEqual(
      sessionColumns.map((column) => column.name),
      [
        "id",
        "created_at",
        "ended_at",
        "ended_reason",
        "system_prompt",
        "initial_context",
        "tool_call_set_name",
        "tool_names_json",
        "model",
        "session_config_json",
      ],
    );

    const eventColumns = connection
      .prepare("PRAGMA table_info(events)")
      .all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
    assert.deepEqual(
      eventColumns.map((column) => column.name),
      [
        "id",
        "session_id",
        "created_at",
        "direction",
        "event_type",
        "event_json",
        "is_audio_buffer_append",
      ],
    );

    const audioAppendColumn = eventColumns.find(
      (column) => column.name === "is_audio_buffer_append",
    );
    assert.ok(audioAppendColumn !== undefined);
    assert.equal(audioAppendColumn.notnull, 1);
    assert.equal(audioAppendColumn.dflt_value, "0");

    const indexes = connection
      .prepare("PRAGMA index_list(events)")
      .all() as Array<{ name: string }>;
    const indexNames = indexes.map((index) => index.name);

    assert.ok(indexNames.includes("idx_events_session_created_at"));
    assert.ok(indexNames.includes("idx_events_event_type"));
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});
