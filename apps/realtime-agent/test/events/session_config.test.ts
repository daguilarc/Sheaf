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

test("buildSessionUpdateEvent sets turn_detection to null for manual turn mode", () =>
{
  const event = buildSessionUpdateEvent(
    {
      tools: [
        {
          name: "echo",
          inputSchema: {},
          callback: () => ({}),
        },
      ],
    },
    { type: "manual" },
  );

  const session = event.session as Record<string, unknown>;
  const audio = session.audio as Record<string, unknown>;
  const input = audio.input as Record<string, unknown>;
  assert.equal(input.turn_detection, null);
});

test("buildSessionUpdateEvent applies custom server_vad turn fields", () =>
{
  const event = buildSessionUpdateEvent(
    {
      tools: [
        {
          name: "echo",
          inputSchema: {},
          callback: () => ({}),
        },
      ],
    },
    {
      type: "server_vad",
      silenceDurationMs: 800,
      threshold: 0.42,
      prefixPaddingMs: 120,
      createResponse: false,
      interruptResponse: false,
    },
  );

  const session = event.session as Record<string, unknown>;
  const audio = session.audio as Record<string, unknown>;
  const input = audio.input as Record<string, unknown>;
  const turnDetection = input.turn_detection as Record<string, unknown>;

  assert.equal(turnDetection.type, "server_vad");
  assert.equal(turnDetection.silence_duration_ms, 800);
  assert.equal(turnDetection.threshold, 0.42);
  assert.equal(turnDetection.prefix_padding_ms, 120);
  assert.equal(turnDetection.create_response, false);
  assert.equal(turnDetection.interrupt_response, false);
});
