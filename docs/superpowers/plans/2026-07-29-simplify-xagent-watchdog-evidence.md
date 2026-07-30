# Simplify xagent Watchdog Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace xagent's fingerprint-biased watchdog evidence with a minimally transformed, byte-bounded window of the provider JSON that the worker actually emitted.

**Architecture:** `Supervisor` will feed only `raw.provider.payload` values into a per-turn provider-JSON evidence window and use those raw records to advance periodic watchdog eligibility, independently of the health monitor's existing semantic/transport bookkeeping. The scheduler will retain only periodic cadence and mechanical suppression; Haiku will receive the task prompt, harness, elapsed time, and recent provider JSON with recursive long-string and whole-window truncation.

**Tech Stack:** TypeScript 5.8, Node.js 20 test runner, Zod, OpenSpec

## Global Constraints

- Watchdog request fields are exactly `original_prompt`, `harness`, `recent_provider_json`, `elapsed_ms`, `truncated`, and `input_bytes`.
- Recursively truncate strings longer than 16 KiB UTF-8 with the marker `[xagent: truncated]`; perform no hashing, redaction, path rewriting, semantic normalization, reconstruction, or summarization.
- The complete serialized watchdog request must remain at or below 64 KiB; retain newest complete records, evict oldest records first, and omit as a whole any single bounded record that still cannot fit.
- `raw.provider` activity advances only periodic watchdog eligibility. It must not change the health monitor's semantic/transport classification, semantic timestamp, or exposed-wait deduplication.
- Remove suspicion signals, fingerprints, repetition thresholds, early semantic checks, and prior-verdict input.
- Preserve the 10/20/40-minute default periodic cadence, five-minute configurable-cadence floor, eight-call run cap, 2 KiB verdict cap, verdict evidence schema bounds, tool-free Haiku isolation, advisory-only verdicts, and mechanical supervision.
- Watchdog request content must never be persisted; telemetry continues to store only hashes, sizes, usage, timing, truncation, and verdict data.
- Use test-driven development: add each regression test first, run it and observe the expected failure, then make the minimal production change and rerun it.

---

### Task 1: Provider JSON Window and Periodic-Only Runtime

**Files:**

- Modify: `projects/xagent/src/supervision/evidence.ts`
- Modify: `projects/xagent/src/supervision/types.ts`
- Modify: `projects/xagent/src/supervision/supervisor.ts`
- Modify: `projects/xagent/src/supervision/watchdog.ts`
- Modify: `projects/xagent/src/service/tool_schemas.ts`
- Modify: `projects/xagent/tests/supervision_evidence.test.ts`
- Modify: `projects/xagent/tests/watchdog.test.ts`
- Modify: `projects/xagent/tests/claude_watchdog.test.ts`
- Modify: `projects/xagent/tests/claude_watchdog_live.test.ts`
- Modify: `projects/xagent/tests/supervision_cost.test.ts`
- Modify: `projects/xagent/tests/supervision_review_fixes.test.ts`
- Modify: `projects/xagent/tests/supervision_e2e.test.ts`

**Interfaces:**

- Produces:

```ts
export type ProviderJsonEvidenceInput = {
  readonly original_prompt: string;
  readonly harness: HarnessName;
  readonly recent_provider_json: readonly unknown[];
  readonly elapsed_ms: number;
  readonly truncated: boolean;
};

export type ProviderJsonEvidenceSnapshot = ProviderJsonEvidenceInput & {
  readonly input_bytes: number;
};

export type ProviderJsonEvidenceWindowOptions = {
  readonly harness: HarnessName;
  readonly originalPrompt: string;
  readonly clock?: () => Date;
  readonly maxInputBytes?: number;
  readonly maxStringBytes?: number;
};

export class ProviderJsonEvidenceWindow {
  constructor(options: ProviderJsonEvidenceWindowOptions);
  record(payload: unknown): void;
  snapshot(): ProviderJsonEvidenceSnapshot;
}
```

- Produces: `WatchdogRequest` as an alias of `ProviderJsonEvidenceSnapshot`.
- Consumes: one `raw.provider.payload` per parsed provider line from the existing `ProcessJsonlSession`.
- Preserves: `WatchdogScheduler.onActiveEvidenceThunk(() => request)` as the lazy snapshot seam, but eligibility is periodic-only.

- [ ] **Step 1: Replace fingerprint-focused evidence tests with failing raw-provider fidelity tests**

Rewrite the obsolete cases in `projects/xagent/tests/supervision_evidence.test.ts` so the first tests establish the new request contract:

```ts
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
```

Add separate tests proving:

- nested object and array strings are each at most 16 KiB UTF-8 including `[xagent: truncated]`, surrounding keys/nesting remain intact, and valid UTF-8 is preserved;
- a record containing enough distinct short fields to exceed 64 KiB is omitted whole, sets `truncated`, and does not prevent a later fitting record from being retained;
- byte pressure evicts oldest complete records and keeps the newest complete records;
- a maximal snapshot satisfies both `snapshot.input_bytes === Buffer.byteLength(JSON.stringify(snapshot), "utf8")` and `snapshot.input_bytes <= 64 * 1024`;
- the original prompt keeps secrets and absolute paths, subject only to the same string and total limits;
- only explicit `record(payload)` values appear, so normalized events and duplicate `rawProvider` side channels cannot enter through the evidence-window API.

Run:

```bash
cd /Users/joyo/.codex/worktrees/716c1c65-443f-4333-a165-1ad67e1e7f64/Sheaf/projects/xagent
node --test dist/tests/supervision_evidence.test.js
```

Expected: FAIL because `ProviderJsonEvidenceWindow` and the new request fields do not exist.

- [ ] **Step 2: Implement the byte-bounded provider JSON evidence window**

Replace the fingerprint and normalization implementation in `evidence.ts`. Use these constants and preserve the existing exact self-referential `input_bytes` accounting helper:

```ts
const DEFAULT_MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_STRING_BYTES = 16 * 1024;
const MIN_INPUT_BYTES = 512;
const TRUNCATION_MARKER = "[xagent: truncated]";
```

Recursively copy JSON values while truncating strings only:

```ts
function boundProviderValue(value: unknown, maxStringBytes: number): {
  readonly value: unknown;
  readonly truncated: boolean;
} {
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") <= maxStringBytes) {
      return { value, truncated: false };
    }
    const prefixBudget = maxStringBytes - Buffer.byteLength(TRUNCATION_MARKER, "utf8");
    return {
      value: `${truncateUtf8(value, prefixBudget)}${TRUNCATION_MARKER}`,
      truncated: true,
    };
  }
  if (Array.isArray(value)) {
    const bounded = value.map((item) => boundProviderValue(item, maxStringBytes));
    return {
      value: bounded.map((item) => item.value),
      truncated: bounded.some((item) => item.truncated),
    };
  }
  if (isRecord(value)) {
    let truncated = false;
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const bounded = boundProviderValue(item, maxStringBytes);
      result[key] = bounded.value;
      truncated ||= bounded.truncated;
    }
    return { value: result, truncated };
  }
  return { value, truncated: false };
}
```

Keep retained-record memory byte-bounded during `record()`. If the bounded record alone exceeds `maxInputBytes`, omit it and remember truncation. Otherwise append it, track its serialized byte length, and evict oldest records until the retained-record bytes are within the cap. In `snapshot()`, construct the exact six-field request, choose newest complete records that fit, and set `truncated` when a string, prompt, record, or window was shortened or omitted. Do not import `createHash`, `canonicalJson`, or `sanitizeValue`.

Run:

```bash
cd /Users/joyo/.codex/worktrees/716c1c65-443f-4333-a165-1ad67e1e7f64/Sheaf/projects/xagent
/opt/homebrew/bin/npm run build
node --test dist/tests/supervision_evidence.test.js
```

Expected: the new evidence tests PASS.

- [ ] **Step 3: Add failing scheduler and supervisor regressions**

In `watchdog.test.ts`, replace suspicion tests and request builders with periodic-only cases:

```ts
test("repeated provider activity never invokes before the periodic checkpoint", async () => {
  const clock = new FakeClock();
  const classifier = new RecordingClassifier();
  const scheduler = new WatchdogScheduler({
    classifier,
    clock: clock.now,
    scheduler: clock,
    policy: { cadenceMs: [600_000], minimumIntervalMs: 300_000 },
  });

  for (let index = 0; index < 20; index += 1) {
    clock.advance(29_000);
    await scheduler.onActiveEvidence(request({
      recent_provider_json: [{ type: "tool_use", id: index % 2 }],
    }));
  }
  assert.equal(classifier.calls.length, 0);

  clock.advance(20_000);
  await scheduler.onActiveEvidence(request({
    recent_provider_json: [{ type: "tool_use", id: "checkpoint" }],
  }));
  assert.equal(classifier.calls.length, 1);
});
```

Add supervisor-level tests proving:

- raw Claude Code provider records containing `input_json_delta` and `tool_result` reach the classifier at a periodic checkpoint even if no normalized `tool.completed` event exists;
- a stream of only `raw.provider` records does not advance `last_semantic_progress_at`;
- after `permission_required`, continued raw provider records neither invoke Haiku nor emit a second permission attention; an existing normalized semantic event clears the wait according to current health behavior;
- silence, hard deadline, completion, cancellation, provider failure, and transport loss do not invoke Haiku;
- a maximal request delivered through `ClaudeWatchdogClassifier.classify()` does not become `classifier_input_too_large`.

Run the targeted build/tests and observe failure before implementation:

```bash
cd /Users/joyo/.codex/worktrees/716c1c65-443f-4333-a165-1ad67e1e7f64/Sheaf/projects/xagent
/opt/homebrew/bin/npm run build
node --test dist/tests/watchdog.test.js dist/tests/supervision_evidence.test.js
```

Expected: FAIL on suspicion fields, early scheduling, raw-provider trigger wiring, and mechanical suppression.

- [ ] **Step 4: Rewire runtime and policy to periodic raw-provider evidence**

In `types.ts`:

- replace semantic evidence imports with `ProviderJsonEvidenceSnapshot`;
- remove `suspicionWindowMs`, `repeatedToolThreshold`, and `repeatedFailureThreshold` from `WatchdogPolicy`;
- define `WatchdogRequest = ProviderJsonEvidenceSnapshot`;
- leave verdict, aggregate, and telemetry types unchanged.

In `tool_schemas.ts`, remove those same three strict request fields so callers receive a validation error if they continue sending removed policy.

In `watchdog.ts`, reduce `onActiveEvidenceThunk` to:

```ts
onActiveEvidenceThunk(getRequest: () => WatchdogRequest): Promise<void> {
  if (this.coverageExhausted || this.#inFlight !== undefined) {
    return this.#inFlight ?? Promise.resolve();
  }
  const now = this.#clock().getTime();
  const lastRelevantCheck = this.#lastInvocationAt ?? this.#turnStartedAt;
  if (now - lastRelevantCheck < this.#minimumIntervalMs || now < this.#nextPeriodicAt) {
    return Promise.resolve();
  }
  return this.#invokeWatchdog(getRequest(), now);
}
```

Remove the trigger parameter and all suspicion branches, but retain periodic healthy backoff/reset, in-flight exclusion, lazy request creation, per-turn reset, call budget, and timeout handling.

In `supervisor.ts`:

- construct `ProviderJsonEvidenceWindow` with `harness: this.#adapter.harness`, the raw prompt, clock, and `inputLimitBytes`;
- remove all previous-verdict state and calls;
- preserve the current `isActiveSemanticEvidence()` result solely for `DeterministicHealthMonitor.recordProviderActivity()` and persisted semantic timestamps;
- only when `event.type === "raw.provider"`, call `this.#evidence.record(event.payload)` and offer the lazy snapshot to the scheduler;
- track mechanical watchdog suppression independently of health semantics: exposed input/permission waits and hard deadline suppress checks; raw-provider records alone do not clear them; current normalized semantic activity may clear exposed waits, while hard deadline remains suppressing for the turn; completion/failure/cancellation/transport loss remain mechanically terminal and cannot schedule;
- preserve transcript sanitization and persistence exactly as-is because it is a different trust boundary from transient watchdog input.

Update every in-tree `WatchdogRequest` test builder to the exact six-field shape.

Run:

```bash
cd /Users/joyo/.codex/worktrees/716c1c65-443f-4333-a165-1ad67e1e7f64/Sheaf/projects/xagent
/opt/homebrew/bin/npm test
```

Expected: all xagent tests PASS with the live watchdog smoke still skipped unless explicitly enabled.

- [ ] **Step 5: Commit Task 1**

```bash
cd /Users/joyo/.codex/worktrees/716c1c65-443f-4333-a165-1ad67e1e7f64/Sheaf
git add projects/xagent/src/supervision/evidence.ts projects/xagent/src/supervision/types.ts projects/xagent/src/supervision/supervisor.ts projects/xagent/src/supervision/watchdog.ts projects/xagent/src/service/tool_schemas.ts projects/xagent/tests
git commit -m "refactor(xagent): feed provider JSON to watchdog"
```

### Task 2: Classifier Guidance, Production Fixtures, and Documentation

**Files:**

- Modify: `projects/xagent/src/supervision/claude_watchdog.ts`
- Modify: `projects/xagent/tests/claude_watchdog.test.ts`
- Modify: `projects/xagent/tests/fixtures/watchdog/*.json`
- Modify: `projects/xagent/tests/supervision_e2e.test.ts`
- Modify: `projects/xagent/docs/supervision.md`
- Modify: `openspec/changes/simplify-xagent-watchdog-evidence/tasks.md`

**Interfaces:**

- Consumes: Task 1's exact six-field `WatchdogRequest` and periodic-only scheduler.
- Produces: a Haiku system prompt that accurately describes bounded, minimally transformed per-harness provider JSON.
- Produces: production-shaped Claude Code fixtures whose raw `input_json_delta` and `tool_result` records are asserted visible to the classifier.

- [ ] **Step 1: Add failing classifier-prompt and production-fixture assertions**

In `claude_watchdog.test.ts`, extend the fake-spawn assertion to require that the system prompt:

```ts
assert.match(systemPrompt, /bounded provider JSON/i);
assert.match(systemPrompt, /harness/i);
assert.match(systemPrompt, /repeated tools.*ambiguous/i);
assert.doesNotMatch(systemPrompt, /sanitized JSON evidence/i);
```

Retarget `repeated_tool_loop.json` and `error_thrashing.json` to contain production-shaped raw provider payloads and to expect no classifier call before ten minutes. Update the fixture schema and runner so it no longer accepts or inspects `expected_suspicion_signals`.

Add or adapt a Claude Code fixture whose raw records include both:

```json
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\"command\":\"npm test\"}"}}}
{"type":"assistant","message":{"content":[{"type":"tool_result","content":"tests failed with exit 1"}]}}
```

At a periodic checkpoint, assert the classifier request contains both records and their argument/result strings.

Run:

```bash
cd /Users/joyo/.codex/worktrees/716c1c65-443f-4333-a165-1ad67e1e7f64/Sheaf/projects/xagent
/opt/homebrew/bin/npm run build
node --test dist/tests/claude_watchdog.test.js dist/tests/supervision_e2e.test.js
```

Expected: FAIL because the old prompt says “sanitized JSON evidence” and the old fixtures still encode suspicion behavior.

- [ ] **Step 2: Update Haiku guidance and fixture corpus**

Replace `WATCHDOG_SYSTEM_PROMPT` with concise guidance equivalent to:

```ts
const WATCHDOG_SYSTEM_PROMPT = [
  "Classify only the semantic health of the active worker from bounded provider JSON.",
  "Use the harness field to interpret provider-specific records.",
  "Repeated tools, retries, failures, empty deltas, and unfamiliar transport records are ambiguous and are not by themselves evidence of derailment.",
  "Return healthy, derailed, or uncertain using the required schema.",
  "Evidence entries must be short factual observations already supported by the input.",
  "Do not provide commands, remediation, controller actions, or instructions to the worker.",
  "Use uncertain whenever the bounded evidence cannot establish semantic health.",
].join(" ");
```

Keep the JSON schema, empty tool set, empty MCP config, temporary working directory, no session persistence, timeout, cost, output-size handling, and verdict normalization unchanged.

Update all seven fixture files and their runner to the new request shape. Retain the mechanical crash and silence cases. Make repeated-tool and repeated-failure cases explicit regressions for no early invocation, and keep healthy exploration/contradiction classification at periodic checkpoints.

Run:

```bash
cd /Users/joyo/.codex/worktrees/716c1c65-443f-4333-a165-1ad67e1e7f64/Sheaf/projects/xagent
/opt/homebrew/bin/npm run build
node --test dist/tests/claude_watchdog.test.js dist/tests/supervision_e2e.test.js
```

Expected: targeted tests PASS.

- [ ] **Step 3: Update supervision documentation**

In `projects/xagent/docs/supervision.md`:

- replace the fingerprint/suspicion defaults and flow with periodic 10/20/40-minute checks and the retained five-minute cadence floor;
- document the exact six request fields, 16 KiB string cap and marker, 64 KiB total cap, newest-complete-record retention, and whole omission of an individually oversized record;
- state that provider JSON and the task prompt are not redacted before the isolated Haiku call, while classifier input is never persisted;
- explain that raw provider records drive periodic eligibility without changing health semantic timestamps or deterministic wait deduplication;
- retarget the repeated-tool/failure false-alert posture to say repetition never triggers an early check and Haiku evaluates it only at a periodic checkpoint;
- retain the tool-free/advisory/no-controller-action boundary and the live-smoke instructions;
- note that provider adapter normalization defects outside the watchdog evidence path are not repaired by this change.

- [ ] **Step 4: Run full verification and strict OpenSpec validation**

Run:

```bash
cd /Users/joyo/.codex/worktrees/716c1c65-443f-4333-a165-1ad67e1e7f64/Sheaf/projects/xagent
/opt/homebrew/bin/npm test
cd /Users/joyo/.codex/worktrees/716c1c65-443f-4333-a165-1ad67e1e7f64/Sheaf
/Users/joyo/.local/share/sheaf/bin/openspec validate simplify-xagent-watchdog-evidence --strict
```

Expected: xagent build and test suite exit 0, with only the opt-in live watchdog smoke skipped; OpenSpec reports `Change 'simplify-xagent-watchdog-evidence' is valid`.

Then mark all six OpenSpec task checkboxes complete in `openspec/changes/simplify-xagent-watchdog-evidence/tasks.md` and rerun both commands so the checked artifact is the validated state.

- [ ] **Step 5: Commit Task 2**

```bash
cd /Users/joyo/.codex/worktrees/716c1c65-443f-4333-a165-1ad67e1e7f64/Sheaf
git add projects/xagent/src/supervision/claude_watchdog.ts projects/xagent/tests projects/xagent/docs/supervision.md openspec/changes/simplify-xagent-watchdog-evidence docs/superpowers/plans/2026-07-29-simplify-xagent-watchdog-evidence.md
git commit -m "test(xagent): verify raw watchdog evidence"
```
