import assert from "node:assert/strict";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import {
  ProviderJsonEvidenceWindow,
  type ProviderJsonEvidenceSnapshot,
} from "../src/supervision/evidence.js";
import { Supervisor } from "../src/supervision/supervisor.js";

const repoRoot = "/private/tmp/sheaf-xagent-supervision";
const maxInputBytes = 64 * 1024;
const maxStringBytes = 16 * 1024;
const truncationMarker = "[xagent: truncated]";

test("provider JSON reaches evidence without normalization, redaction, path rewriting, or hashing", () => {
  const evidence = new ProviderJsonEvidenceWindow({
    harness: "claude_code",
    originalPrompt: `Inspect ${repoRoot} api_key=prompt-secret`,
  });
  const providerRecord = {
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        name: "Bash",
        input: {
          command: "npm test",
          cwd: repoRoot,
          api_key: "tool-secret",
        },
      }, {
        type: "tool_result",
        content: `failed in ${repoRoot}`,
      }],
    },
  };

  evidence.record(providerRecord);
  const snapshot = evidence.snapshot();

  assert.equal(snapshot.original_prompt, `Inspect ${repoRoot} api_key=prompt-secret`);
  assert.equal(snapshot.harness, "claude_code");
  assert.deepEqual(snapshot.recent_provider_json, [providerRecord]);
  assert.equal("tool_fingerprints" in snapshot, false);
  assert.equal("failure_fingerprints" in snapshot, false);
  assert.equal("suspicion_signals" in snapshot, false);
  assert.equal("previous_verdict" in snapshot, false);
  assert.equal(Buffer.byteLength(JSON.stringify(snapshot), "utf8"), snapshot.input_bytes);
});

test("nested object and array strings are individually truncated at 16 KiB without corrupting UTF-8", () => {
  const evidence = new ProviderJsonEvidenceWindow({
    harness: "claude_code",
    originalPrompt: "Inspect nested provider JSON.",
  });
  evidence.record({
    outer: {
      text: `before ${"🧶".repeat(10_000)} after`,
      nested: [{
        content: `array ${"測".repeat(10_000)} value`,
      }],
    },
  });

  const snapshot = evidence.snapshot();
  const retained = snapshot.recent_provider_json[0] as {
    readonly outer: {
      readonly text: string;
      readonly nested: readonly [{ readonly content: string }];
    };
  };

  assert.equal(snapshot.truncated, true);
  assert.ok(Buffer.byteLength(retained.outer.text, "utf8") <= maxStringBytes);
  assert.ok(Buffer.byteLength(retained.outer.nested[0].content, "utf8") <= maxStringBytes);
  assert.equal(retained.outer.text.endsWith(truncationMarker), true);
  assert.equal(retained.outer.nested[0].content.endsWith(truncationMarker), true);
  assert.equal("outer" in retained, true);
  assert.equal("nested" in retained.outer, true);
  assert.equal(JSON.stringify(snapshot).includes("\uFFFD"), false);
});

test("an oversized record is omitted whole and does not prevent later fitting records", () => {
  const evidence = new ProviderJsonEvidenceWindow({
    harness: "claude_code",
    originalPrompt: "Capture provider records.",
  });
  const oversized: Record<string, string> = {};
  for (let index = 0; index < 6_000; index += 1) {
    oversized[`field_${index}`] = `value_${index}`;
  }
  const later = { type: "assistant", message: { content: "later fitting record" } };

  evidence.record(oversized);
  evidence.record(later);
  const snapshot = evidence.snapshot();

  assert.equal(snapshot.truncated, true);
  assert.deepEqual(snapshot.recent_provider_json, [later]);
  assert.equal(JSON.stringify(snapshot).includes("field_5999"), false);
});

test("byte pressure evicts oldest complete records and keeps newest complete records", () => {
  const evidence = new ProviderJsonEvidenceWindow({
    harness: "claude_code",
    originalPrompt: "Retain newest provider records.",
    maxInputBytes: 1_200,
  });
  const records = Array.from({ length: 10 }, (_item, index) => ({
    type: "assistant",
    index,
    content: `${index}:${"x".repeat(180)}`,
  }));

  for (const record of records) {
    evidence.record(record);
  }
  const snapshot = evidence.snapshot();

  assert.equal(snapshot.truncated, true);
  assert.ok(snapshot.recent_provider_json.length > 0);
  assert.ok(snapshot.recent_provider_json.length < records.length);
  assert.deepEqual(
    snapshot.recent_provider_json,
    records.slice(records.length - snapshot.recent_provider_json.length),
  );
});

test("a maximal snapshot reports exact self-referential input bytes within the 64 KiB cap", () => {
  const evidence = new ProviderJsonEvidenceWindow({
    harness: "claude_code",
    originalPrompt: "Retain as much provider JSON as possible.",
  });
  for (let index = 0; index < 100; index += 1) {
    evidence.record({
      type: "assistant",
      index,
      content: `${index}:${"progress ".repeat(80)}`,
    });
  }

  const snapshot = evidence.snapshot();

  assert.equal(snapshot.input_bytes, Buffer.byteLength(JSON.stringify(snapshot), "utf8"));
  assert.ok(snapshot.input_bytes <= maxInputBytes);
  assert.equal(snapshot.truncated, true);
});

test("the original prompt keeps secrets and absolute paths subject only to string and total limits", () => {
  const secretPrompt = `Inspect ${repoRoot}/projects/xagent api_key=prompt-secret `;
  const evidence = new ProviderJsonEvidenceWindow({
    harness: "claude_code",
    originalPrompt: `${secretPrompt}${"🧶".repeat(40_000)}`,
  });

  const snapshot = evidence.snapshot();

  assert.equal(snapshot.original_prompt.includes(repoRoot), true);
  assert.equal(snapshot.original_prompt.includes("api_key=prompt-secret"), true);
  assert.equal(snapshot.original_prompt.endsWith(truncationMarker), true);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.input_bytes, Buffer.byteLength(JSON.stringify(snapshot), "utf8"));
  assert.ok(snapshot.input_bytes <= maxInputBytes);
  assert.equal(JSON.stringify(snapshot).includes("\uFFFD"), false);
});

test("supervisor evidence records only raw provider payloads, not normalized events or rawProvider side channels", async () => {
  const rawPayload = {
    type: "assistant",
    message: {
      content: [{
        type: "input_json_delta",
        partial_json: `{"cwd":"${repoRoot}","api_key":"provider-secret"}`,
      }],
    },
  };
  const duplicateSideChannel = { duplicate: "must not enter evidence" };
  const adapter = new ClaudeFakeHarnessAdapter({
    scriptedEvents: [[
      {
        type: "message.delta",
        role: "assistant",
        message_id: "message-one",
        delta: "normalized semantic event",
        rawProvider: duplicateSideChannel,
      },
      {
        type: "raw.provider",
        harness: "claude_code",
        payload: rawPayload,
      },
      {
        type: "tool.completed",
        name: "Bash",
        tool_call_id: "tool-one",
        status: "completed",
        output: "normalized tool output",
      },
      {
        type: "turn.completed",
        final_text: "complete",
      },
    ]],
  });
  const supervisor = new Supervisor({
    runId: "xrun_provider_json_evidence_integration",
    adapter,
    startOptions: { cwd: repoRoot },
    policy: {
      silenceTimeoutMs: 300_000,
      watchdog: { inputLimitBytes: 1_024 },
    },
  });

  await supervisor.start();
  await supervisor.submit(`Inspect ${repoRoot} api_key=prompt-secret`);

  const snapshot = supervisor.evidenceSnapshot();
  assert.ok(snapshot !== undefined);
  assert.deepEqual(snapshot.recent_provider_json, [rawPayload]);
  assert.equal(snapshot.original_prompt, `Inspect ${repoRoot} api_key=prompt-secret`);
  assert.equal(snapshot.harness, "claude_code");
  assert.equal(JSON.stringify(snapshot).includes("normalized semantic event"), false);
  assert.equal(JSON.stringify(snapshot).includes("normalized tool output"), false);
  assert.equal(JSON.stringify(snapshot).includes("must not enter evidence"), false);
  assert.equal(JSON.stringify(snapshot).includes("provider-secret"), true);
  assert.equal(snapshot.input_bytes, Buffer.byteLength(JSON.stringify(snapshot), "utf8"));
});

test("a small configured cap still produces a valid bounded snapshot", () => {
  const evidence = new ProviderJsonEvidenceWindow({
    harness: "claude_code",
    originalPrompt: "small cap prompt",
    maxInputBytes: 512,
  });
  evidence.record({ type: "assistant", content: "x".repeat(400) });
  evidence.record({ type: "assistant", content: "latest" });

  const snapshot = evidence.snapshot();

  assert.ok(snapshot.input_bytes <= 512);
  assert.equal(snapshot.input_bytes, Buffer.byteLength(JSON.stringify(snapshot), "utf8"));
  assert.deepEqual(snapshot.recent_provider_json, [{ type: "assistant", content: "latest" }]);
});

function assertSnapshotShape(snapshot: ProviderJsonEvidenceSnapshot): void {
  assert.deepEqual(Object.keys(snapshot), [
    "original_prompt",
    "harness",
    "recent_provider_json",
    "elapsed_ms",
    "truncated",
    "input_bytes",
  ]);
}

test("snapshot exposes exactly the provider JSON watchdog request fields", () => {
  const evidence = new ProviderJsonEvidenceWindow({
    harness: "claude_code",
    originalPrompt: "Implement the task.",
  });

  assertSnapshotShape(evidence.snapshot());
});

class MutableClock {
  #milliseconds = Date.parse("2026-07-25T12:00:00.000Z");
  readonly now = (): Date => new Date(this.#milliseconds);

  advance(durationMs: number): void {
    this.#milliseconds += durationMs;
  }
}

class ClaudeFakeHarnessAdapter extends FakeHarnessAdapter {
  override readonly harness = "claude_code" as const;
}
