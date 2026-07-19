I have completed a full independent trace of every color authority and consumer. Writing up the audit.

---

# Independent Color-Flow Audit — Second Pass (Opus)

**Verdict: PASS.** No Critical or Important findings. The implementation is coherent and satisfies every `scf-*`, modified `spm-*`, `sru-*`, and `smod-12` requirement. Three Minor advisories and some informational notes follow, none blocking.

## What I verified directly (not just via the task-6 report)

**Canonical type & hue units — `include/synth/Color.hpp`**
- One 4-byte trivially-copyable `synth::Color` (`static_assert` sizeof/trivially-copyable, `Color.hpp:187-188`). `FromHsvTurns` rejects non-finite and hue outside `[0,1)` (`:100`); `FromHsvDegrees` wraps mod 360 then delegates (`:145-149`); `ToHsv` returns `hueTurns` (`:57,173`). Shared `ScaleAlpha`/`Darken`/`Brighten` live here. A degree value fed to `FromHsvTurns` throws — units cannot be silently confused. ✅ scf-1, spm-19.

**Ownership & resolution — `src/ParameterModulation.cpp`**
- `ResolveParameterAppearance` (`:87-97`) handles empty→broadcast base, one→broadcast, exact→retain, else throw. Called at `RegisterParameter` (`:2134`) **before** duplicate-name check, `CanAllocate`, ID-space check, and `CreateLocalParameter` — so invalid cardinality fails before any manager/group/bank mutation. ✅ scf-3, spm-69 atomicity.
- Modulation-depth config uses `baseColor = modulator.sourceColor` and inherits parent `indicatorColors` (`:1177-1178`), re-resolved harmlessly (`:1146`). Source identity in body, target identity in indicators. ✅ scf-3.
- `ParameterGroupConfig` has **no** color field; group owns topology only. ✅ scf-2.

**Complete snapshots, capacity, clearing, concurrency**
- `PopulateUIState` (`:762-806`) writes base + all indicators + local source colors + global gesture colors inside an odd/even seqlock (`fetch_add` acq_rel → writes → fetch_add release), **clears** trailing voices/sources/gestures beyond current counts (`:785-803`). `SetDisconnected` clears everything including indicators (`:688`). ✅ scf-4, spm-20.
- Cells are sized to manager-wide maxima: `CreateUIState`→`MaxModulatorCount()`/`gestures_.NumGestures()` (`:2695`), so switching a cell between groups cannot expose stale colors. ✅
- Reader `EncoderDrawStateFromParameter` (`EncoderDraw.hpp:300-358`) is a 4-attempt seqlock, bounds every read by `min(count, capacity)`, allocates only UI-thread vectors. No audio-path allocation. ✅ concurrency/allocation boundaries sound.
- Badge drawing (`EncoderDraw.hpp:686-710`) computes `validMask` from published `colors.size()`, `assert`s in debug and `mask &= validMask` in release — no invented fallback, no OOB. `ColorForIndex` is gone. Position uses sequential index; color/label use the true modulator/gesture index → identity aligns. ✅ scf-5, scf-8.

**Terminal adapters** — `UiToJuceColour` (`juce/PortableJuceBackend.hpp:22-25`) is a raw byte→`juce::Colour` map; `BrowserCommandBuffer` serializes/reads color as 4 bytes (`:173-178,197`). Both terminal, no palette selection. ✅

**Structural greps (my own, production only):** zero matches for `synth::ui::Color`, `FromHSV/ToHSV`, `voiceIndicatorColors`, `VoiceIndicatorColor`, `DefaultVoiceColor`, `ApplyActiveBankIndicatorColors`, `ColorForIndex`, `ToUiColor/BrighterUiColor`; no `FromHsvTurns` called with degree literals in apps. ✅ scf-8.

**Braid/MiniApp/MIDI/modules** (verified via focused agents + spot checks): Braid red/green shades built with `FromHsvDegrees`, pairwise-distinct, family-correct, pinned to literal RGB in tests; matrix orange/yellow and green-yellow/yellow; scopes via independent `SetScopeColor`; no snapshot override or live-metadata reconstruction; single-snapshot encoder builder. MiniApp cyan(v0)/orange(v1) indicators on every two-voice param, independent bank/scope/source/gesture roles, snapshot-only encoders. MidiController `CellSnapshot.baseColor`/`indicatorColor[0]` read from the same `Parameter::UIState` the screen reads (parity), and `brightness` derives from connected/blank state — the only surviving `brightness` is the Twister hardware protocol/cache byte. ✅ scf-4/6/7, sru-23, smod-12.

## Findings

### Critical — none
### Important — none

### Minor

1. **"Full green" asymmetry (intent confirmation) — `Braid4Core.hpp` base assignment; test `braid4_system_tests.cpp:464`.** The audible shared base is literal full red `Rgb(255,0,0)`; the LFO shared base is the named `Color::Green = Rgb(0,200,80)` — a softened, non-maximal green. scf-6 phrases the two symmetrically ("full red" / "full green"). The implementation is internally coherent, visibly green, distinct from all four green shades, and pinned by a literal test, so it is not a coherence defect — but a strict reading of scf-6 could expect a maximal green. **Flagging for a one-line intent confirmation; I'm uncertain the reviewer would consider this out of spec.** If intended, no change needed.

2. **Public `m_scopeColor` bypasses the setter — `DspOscillators.hpp:176, 238`.** `WavetableVco::m_scopeColor` and `BasicLFOProcessor::m_scopeColor` are public data members sitting alongside `SetScopeColor`, giving two ways to mutate the trace color while `m_wavetable`/scope writer members are private. It cannot step on parameter/bank roles (scope-only), so it is a surface-consistency nit, not a violation.

3. **Disconnect test omits an indicator assertion — `parameter_modulation_tests.cpp:1774-1780`.** `parameter_ui_state_clears_semantic_colors_when_disconnected` asserts `baseColor==Off`, zero source/gesture counts and `[0]==Off`, but never asserts `indicatorColors[*]` are cleared. Production does clear them (`ParameterModulation.cpp:688`), so this is a coverage gap, not a bug.

### Informational
- `Braid4VcoModule::options_` retains `parameterBaseColor`/`indicatorColors` after registration though only `frequencyOctaveShift` is read later (`Modules.hpp:587`) — harmless dead state.
- `module_tests.cpp:1309-1318` constructs expected greens via `FromHsvDegrees` — but as test-supplied *inputs* threaded through a directly-built module (production `Braid4Core` not involved), so it validates propagation, not palette meaning. Literal palette meaning is correctly pinned in `braid4_system_tests.cpp:435-461`. Not harmfully self-referential.
- OpenSpec `openspec/specs/synth-parameter-modulation/spec.md` still names the old HSV API pending sync/archive (change task 4.1). Per the audit instruction this is a documentation-lifecycle item, not production. The synth `README.md` (`:124-126`) has already been updated to the role-specific `baseColor`/indicator/source/gesture wording — the task-6 "stale README" advisory is resolved.

## Bottom line
Every semantic role — bank, parameter base, per-voice indicator, modulation source, gesture, scope, plus terminal draw/wire/controller and generic runtime-theme colors — has exactly one owner, is independently configurable, and flows through a single complete, revision-guarded snapshot to both screen and hardware. Groups carry no color. No app override or live palette reconstruction exists. Hue units are unforgeable. Braid literal red/green shade/matrix palettes and MiniApp cyan/orange behavior are correct and literally tested. Capacity, clearing, torn-read protection, and allocation boundaries are handled. **This is a PASS.** The three Minor items are optional polish; only finding #1 warrants a quick intent confirmation from the spec author.