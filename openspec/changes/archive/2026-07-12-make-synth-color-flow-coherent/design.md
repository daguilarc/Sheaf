## Context

The synth library currently has two byte-RGBA types (`synth::Color` and `synth::ui::Color`), two duplicated conversion/brightening implementations, and several semantic owners whose fields are all named only `color`. Parameter base color is stored by `ParameterConfig`, voice indicator color is stored by `ParameterGroupConfig`, modulation-source and gesture colors live in metadata, scope color lives in each oscillator processor, and bank color lives in `Bank`. Portable surfaces then receive incomplete visible-cell snapshots and inject modulation/gesture palettes themselves; Braid 4 adds a post-snapshot indicator rewrite by active bank and position.

The immediate defect is unit confusion: `Color::FromHSV` interprets hue as turns but Braid passes degrees. Integer degree values reduce to zero through `fmod(h, 1)`, producing red for every requested shade. The tests construct expected values through the same faulty helper, so they verify self-consistency instead of literal color meaning.

JUCE is not a color authority in this path. It converts portable draw-command RGBA bytes to `juce::Colour` and paints them. Generic JUCE colors for ordinary labels/buttons/panels remain runtime-theme values outside the semantic synth color contract.

## Goals / Non-Goals

**Goals:**

- Give each semantic role exactly one owner: bank color on `Bank`, parameter base and per-voice indicator colors on `Parameter`, source color on modulator metadata, gesture color on gesture metadata, and trace color on scope-producing DSP UI state.
- Make hue units explicit and invalid unit use fail loudly.
- Publish a complete, immutable visible-cell color snapshot so portable UI and hardware feedback consume the same parameter base/indicator truth.
- Make the reusable encoder and waveform builders consume shared `synth::Color` values with no app palette injection.
- Express Braid 4's red/green oscillator identity palettes, matrix palettes, mod-source colors, and scope colors independently and literally.
- Preserve MiniApp's intended visible colors while migrating it to the same reusable data flow.
- Remove dead getters, fallbacks, duplicate helpers, and snapshot-time overrides.

**Non-Goals:**

- Add style or palette injection to the JUCE backend.
- Make bank color style ordinary portable UI buttons; bank color remains semantic bank-selection/controller feedback unless a later portable-control styling contract is added.
- Change DSP, modulation values, MIDI mappings, layout, scene behavior, or persistence formats.
- Add runtime color editing or persist colors in patches.

## Decisions

### 1. Use one canonical RGBA type and unit-explicit HSV APIs

Move `synth::Color` to a neutral `synth/Color.hpp` included by both parameter and portable UI code. Delete `synth::ui::Color`; `DrawCommand::color` uses `synth::Color` directly. The generic draw-command member remains named `color` because it is a terminal RGBA payload rather than semantic configuration.

Replace ambiguous `Color::FromHSV` and `ToHSV` with:

- `Color::FromHsvTurns(float hueTurns, float saturation, float value)`, rejecting non-finite hue and hue outside `[0,1)`;
- `Color::FromHsvDegrees(float hueDegrees, float saturation, float value)`, rejecting non-finite hue and wrapping finite degrees modulo 360;
- `HsvColor ToHsv(Color)` whose field is named `hueTurns`.

Centralize alpha scaling, darkening, and brightening beside the shared color type. Portable encoder and waveform code uses those helpers instead of local conversions.

Alternative considered: document the existing normalized `FromHSV`. Rejected because the call site remains capable of expressing the same silent unit error.

### 2. Parameters own their complete encoder appearance

Replace `ParameterConfig::color` with `baseColor` and add `indicatorColors`. Remove `ParameterGroupConfig::voiceIndicatorColors`, `ParameterGroup::voiceIndicatorColors_`, `VoiceIndicatorColor`, and the generated default voice palette. Groups own processing/storage topology only.

At parameter registration, canonicalize indicator colors to exactly the owning group's voice count:

- empty: broadcast `baseColor` to every voice;
- one color: broadcast it to every voice;
- exactly `numVoices`: retain it;
- any other count: reject registration before manager or bank state is mutated.

`Parameter::BaseColor()` and `Parameter::IndicatorColor(voiceIx)` expose the resolved values. `Parameter::PopulateUIState` publishes the same resolved values used by MIDI hardware feedback.

Generated modulation-depth parameters use the selected modulator's source color as their base color and copy the parent parameter's resolved indicator palette. Resolved indicator arrays are allocated during parameter construction/materialization and are never resized or copied on the steady-state audio path. This preserves source identity in the encoder body/badge while preserving target-voice identity in its indicators.

Alternative considered: make banks provide indicator palettes. Rejected because a parameter may appear in multiple banks and its appearance must not depend on snapshot position or current selection.

### 3. Visible-cell snapshots carry every color required by the reusable encoder

Extend `Parameter::UIState` with bounded arrays/counts for modulator-source and gesture colors. `ParameterManager::CreateUIState` sizes every reusable cell to the manager-wide maximum group modulator count and manager gesture count; `PopulateUIState` publishes the current parameter's actual modulator and gesture color counts and clears unused higher-capacity entries under the existing revision protocol, so switching a cell between groups cannot expose stale colors.

`EncoderDrawStateFromParameter` takes only `Parameter::UIState`. Remove external modulator and gesture spans from the builder API and from Braid/MiniApp surface code. This fixes Braid's current use of quad colors for stereo and mono cells and removes live manager metadata reads from the UI thread.

Disconnected cells clear all semantic colors and counts. `EncoderGeometry::ColorForIndex` and its cyan/orange invented-color fallback are removed; badge iteration is bounded by the published count, and a mask that names an index outside that count is treated as an invalid snapshot/test failure rather than silently inventing a color.

### 4. Semantic field names state their role

Use role-specific names at non-terminal boundaries:

- `Bank::SetBankColor`, `Bank::BankColor`, and bank UI-state `bankColor`;
- `ParameterConfig::baseColor`, parameter UI-state `baseColor`, and encoder draw-state `baseColor`;
- `ModulatorMetadata::sourceColor`;
- `GestureMetadata::gestureColor`;
- oscillator/module `SetScopeColor`, DSP UI-state `scopeColor`, and waveform layer `scopeColor`;
- matrix `SetParameterColors(diagonal, offDiagonal)`.

Remove the ambiguous matrix `GetColor`, `DiagonalColor`, and `OffDiagonalColor` accessors; tests inspect registered parameter colors, which are the behavior consumers actually see. Remove UI-state `brightness`, which has no semantic author and is always one for connected parameters; MIDI output derives full/zero brightness from the existing connected/blank state.

### 5. Braid module options separate base color from oscillator identity

`Braid4VcoModule::Options` carries a shared parameter base color and four oscillator indicator colors. The reusable `WavetableVcoModule`, `ClassicSvfModule`, and `BasicLfoModule` likewise accept parameter indicator colors so MiniApp can configure appearance without a group palette. Registration applies:

- X/Y: shared base color, broadcast indicator color equal to that base;
- Tune/Phase/Shape/Gain: shared base color, the same complete four-color indicator palette on every parameter;
- PM/Frequency N: oscillator N's shade as base and its one indicator color.

Scope colors remain independently assigned with `SetScopeColor`; Braid intentionally supplies the same shade values as oscillator identity, without coupling the APIs.

Braid palettes use `FromHsvDegrees` and tests verify literal channel/family properties and pairwise distinctness rather than computing expected and actual through the same helper. Audible matrix parameters are orange on diagonal and yellow off diagonal. LFO matrix parameters are green-yellow on diagonal and yellow off diagonal. Bank and modulation-source colors keep their independent current assignments.

### 6. MiniApp migrates without app-local color reconstruction

MiniApp supplies its intended cyan/orange per-voice indicator palette on each registered two-voice parameter. Its existing parameter base colors, cyan/orange and green/yellow scope colors, cyan/green bank colors, modulation-source colors, and orange gesture color remain independent. Its portable surface builds every encoder from the visible-cell snapshot alone.

## Risks / Trade-offs

- **[Breaking API touches many registration sites]** → Use compiler errors as the migration inventory, migrate tests and all in-repository modules in the same change, and leave no compatibility aliases.
- **[Larger visible-cell UI state]** → Allocate bounded color arrays only during UI-state creation; audio processing remains allocation-free and publication remains simple atomic copies.
- **[Revision snapshot grows]** → Keep all new fields inside the existing odd/even revision transaction and add torn-read regression coverage.
- **[Tests could again mirror faulty palette construction]** → Anchor hue tests to literal RGB expectations and palette-family predicates, then separately test propagation through UI and draw commands.
- **[Removing fallback colors exposes incomplete configuration]** → Resolve legal defaults at parameter registration and reject malformed palette cardinalities before registration mutation.

## Migration Plan

1. Add failing literal hue and shared-color tests, then introduce the canonical color type and explicit HSV APIs.
2. Add failing same-group/different-parameter indicator tests, then move indicator ownership to parameters and remove group palette state.
3. Add failing per-cell source/gesture snapshot and screen/hardware parity tests, then make snapshots complete and remove app-supplied palettes.
4. Add failing module/Braid/MiniApp role-specific palette tests, then migrate module options, semantic names, scopes, and apps.
5. Delete the Braid snapshot override, duplicate helpers/types, dead matrix getters, and unowned brightness field; run structural searches proving the removed symbols are absent.
6. Run focused tests, the full synth suite, the Sheaf Patch build, and a final Opus audit against this spec.

Rollback is a normal source revert of this atomic branch change; there is no persisted-data migration.

## Open Questions

None. The user has specified independent bank, parameter base, parameter indicator, modulation-source, and scope roles, no group voice color concept, exact reusable encoder code, and no new style/palette injection.
