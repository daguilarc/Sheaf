import assert from "node:assert/strict";
import test from "node:test";

import {
  logEventLine,
  ShouldLogEvent,
} from "../../../src/agent/src/stdout_logger.js";

test("ShouldLogEvent skips input_audio_buffer.append", () =>
{
  assert.equal(
    ShouldLogEvent({ type: "input_audio_buffer.append", audio: "abc" }),
    false,
  );
  assert.equal(ShouldLogEvent({ type: "session.created" }), true);
});

test("logEventLine prints structured JSON with session id and event type", () =>
{
  const lines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: string | Uint8Array) =>
  {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  try
  {
    logEventLine({
      sessionId: "sess-1",
      direction: "incoming",
      event: { type: "session.created", session: { id: "sess-1" } },
    });
  }
  finally
  {
    process.stdout.write = originalWrite;
  }

  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]!) as {
    session_id: string;
    direction: string;
    event_type: string;
    event: { type: string };
  };

  assert.equal(parsed.session_id, "sess-1");
  assert.equal(parsed.direction, "incoming");
  assert.equal(parsed.event_type, "session.created");
  assert.equal(parsed.event.type, "session.created");
});

test("logEventLine does not print input_audio_buffer.append", () =>
{
  const lines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((chunk: string | Uint8Array) =>
  {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;

  try
  {
    logEventLine({
      sessionId: "sess-1",
      direction: "outgoing",
      event: { type: "input_audio_buffer.append", audio: "AAAA" },
    });
  }
  finally
  {
    process.stdout.write = originalWrite;
  }

  assert.equal(lines.length, 0);
});
