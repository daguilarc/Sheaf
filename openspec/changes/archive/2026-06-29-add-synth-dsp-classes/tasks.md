## 1. DSP Module Skeleton and Build Wiring

- [x] 1.1 Add JUCE-free public DSP headers for math, numbers, transfer functions, filters, scope, wavetables, and oscillators under `projects/synth/include/synth`.
- [x] 1.2 Add DSP source files under `projects/synth/src` for non-template definitions, default wavetable factories, and any explicit instantiations.
- [x] 1.3 Update `projects/synth/Makefile` so the synth static library and `make -C projects/synth test` include the new DSP sources and tests.
- [x] 1.4 Add a JUCE-free include smoke test proving public DSP headers do not expose JUCE.
- [x] 1.5 Add DSP tests as a separate test binary or explicitly aggregate them into the existing synth test binary, and keep the `test` target running all synth test binaries.

## 2. Math and Channel Numbers

- [x] 2.1 Port Smart Grid table-backed math into a precision-parameterized synth DSP math template.
- [x] 2.2 Add tests for multiple math table precisions, periodic sine/cosine behavior, tangent/polar helpers, root-of-unity lookup, and Hann kernel interpolation.
- [x] 2.3 Implement `NaryNumber<T, Size>` with indexed access, elementwise arithmetic, scalar arithmetic, `ModOne`, `Sum`, and `Average`.
- [x] 2.4 Add stereo and quad aliases for float and double, plus tests for alias size, arithmetic, wrapping, sum, and average behavior.
- [x] 2.5 Audit the new DSP code paths so processing code uses synth DSP math rather than direct standard-library trig except during table initialization.

## 3. Filters, Tanh, and DSP Class Pattern

- [x] 3.1 Add a synth transfer-function interface for DSP UI states.
- [x] 3.2 Implement one-pole low-pass and high-pass DSP classes with input structs, process functions, alpha helpers, output state, and static transfer-function helpers.
- [x] 3.3 Add filter UI states and `PopulateUIState` behavior for response visualization.
- [x] 3.4 Implement the cubic rational tanh saturator with optional gain normalization if needed by the ported design.
- [x] 3.5 Add tests for low-pass convergence, high-pass constant rejection, transfer-function helper sanity, tanh clamping, and tanh formula behavior.

## 4. Flat Scope Writer and Reader

- [x] 4.1 Port scope writer, holder, reader, and reader factory concepts into a flat-channel synth scope API.
- [x] 4.2 Implement `ReserveChans(numChans)` with contiguous block allocation, holder base channel, holder channel count, and bounds validation.
- [x] 4.3 Implement sample writes, relative channel writes, index advance, publish, start marker recording, and end marker recording.
- [x] 4.4 Implement scope readers that use published indices and marker history to align cycles for UI drawing.
- [x] 4.5 Add tests for reservation order, relative-channel writes, wraparound reads, publish stability, marker alignment, empty reader behavior, and invalid reservation handling.

## 5. Wavetable Core

- [x] 5.1 Port `BasicWaveTableGeneric` with wrapped phase evaluation, interpolation, writes, amplitude/RMS helpers, normalization, and waveform generation helpers.
- [x] 5.2 Port the FFT/DFT and adaptive mipmapped wavetable generation with precision-parameterized math.
- [x] 5.3 Implement adaptive wavetable level selection from oscillator frequency and max frequency.
- [x] 5.4 Implement an n-way morphing wavetable over a list of adaptive wavetables with clamped `[0, 1]` position and adjacent-table interpolation.
- [x] 5.5 Add tests for wrapped basic-table lookup, generated shape invariants, DFT reconstruction, adaptive level selection, endpoint morphing, and adjacent morph crossfade.

## 6. Default Wavetables

- [x] 6.1 Add default 12-bit adaptive wavetable construction for sine, triangle, saw, and square while keeping the table precision template usable at other bit depths.
- [x] 6.2 Add a default morphing wavetable ordered sine, triangle, saw, square.
- [x] 6.3 Add tests for default morph table count/order, sine start value, triangle shape sign/slope invariants, saw half-cycle values, and square half-cycle sign changes.

## 7. Incrementer and Wavetable VCO

- [x] 7.1 Implement the total-phase incrementer with frequency input, double accumulated phase, wrapped phase access, and integer-crossing `top` output.
- [x] 7.2 Add incrementer tests for non-modulo total phase, wrapped phase derivation, top crossing, no crossing, negative or edge-case frequency decisions, and no alias-protection clamping.
- [x] 7.3 Implement `WavetableVco` with owned incrementer, morphing wavetable usage, inputs for frequency, phase offset, wavetable position, and max frequency.
- [x] 7.4 Add optional nullable scope writer holder support to `WavetableVco`, including sample writes and top marker recording.
- [x] 7.5 Add VCO color metadata, VCO UI state, and `PopulateUIState` with scope writer/source pointer, flat scope channel index, and color.
- [x] 7.6 Add VCO tests for phase-offset lookup, wavetable-position selection, scope writes, marker recording on top, null-scope safety, and UI-state publication.

## 8. JUCE Waveform Rendering

- [x] 8.1 Port Smart Grid's path drawer into the synth JUCE layer without pulling it into JUCE-free DSP headers.
- [x] 8.2 Implement `DrawWaveformFromScope` with scope reader input, color, min/max y mapping, drawing bounds, and optional indicator rendering.
- [x] 8.3 Implement `VcoWaveformComponent` whose constructor accepts a list of `WavetableVco::UIState*` and draws all connected VCO waveforms.
- [x] 8.4 Update `projects/synth/miniapp/Makefile` so JUCE waveform component sources and any rendering tests build.
- [x] 8.5 Add JUCE-side tests or lightweight geometry/rendering checks for y-range mapping, indicator position, multi-VCO drawing, and missing-scope skip behavior.

## 9. Miniapp DSP Integration

- [x] 9.1 Remove the current placeholder `Cutoff`, `Shape`, `Level`, `Spread`, `Fold`, and `Tone` miniapp parameter setup.
- [x] 9.2 Create one miniapp parameter group with two voices, three modulators, the needed scenes, and voice colors for the two VCO voices.
- [x] 9.3 Increase the miniapp visible encoder array and WRLD.Bldr profile visible encoder count from three to four.
- [x] 9.4 Create page one parameters Tune, Phase, Shape, and Volume, where Shape is the wavetable morph position, and assign them to both the first `ParameterManager` page and the first page bank.
- [x] 9.5 Create page two with only the existing sine/cosine LFO speed parameter and assign it to both the second `ParameterManager` page and the second page bank.
- [x] 9.6 Implement page selection by selecting the corresponding page bank into the miniapp's single bank slot, with unused page-two encoder cells disconnected.
- [x] 9.7 Preserve direct `BankSlot::UIState` binding for reusable encoder components and keep bank/page selection compatible with modulation-depth views.
- [x] 9.8 Instantiate two `WavetableVco` objects using the default sine/triangle/saw/square morphing wavetable and two reserved scope channels.
- [x] 9.9 Process both VCOs from the parameter values, publish the scope writer, populate VCO UI states, and display one `VcoWaveformComponent` bound to both VCOs.
- [x] 9.10 Preserve the existing profile-driven MIDI setup while updating visible encoder/page-bank routing to the new parameter set.

## 10. Miniapp Modulators and Tests

- [x] 10.1 Publish modulator 0 as the direct duophonic VCO outputs by voice, normalized from bipolar output to `[0, 1]`.
- [x] 10.2 Publish modulator 1 as the swapped duophonic VCO outputs by voice, normalized from bipolar output to `[0, 1]`.
- [x] 10.3 Keep the existing sine/cosine LFO as modulator 2 and drive its rate from the second page speed parameter.
- [x] 10.4 Update or replace `DemoModulation.hpp` and `DemoModulationTests.cpp` so tests cover the new LFO-speed helper and VCO-derived modulator mapping.
- [x] 10.5 Add miniapp initialization tests or focused helper tests proving one group, two voices, three modulators, page contents, and scope publication behavior.

## 11. Verification

- [x] 11.1 Run `make -C projects/synth test` and fix any failures.
- [x] 11.2 Run `make -C projects/synth/miniapp test` when `~/JUCE` is available, or record the documented missing-JUCE result.
- [x] 11.3 Run `make -C projects/synth miniapp` when `~/JUCE` is available, or record the documented missing-JUCE result.
- [x] 11.4 If the miniapp can be launched locally, smoke the UI for Tune, Phase, Shape, Volume, LFO speed, two VCO waveform traces, and unchanged MIDI open/close behavior.
- [x] 11.5 Update `openspec/changes/add-synth-dsp-classes/tasks.md` checkboxes as implementation tasks are completed.
