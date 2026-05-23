import assert from "node:assert/strict";
import test from "node:test";

import { buildSessionUpdateEvent } from "../../src/index.js";

test("buildSessionUpdateEvent configures text-only realtime session with VAD and tools", () =>
{
  const event = buildSessionUpdateEvent({
    name: "demo",
    tools: [
      {
        name: "echo",
        description: "Echo input",
        inputSchema: {
          type: "object",
          properties: {
            value: { type: "string" },
          },
        },
        callback: () => ({ ok: true }),
      },
    ],
  });

  assert.equal(event.type, "session.update");

  const session = event.session as Record<string, unknown>;
  assert.equal(session.type, "realtime");
  assert.deepEqual(session.output_modalities, ["text"]);

  const audio = session.audio as Record<string, unknown>;
  const input = audio.input as Record<string, unknown>;
  const format = input.format as Record<string, unknown>;
  assert.equal(format.type, "audio/pcm");
  assert.equal(format.rate, 24000);

  const transcription = input.transcription as Record<string, unknown>;
  assert.ok(transcription.model);

  const turnDetection = input.turn_detection as Record<string, unknown>;
  assert.equal(turnDetection.type, "server_vad");
  assert.equal(turnDetection.silence_duration_ms, 500);
  assert.equal(turnDetection.create_response, true);
  assert.equal(turnDetection.interrupt_response, true);

  assert.equal(audio.output, undefined);

  const tools = session.tools as Array<Record<string, unknown>>;
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.type, "function");
  assert.equal(tools[0]?.name, "echo");
  assert.equal(tools[0]?.description, "Echo input");
  assert.deepEqual(tools[0]?.parameters, {
    type: "object",
    properties: {
      value: { type: "string" },
    },
  });
});
