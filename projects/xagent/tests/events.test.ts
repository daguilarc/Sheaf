import assert from "node:assert/strict";
import test from "node:test";

import { EventSequencer } from "../src/events.js";

test("stamps events with stable envelope fields", () => {
  const fixedDate = new Date("2026-06-21T12:34:56.789Z");
  const sequencer = new EventSequencer("xrun_test", () => fixedDate);

  const first = sequencer.stamp({ type: "session.ready", can_accept_input: true });
  const second = sequencer.stamp({
    type: "status",
    level: "info",
    message: "ready",
  });

  assert.equal(first.schema_version, 1);
  assert.equal(second.schema_version, 1);
  assert.equal(first.run_id, "xrun_test");
  assert.equal(second.run_id, "xrun_test");
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.equal(first.timestamp, "2026-06-21T12:34:56.789Z");
  assert.equal(second.timestamp, "2026-06-21T12:34:56.789Z");
});
