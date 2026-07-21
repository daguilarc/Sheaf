## 1. Runtime Configuration Contract

- [x] 1.1 Add failing `RuntimeConfigFile` tests for `launchpad_model` decoding (`pro_mk3`, `mini_mk3`, missing defaults to Pro, unknown rejects) and encoded round trips.
- [x] 1.2 Add failing `RuntimeConfigProvider` tests proving the required example supplies defaults/current state, absent live config is not created on startup/read, invalid required files surface errors, and the first successful persisted mutation creates a complete live snapshot.
- [x] 1.3 Implement the public typed `LaunchpadModel` setting and preserve it through decode, encode, patch-derived copies, reset, and persistence without adding it to the dashboard-editable field set.
- [x] 1.4 Replace safe/bootstrap production fallback wiring with explicit example/live stores, required decode errors, and lazy live-file persistence while retaining test-only construction helpers where useful.
- [x] 1.5 Copy the current tracked configuration to `config/dictator.example.json`, set `launchpad_model` to `mini_mk3`, add `config/dictator.json` to `.gitignore`, remove the live file from Git tracking, and retire active `config/dictator.safe` paths.

## 2. Launchpad Device Profiles

- [x] 2.1 Add failing transport tests for Pro/Mini endpoint matching, configured-model isolation, programmer/RGB/sleep/wake SysEx headers, and legacy Pro default selection.
- [x] 2.2 Implement immutable Pro Mk3 and Mini Mk3 transport profiles and refactor `LaunchpadMIDIManager` to use the injected endpoint substring and model byte for every scan and SysEx path.
- [x] 2.3 Pass the startup `launchpad_model` snapshot through `DictatorServiceMain` and `LaunchpadServiceController` into the MIDI manager, preserving the selected profile until restart.
- [x] 2.4 Retain and run existing layout, coordinate, note-mapping, input-event, color-cache, and render-worker tests to prove the controller model change does not alter pad behavior.

## 3. Worktree and Smoke-Test Configuration

- [x] 3.1 Add failing service-startup/smoke-mode tests for normal live/example paths, main-checkout ignored live config, worktree tracked example config, absent smoke live config, and invalid required config diagnostics.
- [x] 3.2 Resolve `config/dictator.json` from the smoke asset root while resolving `config/dictator.example.json` and `config/services.json` from the active worktree; preserve normal repo-root behavior outside smoke mode.
- [x] 3.3 Verify smoke-mode configuration mutations target the resolved ignored live store and that read-only startup with no live file leaves both roots unchanged.

## 4. API and Safe Reset Behavior

- [x] 4.1 Add failing web API tests proving defaults come from the example snapshot, GET/startup do not create a live file, first PATCH/prompt/rule mutation creates a complete live file, rejected mutations do not create one, and reset creates or rewrites from example values with a fresh timestamp.
- [x] 4.2 Update configuration manager, API, prompt-selection, injectable-rule, and explicit-persist paths to share the lazy atomic live-store behavior.
- [x] 4.3 Update Launchpad safe-config tests and implementation so the idle action creates or rewrites the live file from the example-backed startup defaults while busy behavior remains unchanged.

## 5. Documentation and Verification

- [x] 5.1 Update Dictator config-contract, operations, architecture, coverage, and smoke-test documentation for the tracked example, ignored live file, retired safe file, startup-only Launchpad setting, and Mini/Pro profile values.
- [x] 5.2 Search active code, tests, docs, and main capability specs for stale `config/dictator.safe`, tracked-live-config, Pro-only endpoint, and hard-coded `0x0E` assumptions; update only active references and leave archives/quests unchanged.
- [x] 5.3 Run Dictator's full Swift test suite with a matching compiler/SDK, the OpenSpec strict validator, and the repository requirement-ID tests; record any unrelated bootstrap failure instead of weakening tests.
  - Dictator: 281 tests passed under Xcode 26.6 / Swift 6.3.3. Strict validation passed. The repository requirement-ID test remains red on the untouched baseline duplicate `spm-80` in `synth-parameter-modulation` (lines 2213 and 2629); this change does not alter that spec.
- [ ] 5.4 Restart Dictator with the connected Launchpad Mini Mk3 and manually verify model-specific connection, programmer mode, RGB rendering, pad press/release, idle sleep, and wake; then verify a mismatched profile does not connect.

## 6. Fresh-Mac Conductor Bootstrap

- [ ] 6.1 Add a failing Conductor workflow test proving the registered `run` target depends on the existing `install` and `build` targets.
- [ ] 6.2 Update the Conductor Makefile so `make conductor-run` uses project-local `npm install`, builds TypeScript output, and then launches through the existing script without adding a global dependency or new bootstrap mechanism.
- [ ] 6.3 Update Conductor README/operations and the active `conductor-service-management` capability spec to make the self-bootstrapping registered command explicit.
- [ ] 6.4 Verify Conductor's full test suite and a real startup from missing local dependencies, then use the running production Conductor to complete the pending Dictator Launchpad hardware smoke test.
