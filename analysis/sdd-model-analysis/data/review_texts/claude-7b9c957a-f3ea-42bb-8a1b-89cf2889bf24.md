All checks pass. The `state.color` references are on `SystemMessageOutputState`, an unrelated struct; the `ui.Configure(0,0,0,0,4,3)` call uses the new 6-arg signature correctly. No dangling references to removed symbols.

## Review Verdict: **PASS**

No Critical or Important findings. The five follow-up changes are correct and introduce no regression, API bypass, DSP change, ownership ambiguity, or spec mismatch.

### Verification of each fix

**1. Full LFO shared base is literal `RGB(0, 255, 0)`** — Confirmed at `Braid4Core.hpp`: `lfoOptions.parameterBaseColor = synth::Color::Rgb(0, 255, 0)`. This is deliberately distinct from `Color::Green` (which is `Rgb(0, 200, 80)`, `Color.hpp:181`). The Braid audio base remains `Color::Red` (full red). Resolution logic (`ResolveParameterAppearance`) correctly fans a single-element `indicatorColors` out to all voices, so LFO stereo X/Y get full green for base and both indicators — matching spec line 133.

**2. Scope color storage private, `SetScopeColor` sole mutation** — Confirmed. In `DspOscillators.hpp`, both `WavetableVco` and `BasicLFOProcessor` moved `m_scopeColor` under `private:`; the only writer is `SetScopeColor`, the only reader is `PopulateUIState`. `dsp_tests.cpp` adds a `requires`-expression `static_assert` proving the storage is inaccessible from outside (a compile-time probe, not a real access — correctly written). No remaining `SetColor(`/`.color` bypass callers anywhere in the module chain.

**3. Disconnected parameter test asserts indicator clearing** — Confirmed. `parameter_ui_state_clears_semantic_colors_when_disconnected` now asserts `indicatorColors[0] == Color::Off` after `SetDisconnected()`, plus `baseColor`, modulator, and gesture color clearing. Matches the `SetDisconnected` implementation which zeroes all three color arrays.

**4. `Braid4VcoModule` no longer retains unused Options** — Confirmed. The `options_` member is removed; `frequencyScale_` is now computed directly from the local `options.frequencyOctaveShift` during registration. The `Options` struct itself is still used as a by-value parameter. No lingering references to `options_`.

**5. OpenSpec defines full green literally** — Confirmed at `openspec/changes/make-synth-color-flow-coherent/specs/synth-color-flow/spec.md` (lines 115, 124, 133): full green is written as `RGB(0, 255, 0)` for the LFO shared parameter base, and the spec matches the implementation (full red audio base, independent bank/mod-source colors, scope colors equal to oscillator shades via the scope-color API).

### Additional regression sweep (clean)
- No dangling readers of the removed `Parameter::UIState::brightness` / `.color` fields; the only `brightness` hits are the unrelated Twister hardware brightness in `MidiController`.
- No leftover callers of renamed APIs (`FromHSV`, `SetColors`, `SetColor` on bank/matrix, `VoiceIndicatorColor`, `ParamColor`, `GetColor`, `stereoColor`, `oscillatorColors`, `voiceIndicatorColors`).
- `ParameterManager::UIState::Configure` call sites updated to the new modulator-color-capacity arity; the DSP `Process` paths are untouched by this color refactor.