## Context

The watchdog currently builds its own semantic model from adapter events: it selects event types, normalizes tool lifecycle data, hashes tool and failure payloads, detects repetition, and supplies the resulting suspicion signals and prior verdict to Haiku. Production provider streams do not consistently match those adapter assumptions, so the preprocessing has erased arguments and completions, filled the evidence window with empty deltas, and presented normal repeated work as a suspected loop.

## Goals / Non-Goals

**Goals:**

- Leave mechanical lifecycle and liveness decisions deterministic.
- Let Haiku make semantic judgments from the provider JSON that the worker actually emitted.
- Bound classifier input through recursive 16 KiB UTF-8 string truncation and a 64 KiB total byte limit.
- Preserve the existing isolated, advisory, periodic, and budgeted classifier boundary.

**Non-Goals:**

- Deterministically recognize semantic loops, retries, contradictions, or inefficient work.
- Normalize provider schemas into a common semantic event model for the watchdog.
- Redact secrets or repository paths from watchdog input.
- Change controller wake behavior or allow Haiku to act on a worker.
- Repair provider-specific adapter normalization outside the watchdog path.

## Decisions

### 1. Store a bounded window of provider JSON

For each `raw.provider` event, retain its `payload` object with field names, values, and nesting intact. Recursively truncate strings longer than 16 KiB of UTF-8 with the explicit marker `[xagent: truncated]`, then retain the newest complete records that fit alongside the task prompt, harness name, elapsed time, `truncated`, and `input_bytes` within the existing 64 KiB total input limit. The request fields are `original_prompt`, `harness`, `recent_provider_json`, `elapsed_ms`, `truncated`, and `input_bytes`.

The task prompt is subject to the same long-string and total-input bounds and is not redacted or path-rewritten. Synthetic JSON wrappers for non-JSON provider lines are ordinary `raw.provider` payloads. Duplicate `rawProvider` side channels on normalized adapter events are ignored.

The retained window is byte-bounded as records arrive. Old complete records are evicted first. A single recursively string-bounded record that still cannot fit is omitted as a whole and sets `truncated`; the builder does not summarize or structurally rewrite it. This keeps memory bounded without adding a second semantic representation.

The watchdog will not reinterpret deltas, reconstruct tools, discard provider fields, redact values, rewrite paths, or derive semantic events. This avoids making adapter correctness a prerequisite for watchdog correctness.

### 2. Remove deterministic semantic evidence

Remove tool and failure fingerprints, repetition counters and thresholds, suspicion signals, and the prior watchdog verdict from the classifier request and scheduling policy. Deterministic supervision remains responsible only for observable mechanical state.

Each `raw.provider` record advances watchdog eligibility at the existing periodic active-work checkpoints. This trigger is separate from the health monitor: existing transport and semantic liveness timestamps, exposed-wait deduplication, and deterministic classifications continue to use the existing adapter-event classification. Provider JSON activity establishes that the worker is active; it does not independently imply health or derailment.

The existing five-minute minimum interval remains as a bound on configurable cadence. A mechanically terminal, silent, hard-deadline, or exposed-wait state suppresses Haiku; ordinary provider activity does not clear a deterministic exposed wait unless the existing normalized semantic-health rules do so.

### 3. Accept the classifier trust boundary explicitly

Provider JSON visible to a worker may be sent to the isolated Haiku process without secret redaction. This is an intentional cross-provider disclosure trade-off accepted for semantic fidelity. Haiku remains tool-free, has no repository working directory, cannot call MCP, and cannot steer or interrupt the worker.

Watchdog telemetry continues to persist only request hashes, sizes, usage, verdicts, and timing—not the classifier input itself.

The classifier system prompt will describe the input as bounded provider JSON, identify the harness field, and state that repeated tools, retries, empty deltas, and unfamiliar transport records are ambiguous rather than deterministic evidence of derailment.

## Risks / Trade-offs

- **Provider JSON may contain credentials or sensitive repository content and may cross model-provider boundaries.** → Treat this as an explicit accepted trust boundary; continue not persisting watchdog inputs.
- **Large fields can crowd older context out of the window.** → Truncate every long string before enforcing the total byte cap and mark both field and window truncation.
- **A record with many short fields may exceed the total cap even after string truncation.** → Omit that record whole, set `truncated`, and retain other newest complete records that fit.
- **Raw provider schemas differ and may contain transport noise.** → Include the harness name and rely on Haiku to interpret the supplied JSON rather than adding another lossy semantic adapter.
- **Removing suspicion triggers can delay detection until the next periodic checkpoint.** → Accept the latency in exchange for eliminating deterministic semantic bias.
- **Removing prior-verdict input can produce another advisory at a later checkpoint for the same unresolved condition.** → Accept periodic re-evaluation; keep verdicts advisory and bounded by cadence and the eight-call cap.

## Migration Plan

Replace the evidence request shape and periodic scheduler in one release, remove obsolete policy fields, update fixtures and documentation, and restart the xagent service. Existing persisted run metadata remains readable; fields no longer produced may be ignored. Strict request validation will reject removed suspicion-policy fields rather than silently accepting them.

Rollback restores the prior evidence builder and scheduler without migrating durable user data.

## Open Questions

None.
