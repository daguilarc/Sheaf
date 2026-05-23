import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_REALTIME_MODEL } from "../../src/index.js";

import {
  CleanupPersistenceTestContext,
  CreatePersistenceTestContext,
} from "./helpers.js";

test("sessions repository inserts, ends, and reads JSON fields", () =>
{
  const context = CreatePersistenceTestContext();

  try
  {
    const created = context.sessions.createSession({
      systemPrompt: "You are helpful.",
      initialContext: "Initial operator context.",
      toolCallSetName: "demo",
      toolNames: ["echo", "lookup"],
      model: DEFAULT_REALTIME_MODEL,
      sessionConfig: { vad: { pauseMs: 500 } },
    });

    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.equal(created.endedAt, null);
    assert.equal(created.endedReason, null);
    assert.equal(created.systemPrompt, "You are helpful.");
    assert.equal(created.initialContext, "Initial operator context.");
    assert.equal(created.toolCallSetName, "demo");
    assert.deepEqual(JSON.parse(created.toolNamesJson), ["echo", "lookup"]);
    assert.equal(created.model, DEFAULT_REALTIME_MODEL);
    assert.deepEqual(JSON.parse(created.sessionConfigJson), { vad: { pauseMs: 500 } });

    const ended = context.sessions.endSession(created.id, "operator_stop");
    assert.ok(ended.endedAt !== null);
    assert.equal(ended.endedReason, "operator_stop");

    const loaded = context.sessions.getSession(created.id);
    assert.deepEqual(loaded, ended);
  }
  finally
  {
    CleanupPersistenceTestContext(context);
  }
});
