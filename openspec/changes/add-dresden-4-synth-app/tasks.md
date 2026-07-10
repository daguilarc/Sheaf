## 1. Reusable Bipolar Matrix Mixer

- [x] 1.1 Add failing module tests for `BipolarMatrixMixerModule<4>` row-major parameter names/order, bipolar metadata, `-1/-0.25/0/0.25/1` curve anchors, identity defaults, cross-routing, unclamped sums, stable output pointers, repeat-registration errors, compatible pre-populated mono-group registration, group-shape validation, and bank-capacity failures.
- [x] 1.2 Implement the positive-size `BipolarMatrixMixerModule<Size>` template in the JUCE-free module layer with fixed input/output arrays, monophonic parameter registration into any compatible group with sufficient capacity, identity defaults, row-major bank registration, natural gain mapping, and linear processing.
- [x] 1.3 Run the synth module test target and confirm all existing reusable-module behavior remains green.

## 2. Dresden 4 Reusable Module

- [x] 2.1 Add failing module tests for the `Dresden4VcoModule` three-group/two-scene registration contract, fourteen red parameters, zero-based bank positions with disconnected cells `2/3`, all parameter mapping anchors/ranges, registration atomicity/errors, sample-rate validation, per-VCO natural inputs, post-gain outputs, equal-power XY corners/center/squared-weight invariants, coherent-source gain behavior, and four scope/UI-state connections.
- [x] 2.2 Implement `Dresden4VcoModule` in the JUCE-free module layer with stored parameter IDs, explicit three-group/two-scene validation, sparse bank registration, four `DefaultWavetableVco` processors, Hz-to-cycles-per-sample conversion, cycle-domain `Phase * PM Index`, bipolar post-VCO Gain, four oscillator outputs, separable cosine/sine equal-power stereo XY output, scope-holder setters, and VCO UI-state publication; reserve `Dresden4LfoModule` as a future sibling name.
- [x] 2.3 Run module tests and add focused regression coverage proving negative Gain changes the matrix-facing sample while the raw scope remains connected to the pre-gain processor output.

## 3. Reusable Oversampling, Decimation, and Parameter Timing

- [x] 3.1 Add failing DSP tests for positive template dimensions, exact one-output-per-four-input cadence across arbitrary block splits, independent stereo history, deterministic reset, 287-tap symmetric impulse response/group delay, steady-state allocation freedom, and finite output.
- [x] 3.2 Add frequency-response tests for the Dresden coefficient set: 287-tap Kaiser-windowed-sinc FIR, `β=9`, unity DC gain, normalized ideal cutoff `11/96` cycles per internal sample, passband edge `5/48`, stopband edge `1/8`, no more than 0.1 dB passband ripple, and at least 90 dB stopband rejection.
- [x] 3.3 Implement the JUCE-free fixed-storage `FirDecimator<Factor, Channels, Taps>` (or equivalent name) with immutable coefficient input, persistent channel history/phase, reset, frame-at-a-time processing, and no allocation, locking, coefficient design, logging, IO, or buffer-sized copy in the processing path.
- [x] 3.4 Add the normalized Dresden coefficient table or pre-audio design helper, verify one coefficient set works unchanged at 44.1, 48, and 96 kHz host rates, and run the DSP test target.
- [x] 3.5 Add failing DSP tests for a reusable fixed-factor oversampled output stage: exact generator calls/indices `4H..4H+3`, one host frame per operation, decimator continuity across block splits, reset, statically bound heterogeneous generator types, and allocation-free processing.
- [x] 3.6 Implement the JUCE-free `OversampledOutputStage<Factor, Channels, Decimator>` (or equivalent composition) so clock/index/decimator mechanics are reusable while the caller-supplied templated generator owns internal graph ordering.
- [x] 3.7 Add failing parameter tests for reference-alpha/sample-interval rate conversion, invalid-rate rejection, 48→192 kHz anchors, valid timing installation, topology/value/storage preservation, repeated non-compounding prepare changes, and allocation freedom.
- [x] 3.8 Implement reusable parameter timing conversion helpers and a narrow pre-audio `ParameterGroup` timing reconfiguration API that mutates only the four processing-timing fields.

## 4. Shared Portable Waveform Drawing

- [x] 4.1 Add failing JUCE-free portable UI tests that capture current MiniApp scope-path behavior and verify four scope channels rendered into four non-overlapping bounds remain independently clipped.
- [x] 4.2 Extract generic scope-channel-to-draw-command logic into the shared portable UI builder layer without introducing JUCE or app-specific includes.
- [x] 4.3 Migrate MiniApp waveform command construction and the JUCE waveform adapter to the shared helper while preserving existing draw snapshots and backend tests.
- [x] 4.4 Run portable UI, MiniApp system, and JUCE backend parity tests for the extraction.

## 5. Dresden 4 JUCE-Free Application Core

- [ ] 5.1 Create `projects/synth/apps/dresden-4` with a JUCE-free `Dresden4Core`, `Dresden4` wrapper, portable UI model/draw files, and typed registration header; do not add a standalone `Main.cpp` or app target.
- [x] 5.2 Add failing Dresden headless system tests for exactly three groups with two scenes each, global endpoints `0/1` and one blend value across both banks, the matrix sharing the 24-parameter mono group, one sixteen-encoder slot, native per-cell voice counts, blank positions, red parameter state, and successful modulation-view materialization for all four quad controls.
- [ ] 5.3 Implement core initialization, including shared mono-group module registration, global two-scene setup, two-bank/one-slot wiring, a four-channel scope writer with four holders, the one-modulator matrix source on the quad group, the reusable oversampled stereo output stage, and a default sixteen-encoder controller profile with two scene selectors, one scene blend mapping, and two selectable banks.
- [x] 5.4 Add failing graph-clock tests proving each host frame executes exactly four parameter/VCO/matrix/modulator/scope subframes, internal sample indices follow `4 * hostSample + subframe`, raw matrix outputs are clamped/normalized to `[0,1]` only at the modulation-source adapter, matrix feedback is delayed one internal sample, and decimator state remains continuous across host blocks.
- [x] 5.5 Add failing prepare/rate tests at 44.1, 48, and 96 kHz for internal rates 176.4, 192, and 384 kHz, Hz-correct oscillator pitch, rate-correct one-pole alphas, target compute interval scaling, FIR output cadence, and delay/latency accounting.
- [x] 5.6 Implement `PrepareToPlay` and the audio loop so the internal rate is `4 * negotiatedHostRate`; all three groups process every internal subframe; VCOs, matrix, modulation publication, and scopes precede final stereo decimation; and exactly one left/right sample is written per host frame.
- [x] 5.7 Add equal-power XY corner/center/one-axis energy, coherent-source gain, identity/cross-matrix routing, matrix-source normalization anchors, finite extreme-gain, mono/extra-channel output policy, scope publication, and non-silent stereo system coverage before and after decimation.
- [x] 5.8 Add patch save/perturb/load coverage proving stereo, quad, oscillator-detail mono, and matrix values round-trip across the three groups, then run the JUCE-free Dresden system test target.

## 6. Dresden 4 Portable Main Screen

- [x] 6.1 Add failing portable UI/layout tests for a complete 2x2 waveform grid, a complete 4x4 encoder grid, a global two-scene selector/blend strip, stable node IDs, slot `0` position `0..15` turn/push bindings, disconnected Dresden cells `2/3`, matrix-bank state reuse, and scene-state continuity across bank switches.
- [x] 6.2 Implement the Dresden portable surface with responsive non-scrolling bounds, four independently scoped waveform draw nodes ordered by XY corner, sixteen row-major encoder nodes, one global scene strip, and near-black/red astronomical styling.
- [x] 6.3 Add the Dresden test targets and dependencies to `projects/synth/Makefile` with app-local include paths only for those targets, and verify the core/UI compile with no JUCE include path.

## 7. Generic Sheaf Patch Runtime Session Ownership

- [ ] 7.1 Add failing launcher/runtime harness coverage proving MiniApp can be created, displayed, and destroyed through one type-erased session-owner interface while retaining typed `RuntimeShellSession<MiniApp>` behavior and existing shutdown order.
- [ ] 7.2 Implement the minimal generic session-owner interface and templated holder/factory in the runtime layer, exposing component access and deterministic virtual destruction.
- [ ] 7.3 Migrate `SheafPatchApplication` from its MiniApp-specific session member and launch method to one generic active-session pointer and registration-driven launch path.
- [ ] 7.4 Run runtime shell/session and launcher harness tests before adding Dresden registration.

## 8. Dresden Registration and Sheaf Patch Integration

- [ ] 8.1 Add failing registry/launcher tests for sorted `dresden-4` metadata (`Dresden 4`, `Sheaf`, `synth`, sixteen encoders), typed launch, shared config path, `patches/dresden-4` isolation, and the absence of hardware gating.
- [ ] 8.2 Add the Dresden typed registration to Sheaf Patch, extend its header/build dependencies, and launch Dresden through the generic session factory without adding Dresden-specific runtime ownership to the launcher.
- [ ] 8.3 Update synth app documentation/build descriptions to list Dresden as Sheaf Patch-only, state that no standalone target is supplied, and document four-times-host internal processing plus final 4:1 FIR decimation.
- [ ] 8.4 Build the Sheaf Patch app and run its launcher harness with both MiniApp and Dresden registrations.

## 9. Verification and Spec Completion

- [ ] 9.1 Run `make -C projects/synth build test` and confirm all JUCE-free library, DSP, module, engine, rig, MiniApp, Dresden, and portable UI suites pass.
- [ ] 9.2 Run release-build deadline/continuity tests at 44.1, 48, and 96 kHz host rates, confirming four-times graph execution, exact 4:1 output counts, filter response bounds, continuous block-edge state, finite output, average callback CPU time no more than 25% of real-time block duration, and p99 callback CPU time no more than 50% of real-time block duration.
- [ ] 9.3 Run the relevant runtime/JUCE backend tests and build `make -C projects/synth sheaf-patch` with no new warnings.
- [ ] 9.4 Smoke-test Sheaf Patch startup, Dresden row activation, both parameter banks, finite stereo audio processing, four visible scopes, sixteen visible encoders, app-specific patch save/load, device-rate switching with pitch/time preservation, and clean shutdown; record hardware-only follow-ups separately.
- [ ] 9.5 Run strict OpenSpec validation for `add-dresden-4-synth-app` and mark completed task checkboxes only after their verification evidence exists.
