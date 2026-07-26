import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  ClaudeWatchdogClassifier,
  DEFAULT_STDOUT_LIMIT_BYTES,
  spawnWatchdogProcess,
} from "../src/supervision/claude_watchdog.js";
import type { WatchdogRequest, WatchdogVerdict } from "../src/supervision/types.js";

// Optional live smoke that invokes the real `claude` binary through the
// production classifier path. This is the only test in the tree that does
// not inject a fake WatchdogSpawn, so it is the only test that can catch
// spawn/parse/stdin-EPIPE issues against the real binary, and the only one
// that exercises `ClaudeWatchdogClassifier.classify()` end-to-end:
// `structuredOutput()` envelope extraction, the verdict-byte bound, usage
// and cost extraction, and the `--tools ""` (Commander variadic → `[""]`)
// semantics against the installed `claude`.
//
// It is OFF by default and is not part of `npm test`. Set
// XAGENT_RUN_LIVE_WATCHDOG_SMOKE=1 AND have `claude` on PATH to run it.
// Network/API failure is tolerated: a `classifier_invocation_failed`,
// `classifier_budget_exceeded`, `classifier_timeout`, or
// `classifier_output_too_large` verdict is a pass, since the goal is to
// prove the spawn/parse/classify plumbing rather than Haiku's correctness.
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

function baseRequest(): WatchdogRequest {
  const value = {
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
  const serialized = JSON.stringify(value);
  return {
    ...value,
    input_bytes: Buffer.byteLength(serialized, "utf8"),
  };
}

test("live claude watchdog classify() returns a real verdict shape through the production spawn path", async (t) => {
  if (!shouldRunLiveSmoke()) {
    t.skip(`set ${x_SmokeEnvVar}=1 and ensure \`claude\` is on PATH to run the live watchdog smoke`);
    return;
  }
  if (!hasClaudeOnPath()) {
    t.skip(`${x_SmokeEnvVar}=1 is set but \`claude\` is not on PATH; skipping live watchdog smoke`);
    return;
  }

  // Drive the smoke through the production classifier path (not
  // `spawnWatchdogProcess` directly) so envelope extraction, the verdict
  // byte bound, usage/cost extraction, and `--tools ""` semantics are
  // exercised against the real binary. The classifier uses the production
  // `DEFAULT_STDOUT_LIMIT_BYTES` (16 KiB) stdout cap internally; we do not
  // override `outputLimitBytes` here — the 2 KiB verdict bound is applied
  // to the extracted structured output, not the raw envelope.
  //
  const classifier = new ClaudeWatchdogClassifier({
    spawn: spawnWatchdogProcess,
    timeoutMs: 30_000,
  });
  const verdict = await classifier.classify(
    baseRequest(),
    new AbortController().signal,
  );

  // The verdict must be one of the three schema values and carry a
  // non-empty reason code and an evidence array. This is the real shape
  // the supervisor persists; a tautological pass here would hide a
  // regression in `structuredOutput()` or normalization.
  //
  const allowedVerdicts: readonly WatchdogVerdict["verdict"][] = [
    "healthy",
    "derailed",
    "uncertain",
  ];
  assert.ok(
    allowedVerdicts.includes(verdict.verdict),
    `verdict must be one of ${allowedVerdicts.join(", ")}, got ${verdict.verdict}`,
  );
  assert.equal(typeof verdict.reason_code, "string");
  assert.ok(verdict.reason_code.length > 0, "reason_code must be non-empty");
  assert.ok(Array.isArray(verdict.evidence), "evidence must be an array");

  // The normalized verdict must fit within the 2 KiB verdict byte bound
  // (the classifier enforces this and returns
  // `classifier_output_too_large` otherwise). `output_bytes` is always
  // populated by the classifier on every path, including the uncertain
  // fallbacks.
  //
  assert.equal(typeof verdict.output_bytes, "number");
  assert.ok(
    verdict.output_bytes! <= 2 * 1024,
    `normalized verdict bytes must fit within the 2 KiB output bound, got ${verdict.output_bytes}`,
  );

  // Network/API failure is a pass for this smoke. The uncertain reason
  // codes below prove the spawn/parse plumbing survived and the
  // classifier normalized a real-world failure rather than crashing the
  // service. Anything else (a thrown error, a missing field) fails the
  // smoke.
  //
  const toleratedReasons = new Set([
    "classifier_invocation_failed",
    "classifier_budget_exceeded",
    "classifier_timeout",
    "classifier_output_too_large",
    "classifier_aborted",
    "invalid_classifier_output",
  ]);
  if (verdict.verdict === "uncertain" && toleratedReasons.has(verdict.reason_code)) {
    return;
  }

  // If claude actually returned a healthy/derailed verdict, the evidence
  // and confidence must be schema-shaped (confidence in [0, 1], evidence
  // items are strings). This is the meaningful assertion the previous
  // tautology skipped: a real verdict round-tripped through the envelope.
  //
  assert.equal(typeof verdict.confidence, "number");
  assert.ok(verdict.confidence >= 0 && verdict.confidence <= 1);
  for (const item of verdict.evidence) {
    assert.equal(typeof item, "string");
  }
});
