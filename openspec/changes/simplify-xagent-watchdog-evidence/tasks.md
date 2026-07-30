## 1. Provider JSON Evidence

- [x] 1.1 Add failing evidence-window tests proving provider JSON fields, Claude Code tool arguments/results, secrets, and paths reach the watchdog unchanged except for 16 KiB string and 64 KiB total-input truncation, including oversized-single-record and exact-size invariants.
- [x] 1.2 Replace normalized semantic events, fingerprints, secret redaction, path rewriting, and prior-verdict evidence with the byte-bounded provider JSON window and the specified request fields.

## 2. Periodic Watchdog Scheduling

- [x] 2.1 Add failing scheduler and supervisor tests proving repeated tools and failures do not trigger early checks, `raw.provider` records advance periodic checks independently of health semantics, exposed waits stay deduplicated and suppress Haiku, and active periodic checkpoints still invoke Haiku.
- [x] 2.2 Remove repetition thresholds, suspicion signals, fingerprint aggregation, prior-verdict input, and early semantic-check scheduling from policy, requests, telemetry, and runtime wiring while retaining the five-minute cadence floor and mechanical suppression.

## 3. Integration and Documentation

- [x] 3.1 Retarget the production-stream fixtures and integration tests so repeated-tool/failure cases prove no early check, Claude Code raw arguments/results remain visible in watchdog input, and mechanical silence and failure handling stay deterministic.
- [x] 3.2 Update the Haiku system prompt and supervision documentation for bounded provider JSON, then run the xagent test suite plus strict OpenSpec validation.
