import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { AdapterEvent, AdapterTurnContext } from "../src/adapters/types.js";
import { assertCommandAvailable, ProcessJsonlSession, type ProcessHarnessState } from "../src/adapters/process_jsonl.js";
import { parseClaudeProviderEvent } from "../src/adapters/claude_code.js";
import { parseCodexProviderEvent } from "../src/adapters/codex.js";
import { parseCursorProviderEvent } from "../src/adapters/cursor.js";
import { createAdapter } from "../src/adapters/index.js";
import { parsePiProviderEvent } from "../src/adapters/pi.js";

const context: AdapterTurnContext = {
  text: "run tests",
  turnId: "turn_1",
  inputSequence: 1,
};

test("codex fixture maps provider events into normalized adapter events", async () => {
  const events = await parseFixture("codex.jsonl", parseCodexProviderEvent);

  assertEventTypes(events, ["tool.started", "tool.completed", "message.completed", "turn.completed"]);
  assert.equal(events.find((event) => event.type === "message.completed")?.text, "Codex final");
  assert.equal(events.find((event) => event.type === "turn.completed")?.provider_thread_id, "codex-thread-1");
});

test("cursor fixture maps provider events into normalized adapter events", async () => {
  const events = await parseFixture("cursor.jsonl", parseCursorProviderEvent);

  assertEventTypes(events, ["message.delta", "tool.started", "message.completed", "turn.completed"]);
  assert.equal(events.find((event) => event.type === "message.completed")?.text, "Cursor final");
  assert.equal(events.find((event) => event.type === "turn.completed")?.provider_thread_id, "cursor-thread-1");
});

test("claude code fixture maps provider events into normalized adapter events", async () => {
  const events = await parseFixture("claude_code.jsonl", parseClaudeProviderEvent);

  assertEventTypes(events, ["message.delta", "tool.started", "tool.completed", "message.completed", "turn.completed"]);
  assert.equal(events.find((event) => event.type === "message.completed")?.text, "Claude final");
  assert.equal(events.find((event) => event.type === "turn.completed")?.provider_thread_id, "claude-thread-1");
});

test("pi fixture maps provider events into normalized adapter events", async () => {
  const events = await parseFixture("pi.jsonl", parsePiProviderEvent);

  assertEventTypes(events, ["message.delta", "tool.started", "tool.completed", "message.completed", "turn.completed"]);
  assert.equal(events.find((event) => event.type === "message.completed")?.text, "Pi final");
  assert.equal(events.find((event) => event.type === "turn.completed")?.provider_thread_id, "pi-thread-1");
});

test("pi real CLI fixture ignores thinking and empty agent end summaries", async () => {
  const events = await parseFixture("pi-real.jsonl", parsePiProviderEvent);

  assertEventTypes(events, ["message.delta", "message.completed", "turn.completed"]);
  assert.equal(events.find((event) => event.type === "message.delta")?.delta, "XAGENT_HELLO_PI");
  assert.equal(events.find((event) => event.type === "message.completed")?.text, "XAGENT_HELLO_PI");
  assert.equal(events.find((event) => event.type === "turn.completed")?.provider_thread_id, "pi-session-1");
});

test("adapter factory reports capabilities for all supported harnesses", () => {
  assert.deepEqual(createAdapter("codex").capabilities, {
    forwardsModel: true,
    forwardsThinkingLevel: true,
    streamsDeltas: true,
  });
  assert.deepEqual(createAdapter("cursor").capabilities, {
    forwardsModel: true,
    forwardsThinkingLevel: false,
    streamsDeltas: true,
  });
  assert.equal(createAdapter("pi").harness, "pi");
  assert.equal(createAdapter("claude_code").harness, "claude_code");
});

test("process JSONL session preserves non-JSON stdout as raw provider and status events", async () => {
  const session = new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      args: [
        "-e",
        [
          "console.log('plain progress')",
          "console.log(JSON.stringify({ type: 'done', text: 'finished' }))",
        ].join(";"),
      ],
    }),
    parseEvent: (raw) => {
      if (isRecord(raw) && raw.type === "done") {
        return [{ type: "message.completed", message_id: "m1", role: "assistant", text: String(raw.text) }];
      }
      return [];
    },
  });

  const events: AdapterEvent[] = [];
  for await (const event of session.submit(context)) {
    events.push(event);
  }

  assert.equal(events.filter((event) => event.type === "raw.provider").length, 2);
  assert.equal(events.some((event) => event.type === "status" && event.message === "plain progress"), true);
  assert.equal(events.some((event) => event.type === "message.completed" && event.text === "finished"), true);
});

test("process command availability failures are reported as harness unavailable", async () => {
  await assert.rejects(
    () => assertCommandAvailable("definitely-not-a-real-xagent-command", "codex"),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "harness_unavailable",
  );
});

async function parseFixture(
  fixtureName: string,
  parseEvent: (raw: unknown, context: AdapterTurnContext, state: ProcessHarnessState) => AdapterEvent[],
): Promise<AdapterEvent[]> {
  const text = await readFile(path.join("tests", "fixtures", fixtureName), "utf8");
  const state: ProcessHarnessState = { providerSequence: 0 };
  const events: AdapterEvent[] = [];
  for (const line of text.trim().split("\n")) {
    const raw = JSON.parse(line) as unknown;
    state.providerSequence += 1;
    events.push({ type: "raw.provider", harness: "codex", payload: raw, provider_sequence: state.providerSequence });
    events.push(...parseEvent(raw, context, state));
  }
  return events;
}

function assertEventTypes(events: AdapterEvent[], expectedTypes: string[]): void {
  assert.deepEqual(
    events.filter((event) => event.type !== "raw.provider").map((event) => event.type),
    expectedTypes,
  );
  assert.equal(events.some((event) => event.type === "raw.provider"), true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
