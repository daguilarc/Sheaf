import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import test from "node:test";

import {
  ClaudeWatchdogClassifier,
  WATCHDOG_SCHEMA_JSON,
  maximumWatchdogRunExposureUsd,
  minimumWatchdogBudgetUsd,
  spawnWatchdogProcess,
  type WatchdogSpawn,
  type WatchdogSpawnRequest,
} from "../src/supervision/claude_watchdog.js";
import type { WatchdogRequest } from "../src/supervision/types.js";

test("launches one fresh isolated no-tools Haiku invocation with bounded stdin", async () => {
  const calls: Array<WatchdogSpawnRequest & { cwdEntries: string[] }> = [];
  const spawn: WatchdogSpawn = async (invocation) => {
    calls.push({
      ...invocation,
      cwdEntries: await readdir(invocation.cwd),
    });
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        structured_output: {
          verdict: "healthy",
          confidence: 0.91,
          reason_code: "steady_progress",
          evidence: ["The worker produced new semantic progress."],
        },
        usage: { input_tokens: 120, output_tokens: 30 },
        total_cost_usd: 0.0005,
      }),
      stderr: "",
    };
  };
  const classifier = new ClaudeWatchdogClassifier({ spawn });
  const result = await classifier.classify(request(), new AbortController().signal);

  assert.equal(result.verdict, "healthy");
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.command, "claude");
  assert.deepEqual(call.args.slice(0, 13), [
    "--print",
    "--model",
    "haiku",
    "--safe-mode",
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    WATCHDOG_SCHEMA_JSON,
    "--mcp-config",
  ]);
  assert.equal(call.args[13], '{"mcpServers":{}}');
  const budgetIndex = call.args.indexOf("--max-budget-usd");
  assert.ok(budgetIndex >= 0);
  assert.equal(call.args[budgetIndex + 1], "0.1");
  assert.deepEqual(call.cwdEntries, []);
  assert.ok(Buffer.byteLength(call.input, "utf8") <= 64 * 1024);
  assert.equal(call.args.some((arg) => arg.includes(process.cwd())), false);
  assert.equal(call.args.includes("--resume"), false);
  assert.equal(call.args.includes("--continue"), false);
});

test("default budget covers the maximum envelope and bounds eight-call exposure", () => {
  assert.equal(minimumWatchdogBudgetUsd(64 * 1024, 2 * 1024), 0.1);
  assert.equal(maximumWatchdogRunExposureUsd(0.1, 8), 0.8);
  assert.throws(() => new ClaudeWatchdogClassifier({
    maxBudgetUsd: 0.09,
  }), /maxBudgetUsd must be at least 0.1/);

  assert.equal(minimumWatchdogBudgetUsd(1024, 512), 0.03);
  assert.doesNotThrow(() => new ClaudeWatchdogClassifier({
    inputLimitBytes: 1024,
    outputLimitBytes: 512,
    maxBudgetUsd: 0.03,
  }));
});

test("normalizes invalid JSON, failed invocation, over-budget, and oversized output", async () => {
  const cases: Array<{
    readonly name: string;
    readonly spawn: WatchdogSpawn;
    readonly reason: string;
  }> = [
    {
      name: "invalid JSON",
      spawn: async () => ({ exitCode: 0, stdout: "{bad", stderr: "" }),
      reason: "invalid_classifier_output",
    },
    {
      name: "failed invocation",
      spawn: async () => {
        throw new Error("spawn failed");
      },
      reason: "classifier_invocation_failed",
    },
    {
      name: "budget exceeded",
      spawn: async () => ({
        exitCode: 1,
        stdout: JSON.stringify({ type: "result", subtype: "error_max_budget_usd" }),
        stderr: "",
        budgetExceeded: true,
      }),
      reason: "classifier_budget_exceeded",
    },
    {
      name: "output too large",
      spawn: async () => ({
        exitCode: 0,
        stdout: "x".repeat(2 * 1024 + 1),
        stderr: "",
        outputTooLarge: true,
      }),
      reason: "classifier_output_too_large",
    },
  ];

  for (const item of cases) {
    const result = await new ClaudeWatchdogClassifier({
      spawn: item.spawn,
    }).classify(request(), new AbortController().signal);
    assert.equal(result.verdict, "uncertain", item.name);
    assert.equal(result.reason_code, item.reason, item.name);
  }
});

test("normalizes a timed-out invocation and low-confidence healthy output to uncertain", async () => {
  const timedOut = await new ClaudeWatchdogClassifier({
    spawn: async () => ({
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: true,
    }),
  }).classify(request(), new AbortController().signal);
  assert.equal(timedOut.verdict, "uncertain");
  assert.equal(timedOut.reason_code, "classifier_timeout");

  const lowConfidence = await new ClaudeWatchdogClassifier({
    spawn: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        structured_output: {
          verdict: "healthy",
          confidence: 0.79,
          reason_code: "steady_progress",
          evidence: [],
        },
      }),
      stderr: "",
    }),
  }).classify(request(), new AbortController().signal);
  assert.equal(lowConfidence.verdict, "uncertain");
  assert.equal(lowConfidence.reason_code, "healthy_below_confidence_floor");
});

test("native spawn stops and retains only a bounded prefix after oversized stdout", async () => {
  const result = await spawnWatchdogProcess({
    command: process.execPath,
    args: ["-e", "process.stdout.write('x'.repeat(64 * 1024))"],
    cwd: process.cwd(),
    input: "",
    timeoutMs: 5_000,
    outputLimitBytes: 64,
    signal: new AbortController().signal,
  });

  assert.equal(result.outputTooLarge, true);
  assert.ok(Buffer.byteLength(result.stdout, "utf8") <= 65);
});

function request(): WatchdogRequest {
  const value = {
    original_prompt: "Implement the bounded watchdog.",
    recent_events: [{
      type: "message.delta",
      role: "assistant",
      delta: "Adding tests.",
    }],
    tool_fingerprints: [],
    failure_fingerprints: [],
    elapsed_ms: 600_000,
    suspicion_signals: [],
    truncated: false,
  };
  return {
    ...value,
    input_bytes: Buffer.byteLength(JSON.stringify(value), "utf8"),
  };
}
