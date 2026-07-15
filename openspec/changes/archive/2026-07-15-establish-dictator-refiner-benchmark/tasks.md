## 1. Retrospective Refiner Study

- [x] 1.1 Export the historical interaction distribution and characterize baseline edit behavior without treating lived-with outputs as golden labels
- [x] 1.2 Build the reusable benchmark harness, synthetic fidelity/undo/ASR/Blark/Borg cases, repeated-run support, and model-judge evaluation
- [x] 1.3 Compare GPT-4.1-mini, GPT-5.5, Luna, reasoning settings, conservative prompt versions, and Claude's prompt on synthetic and sampled real passages
- [x] 1.4 Produce the refiner benchmark report, awkward-dictation review, and semantic-landmine audit from the completed runs

## 2. Optional Reasoning-Effort Configuration

- [x] 2.1 Add failing focused tests for reasoning-effort config decoding, omission, invalid values, LLM mapping, and preservation across unrelated runtime patches
- [x] 2.2 Add the typed optional `reasoning_effort` field to runtime and LLM configuration while preserving absent-field compatibility
- [x] 2.3 Add failing request-encoding tests proving configured effort is sent and absent effort is omitted
- [x] 2.4 Carry reasoning effort through every OpenAI engine construction path and encode it in the Responses API payload
- [x] 2.5 Update the Dictator config contract and run focused DictatorCore verification

## 3. Durable Benchmark Organization

- [x] 3.1 Move or copy the existing raw study artifacts without rewriting them into persistent ignored `data/dictator/experiments/refiner-benchmark/2026-07-13-refiner-study/` subdirectories
- [x] 3.2 Verify source and destination record counts and SHA-256 hashes before removing no existing copy
- [x] 3.3 Organize tracked prompts, synthetic cases, deliberately reviewed cases, harness scripts, and generated-file ignores under the benchmark directory
- [x] 3.4 Add the benchmark README, immutable study manifest, aggregate machine-readable summary, and links to the existing reports
- [x] 3.5 Add local verification that detects missing, overwritten, count-mismatched, or hash-mismatched study evidence

## 4. Luna-Low Rollout

- [x] 4.1 Resolve whether conservative v3 or the Claude-informed v4 is the final production base prompt after reviewing the semantic-landmine examples
- [x] 4.2 Install the selected conservative, Blark, and Borg prompt versions in the production prompt catalog with unambiguous production filenames
- [x] 4.3 Update Dictator configuration to `gpt-5.6-luna`, `reasoning_effort: low`, and the selected production prompt paths in one reversible change
- [x] 4.4 Record effective model, reasoning effort, and prompt identity or hashes with each interaction
- [x] 4.5 Smoke-test unchanged prose, stutters, explicit corrections, contextual ASR repair, malformed markers, valid Blark, and semantic Borg behavior and document the rollback configuration

## 5. Safety Follow-Up

- [x] 5.1 Provide a lightweight human disagreement path that can promote explicitly reviewed cases into the golden set
- [x] 5.2 Design deterministic Blark boundary and command parsing with preserved malformed-span diagnostics
- [x] 5.3 Design deterministic Borg boundary parsing while retaining semantic execution of the contained instruction
- [x] 5.4 Re-evaluate reasoning `none` only after marker parsing is structural or production evidence shows low reasoning is unnecessary (deferred by the documented gate; keep `low`)
