import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { spawnWatchdogProcess, WATCHDOG_SCHEMA_JSON } from "../src/supervision/claude_watchdog.js";
import type { WatchdogRequest } from "../src/supervision/types.js";

// Optional live smoke that invokes the real `claude` binary through the
// production spawn path. This is the only test in the tree that does not
// inject a fake WatchdogSpawn, so it is the only test that can catch
// spawn/parse/stdin-EPIPE issues against the real binary (the shape that
// would have caught C1 and I1).
//
// It is OFF by default and is not part of `npm test`. Set
// XAGENT_RUN_LIVE_WATCHDOG_SMOKE=1 AND have `claude` on PATH to run it.
// Network/API failure is tolerated: a `classifier_invocation_failed` or
// `classifier_budget_exceeded` verdict is a pass, since the goal is to
// prove the spawn/parse plumbing rather than Haiku's correctness.
//
const x_SmokeEnvVar = "XAGENT_RUN_LIVE_WATCHDOG_SMOKE";

function shouldRunLiveSmoke(): boolean {
  return process.env[x_SmokeEnvVar] === "1";
}

function hasClaudeOnPath(): boolean {
  // Cheap check: spawnWatchdogProcess will surface ENOENT as a rejected
  // promise, but we want a skip rather than a fail when claude is absent.
  // This mirrors the PATH walk assertCommandAvailable does in process_jsonl.
  //
  const result = spawnSync("claude", ["--version"], { stdio: "ignore" });
  return result.status === 0 && result.error === undefined;
}

test("live claude watchdog spawn produces a parseable or normalized-uncertain verdict", async (t) => {
  if (!shouldRunLiveSmoke()) {
    t.skip(`set ${x_SmokeEnvVar}=1 and ensure \`claude\` is on PATH to run the live watchdog smoke`);
    return;
  }
  if (!hasClaudeOnPath()) {
    t.skip(`${x_SmokeEnvVar}=1 is set but \`claude\` is not on PATH; skipping live watchdog smoke`);
    return;
  }

  const baseRequest: WatchdogRequest = {
    original_prompt: "Live watchdog smoke: confirm the spawn path survives.",
    recent_events: [{
      type: "message.delta",
      role: "assistant",
      delta: "smoke progress",
    }],
    tool_fingerprints: [],
    failure_fingerprints: [],
    elapsed_ms: 60_000,
    suspicion_signals: [],
    truncated: false,
    input_bytes: 0,
  };
  const serialized = JSON.stringify(baseRequest);
  const request: WatchdogRequest = {
    ...baseRequest,
    input_bytes: Buffer.byteLength(serialized, "utf8"),
  };

  const controller = new AbortController();
  const result = await spawnWatchdogProcess({
    command: "claude",
    args: [
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
      '{"mcpServers":{}}',
      "--max-budget-usd",
      "0.1",
      "--system-prompt",
      "Classify the semantic health of the active worker. Return healthy, derailed, or uncertain using the required schema.",
    ],
    cwd: process.cwd(),
    input: JSON.stringify(request),
    timeoutMs: 30_000,
    outputLimitBytes: 2 * 1024,
    signal: controller.signal,
  });

  // The spawn must not crash the process (the C1 stdin-EPIPE guard) and must
  // produce a bounded stdout. A non-zero exit, timeout, or oversized output
  // is acceptable as long as it is bounded — the production classifier
  // normalizes all of those to `uncertain`.
  //
  assert.ok(Buffer.byteLength(result.stdout, "utf8") <= 2 * 1024 + 1);
  assert.ok(typeof result.stderr === "string");

  // If claude succeeded, the output must be JSON-parseable (the production
  // path rejects invalid JSON as `invalid_classifier_output`). If it failed
  // for any reason (network, budget, timeout), the production path maps that
  // to a `*_failed`/`*_timeout`/`*_exceeded` uncertain verdict — also a pass
  // for this smoke, which proves plumbing, not accuracy.
  //
  if (result.exitCode === 0 && !result.timedOut && !result.outputTooLarge && !result.aborted) {
    assert.doesNotThrow(() => {
      JSON.parse(result.stdout);
    }, "claude exited 0 but produced non-JSON stdout; the production classifier would map this to invalid_classifier_output");
  }
});
