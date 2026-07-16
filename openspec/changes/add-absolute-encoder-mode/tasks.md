## 1. Encoder Mode Contract and Compatibility

- [x] 1.1 Complete or rebase onto `rework-controllers-block-editing`, record a green focused synth/view-model baseline, and confirm its open-section edit-session APIs are the integration surface for this change.
- [x] 1.2 Add failing compile-time/unit and JSON tests for the `EncoderMode`/`mode` rename, all three declaration-order values, new `mode` serialization, authoritative-new-field behavior, and legacy `relativeMode` fallback.
- [x] 1.3 Rename repository C++ consumers from `EncoderRelativeMode`/`relativeMode` to `EncoderMode`/`mode`, add `Absolute`, and implement the compatible encoder-config JSON contract without changing built-in relative defaults.

## 2. Exact Absolute Parameter Mathematics

- [x] 2.1 Add failing pure-helper tests that independently reconstruct distinct latent locations and convex coefficients for endpoint/shared scenes, intermediate scenes, no gestures, partial gesture weights, multiple gestures, and active gestures that differ by scene endpoint.
- [x] 2.2 Add failing active-set projection tests for no-op, upward/downward movement, unipolar and bipolar ranges, upper/lower saturation redistribution, endpoint targets, coefficient aggregation, termination, minimum-change examples, and effective-target tolerance `1e-5`.
- [x] 2.3 Implement JUCE-free coefficient construction and the double-intermediate range-constrained active-set projection, with explicit invariants for positive coefficients, unit coefficient sum, finite targets, distinct storage locations, and bounded results.
- [x] 2.4 Add failing `Parameter::HandleSetAbsolute` tests proving same-message selected-gesture arming, the reachable case where arming changes the pre-solve value by reweighting other active gestures, exact endpoint/mid-blend results, active deselected gesture participation, saturation, unrelated-storage preservation, and production `ComputeRawCenter(scene)` agreement before target-center slew.
- [x] 2.5 Implement `Parameter::HandleSetAbsolute` by mapping the normalized target to the parameter range, sharing the established arming semantics without the relative early return, rebuilding coefficients after arming, applying the exact projection, and verifying the resulting raw scene/gesture center within tolerance before target-center slew.

## 3. Message and Visible-Cell Routing

- [x] 3.1 Add failing tests for `ParamSetAbsolute` construction, message JSON round trips, and bus application through `(slotIx, position)`, physical-encoder and slot routing, selected-bank dispatch, modulation-depth views, modifier gating, and absent/disconnected mappings.
- [x] 3.2 Add `ParamSetAbsolute` to `MessageIn`, its JSON name/payload handling, and exhaustive switches, then add parallel `HandleSetAbsolute` APIs through `ParameterManager`, `BankSlot`, and `Bank` so the currently visible parameter receives the owning manager's scene state.

## 4. MIDI Absolute Input

- [x] 4.1 Add failing MIDI input tests proving absolute raw CC values `0`, `64`, and `127` emit normalized `ParamSetAbsolute` values independent of `turnStep`, including timestamps and mapped slot/position.
- [x] 4.2 Implement absolute-mode turn decoding while preserving mapped/unmapped/thru behavior and keeping signed-7-bit and direction-only decode paths byte-for-byte behaviorally equivalent.
- [x] 4.3 Run the existing relative decoder, default Twister/WRLD.Bldr profile, profile factory, rig, and MIDI persistence tests as focused non-regression coverage.

## 5. Controllers Editor Integration

- [x] 5.1 Add failing view-model and portable Controllers-page tests for the three-entry `Encoder mode` catalog, absolute selection, non-deletable config row, retained relative-only `turnStep`, edit-session flush/rebuild stability, and live processor rebuild.
- [x] 5.2 Extend the current Controllers edit-session presentation and edit pipeline with the renamed encoder-mode row and absolute choice without introducing a second session or re-coalescing path.

## 6. Invariant and Completion Verification

- [x] 6.1 Add a deterministic independent model/property test over randomized scene blends, scene centers, gesture masks, gesture weights, gesture values, ranges, and targets that checks post-arming `ComputeRawCenter(scene)` error at most `1e-5` before target-center slew, range safety, same-message arming, and unrelated-storage preservation after every absolute edit.
- [x] 6.2 Update synth requirement-to-test coverage documentation for `spm-31`, `spm-52`, `spm-75`, `spm-76`, and `sru-26`, including the mathematical helper and randomized invariant tests.
- [x] 6.3 Run formatting/static checks, focused parameter/MIDI/view-model tests, the complete synth test target, and `openspec validate add-absolute-encoder-mode --strict`; resolve every failure before marking the change complete.
