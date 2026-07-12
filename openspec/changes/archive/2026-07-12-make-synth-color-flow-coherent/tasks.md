## 1. Canonical Color Type and Hue Units

- [x] 1.1 Add failing color tests anchored to literal RGB channels for degree/turn constructors, invalid hue-turn rejection, HSV round trip, and shared RGBA helpers.
- [x] 1.2 Extract the canonical `synth::Color`/`HsvColor` API to `synth/Color.hpp`, replace ambiguous HSV APIs, remove `synth::ui::Color`, and migrate portable/JUCE/browser consumers.
- [x] 1.3 Run parameter-modulation, portable-UI, browser-command-buffer, and JUCE backend tests; structurally verify ambiguous/duplicate color types and helpers are absent.

## 2. Parameter-Owned Appearance and Complete Snapshots

- [x] 2.1 Add failing parameter tests for base color, empty/one/exact indicator resolution, invalid-cardinality atomicity, same-group different palettes, modulation-depth inheritance, disconnected clearing, and source/gesture snapshot colors.
- [x] 2.2 Move indicator ownership from `ParameterGroup` to `Parameter`, add role-specific parameter/source/gesture/bank names, publish bounded source/gesture color arrays under the revision transaction, and remove the unowned brightness field.
- [x] 2.3 Add failing encoder/MIDI parity tests, make `EncoderDrawStateFromParameter` consume one complete snapshot, remove external palette spans and fallback colors, and verify portable and hardware consumers read the same base/indicator state.
- [x] 2.4 Run parameter-modulation, MIDI/controller, instrument, portable-UI, and randomized UI-state suites; structurally verify group palettes and old semantic names are absent.

## 3. Reusable Modules and App Migrations

- [x] 3.1 Add failing module tests for role-specific Braid base/indicator options, mono oscillator identity, scope-color independence, matrix parameter colors, and removed generic color APIs.
- [x] 3.2 Migrate oscillator, LFO, matrix, and Braid reusable modules to role-specific color APIs without changing DSP or registration topology.
- [x] 3.3 Add failing Braid system/portable tests for literal distinct red/green families, quad shared bases with four indicators, mono/stereo roles, matrix colors, correct per-group source badges, eight scope colors, and screen/hardware parity.
- [x] 3.4 Migrate Braid palettes to degree-explicit construction, delete `ApplyActiveBankIndicatorColors`, and remove all Braid app-local encoder palette plumbing.
- [x] 3.5 Add failing MiniApp regressions for parameter-owned cyan/orange indicators, independent parameter/scope/bank/source/gesture colors, and snapshot-only reusable encoders; migrate MiniApp and remove app-local palette plumbing.
- [x] 3.6 Run module, Braid, MiniApp, portable-UI, and launcher harness tests; structurally verify no snapshot override, live metadata palette reconstruction, or ambiguous scope/matrix/bank color API remains.

## 4. Full Verification and Independent Audit

- [x] 4.1 Run strict OpenSpec validation and synchronize completed task evidence.
- [x] 4.2 Run `make -C projects/synth build test`, relevant JUCE/runtime tests, and build `projects/synth/apps/sheaf-patch/build/SheafPatch.app` with no new warnings.
- [x] 4.3 Run repository-wide color-flow/dead-code searches and inspect the final diff against every `scf-*`, modified `spm-*`, `sru-*`, and `smod-*` requirement.
- [x] 4.4 Have xagent Claude Opus repeat the original library/Braid/MiniApp color audit against the final implementation and spec; resolve every Critical/Important finding and re-run affected tests and review until clean.
