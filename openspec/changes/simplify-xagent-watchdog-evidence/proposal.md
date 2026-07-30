## Why

The xagent watchdog currently reduces active provider output to normalized events, opaque fingerprints, and deterministic repetition signals before asking Haiku for a semantic judgment. That preprocessing has discarded tool arguments and results in production and biases Haiku toward false loop alerts during ordinary iterative work.

## What Changes

- Restrict deterministic supervision to mechanical conditions such as process exit, transport loss, silence, completion, cancellation, deadlines, and exposed input or permission waits.
- Feed periodic Haiku checks a bounded recent window of provider JSON with only long-field and total-input truncation.
- Let each `raw.provider` record advance periodic watchdog eligibility without changing the health monitor's existing semantic-versus-transport activity classification.
- Remove tool and failure fingerprints, repetition thresholds, suspicion-triggered checks, semantic normalization, secret redaction, path rewriting, and prior-verdict input from watchdog evidence.
- Keep Haiku isolated, tool-free, advisory, schema-bound, and subject to the existing cadence and invocation budget.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `xagent-supervision`: Replace preclassified semantic evidence and repetition triggers with minimally transformed bounded provider JSON evaluated only by periodic Haiku checks.

## Impact

This changes the xagent supervisor evidence window, watchdog request schema and system prompt, scheduler, provider-event plumbing, configuration, telemetry, tests, and supervision documentation under `projects/xagent`. It intentionally permits provider JSON visible to the worker to cross into the isolated Haiku classifier.
