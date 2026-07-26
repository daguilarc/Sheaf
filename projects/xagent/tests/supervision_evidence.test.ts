import assert from "node:assert/strict";
import test from "node:test";

import { FakeHarnessAdapter } from "../src/adapters/fake.js";
import { SemanticEvidenceWindow } from "../src/supervision/evidence.js";
import { Supervisor } from "../src/supervision/supervisor.js";

const repoRoot = "/private/tmp/sheaf-xagent-supervision";

test("evidence sanitizes paths and secrets before stable tool and failure fingerprinting", () => {
  const clock = new MutableClock();
  const evidence = new SemanticEvidenceWindow({
    repoRoot,
    originalPrompt: `Inspect ${repoRoot}/projects/xagent with api_key=prompt-secret`,
    clock: clock.now,
  });

  for (let index = 0; index < 3; index += 1) {
    evidence.record({
      type: "tool.started",
      name: "shell",
      tool_call_id: `tool-${index}`,
      input: index % 2 === 0
        ? { cwd: `${repoRoot}/projects/xagent`, api_key: "tool-secret", cmd: "npm test" }
        : { cmd: "npm test", api_key: "different-secret", cwd: `${repoRoot}/projects/xagent` },
    });
    clock.advance(60_000);
  }
  for (let index = 0; index < 2; index += 1) {
    evidence.record({
      type: "tool.completed",
      name: "shell",
      tool_call_id: `failure-${index}`,
      status: "failed",
      error: `Command failed in ${repoRoot}/projects/xagent api_key=failure-secret`,
    });
    clock.advance(60_000);
  }

  const snapshot = evidence.snapshot();
  assert.equal(
    snapshot.original_prompt,
    "Inspect ./projects/xagent with api_key=[REDACTED]",
  );
  assert.equal(snapshot.recent_events.some((event) =>
    JSON.stringify(event).includes(repoRoot)), false);
  assert.equal(JSON.stringify(snapshot).includes("prompt-secret"), false);
  assert.equal(JSON.stringify(snapshot).includes("tool-secret"), false);
  assert.equal(JSON.stringify(snapshot).includes("different-secret"), false);
  assert.equal(JSON.stringify(snapshot).includes("failure-secret"), false);
  assert.deepEqual(snapshot.tool_fingerprints, [{
    fingerprint: "d883966ef88abae73e3496301128a871f94abe9db9db7dfc390a08fa37fa5093",
    count: 3,
  }]);
  assert.deepEqual(snapshot.failure_fingerprints, [{
    fingerprint: "c1bc1eae547e7acd3f6ef73db9f6a1340259dc39d306f81c619dec45b08a3c7e",
    count: 2,
  }]);
  assert.deepEqual(snapshot.suspicion_signals, [
    "repeated_tool_fingerprint",
    "repeated_failure_fingerprint",
  ]);
});

test("fingerprint suspicion uses a rolling ten-minute window", () => {
  const clock = new MutableClock();
  const evidence = new SemanticEvidenceWindow({
    repoRoot,
    originalPrompt: "Run the test.",
    clock: clock.now,
  });
  for (let index = 0; index < 3; index += 1) {
    evidence.record({
      type: "tool.started",
      name: "shell",
      tool_call_id: `old-${index}`,
      input: { cmd: "npm test" },
    });
  }
  assert.deepEqual(evidence.snapshot().suspicion_signals, ["repeated_tool_fingerprint"]);

  clock.advance(600_001);

  assert.deepEqual(evidence.snapshot().tool_fingerprints, []);
  assert.deepEqual(evidence.snapshot().suspicion_signals, []);
});

test("snapshot is capped at 64 KiB of valid UTF-8 and reports deterministic truncation", () => {
  const evidence = new SemanticEvidenceWindow({
    repoRoot,
    originalPrompt: `Begin ${"🧶".repeat(40_000)} end`,
  });
  evidence.record({
    type: "message.completed",
    role: "assistant",
    message_id: "message-large",
    text: "progress ".repeat(20_000),
  });

  const snapshot = evidence.snapshot();
  assert.equal(snapshot.truncated, true);
  assert.ok(snapshot.input_bytes <= 64 * 1024);
  assert.equal(Buffer.byteLength(JSON.stringify(snapshot.input), "utf8"), snapshot.input_bytes);
  assert.equal(JSON.stringify(snapshot.input).includes("\uFFFD"), false);
});

test("compact fingerprint counters cannot push the evidence snapshot over its byte cap", () => {
  const evidence = new SemanticEvidenceWindow({
    repoRoot,
    originalPrompt: "Diagnose distinct failures without retaining raw payloads.",
  });
  for (let index = 0; index < 600; index += 1) {
    evidence.record({
      type: "tool.started",
      name: "shell",
      tool_call_id: `tool-${index}`,
      input: { cmd: `command-${index}` },
    });
    evidence.record({
      type: "tool.completed",
      name: "shell",
      tool_call_id: `tool-${index}`,
      status: "failed",
      error: `failure-${index}`,
    });
  }

  const snapshot = evidence.snapshot();
  assert.ok(snapshot.input_bytes <= 64 * 1024);
  assert.equal(snapshot.truncated, true);
});

test("only normalized semantic events enter evidence while all provider activity remains external", () => {
  const evidence = new SemanticEvidenceWindow({
    repoRoot,
    originalPrompt: "Implement the task.",
    previousVerdict: {
      verdict: "healthy",
      confidence: 0.91,
      reason_code: "steady_progress",
    },
  });

  evidence.record({
    type: "raw.provider",
    harness: "codex",
    payload: { unrestricted: "provider wire payload" },
  });
  evidence.record({
    type: "status",
    level: "info",
    message: "provider heartbeat",
  });
  evidence.record({
    type: "message.delta",
    role: "assistant",
    message_id: "message-one",
    delta: "working",
  });

  const snapshot = evidence.snapshot();
  assert.deepEqual(snapshot.recent_events, [{
    type: "message.delta",
    role: "assistant",
    delta: "working",
  }]);
  assert.deepEqual(snapshot.previous_verdict, {
    verdict: "healthy",
    confidence: 0.91,
    reason_code: "steady_progress",
  });
  assert.equal(JSON.stringify(snapshot).includes("provider wire payload"), false);
});

test("supervisor exposes bounded evidence using per-run policy and provider events", async () => {
  const adapter = new FakeHarnessAdapter({
    scriptedEvents: [[
      {
        type: "raw.provider",
        harness: "codex",
        payload: { raw: "not evidence" },
      },
      {
        type: "tool.started",
        name: "shell",
        tool_call_id: "tool-one",
        input: { cmd: "npm test", api_key: "secret" },
      },
      {
        type: "message.completed",
        role: "assistant",
        message_id: "message-one",
        text: `Checked ${repoRoot}/projects/xagent`,
      },
      {
        type: "turn.completed",
        final_text: "complete",
      },
    ]],
  });
  const supervisor = new Supervisor({
    runId: "xrun_evidence_integration",
    adapter,
    startOptions: { cwd: repoRoot },
    policy: {
      silenceTimeoutMs: 300_000,
      watchdog: {
        inputLimitBytes: 1_024,
        suspicionWindowMs: 120_000,
        repeatedToolThreshold: 2,
        repeatedFailureThreshold: 2,
      },
    },
  });
  await supervisor.start();
  await supervisor.submit(`Inspect ${repoRoot} api_key=prompt-secret`);

  const snapshot = supervisor.evidenceSnapshot();
  assert.ok(snapshot !== undefined);
  assert.ok(snapshot.input_bytes <= 1_024);
  assert.equal(JSON.stringify(snapshot).includes(repoRoot), false);
  assert.equal(JSON.stringify(snapshot).includes("prompt-secret"), false);
  assert.equal(JSON.stringify(snapshot).includes("not evidence"), false);
  assert.equal(snapshot.recent_events.length, 2);
});

class MutableClock {
  #milliseconds = Date.parse("2026-07-25T12:00:00.000Z");
  readonly now = (): Date => new Date(this.#milliseconds);

  advance(durationMs: number): void {
    this.#milliseconds += durationMs;
  }
}
