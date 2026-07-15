## 1. Constant DSP Processor

- [x] 1.1 Add failing JUCE-free DSP tests for zero-voice rejection, one-voice zero, exact even and odd greedy assignments, floating-point-tolerant normalized rank coverage, representative cyclic-distance maxima, non-copyable/non-movable lifetime, bounds-checked inspection, and stable source-pointer addresses.
- [x] 1.2 Implement `ConstantModulatorProcessor` in a focused synth DSP header with constructor-only permutation/value/pointer initialization, immutable public inspection, no `Process()` operation, and no dependency on parameters or UI.
- [x] 1.3 Add a pointer-backed modulation integration test proving the processor's source-pointer span registers directly with an equal-voice-count `ParameterGroup` and publishes unchanged corresponding values across repeated modulation updates.

## 2. Portable Constant Visualizer

- [x] 2.1 Add failing portable UI tests for `ConstantBarVisualizer`: one filled rectangle per value in voice order, no extra commands, exact `[-0.1, 1.1]` zero/one framing, bounded positive geometry with narrow slots, retained color, invalid-bounds safety, and empty-span safety.
- [x] 2.2 Implement the JUCE-free visualizer with a borrowed immutable value span, retained color, equal horizontal voice slots, slot-relative gaps, and no `UIState`, scope, synchronization, labels, axes, or backend-specific types.
- [x] 2.3 Verify the visualizer obeys base component contracts for stable identity, intrinsic visibility, exact assigned bounds, repeated immutable draws, and draw-node composition beneath modulation-depth encoders; retain existing JUCE/browser fill-command parity.

## 3. MiniApp Sixth Modulator

- [x] 3.1 Add failing MiniApp system tests requiring a six-slot two-voice group with capacity 84, connected yellow `Constant` metadata and stable values `(0, 1)` at index `5`, a distinct retained constant bar visualizer, preservation of indexes `0` through `4`, and unchanged values across audio processing.
- [x] 3.2 Update `MiniAppCore` to retain a two-voice constant processor and its yellow bar visualizer, configure six modulator slots and capacity 84, and register the processor outputs and visualizer only at index `5` without adding a per-sample call or output copy.
- [x] 3.3 Update existing MiniApp topology, visualizer, encoder-color, and parameter-count assertions for the combined six-source system while preserving the separate three-instance scope-backed visualizer contract.

## 4. Verification and Documentation

- [x] 4.1 Update `projects/synth/docs/coverage.md` to map modified `sdsp-13` and `sdsp-33` plus new `sdsp-39`, `sdsp-40`, and `spv-8` to the DSP, portable UI, MiniApp system, and existing backend-parity tests.
- [x] 4.2 Run the focused DSP, portable UI, and MiniApp system test binaries during development, then run `make -C projects/synth test` and confirm the UI-boundary check and full JUCE-free suite pass.
- [x] 4.3 Run strict validation and status checks for both `add-noise-modulator` and `add-constant-modulator`, confirming the dependent active changes are valid and the constant change is apply-ready with every task complete.

## 5. Minimal Constant Presentation Polish

- [x] 5.1 Add failing portable UI tests requiring centered bars at exactly half their previous post-gap width and a default-preserving constant-only encoder-frame preference.
- [x] 5.2 Add failing encoder and MiniApp integration tests proving the constant chart omits exactly the outer rounded-rectangle frame while default visualizers retain it.
- [x] 5.3 Implement the visualizer frame preference, constant override, centered half-width bars, and MiniApp encoder-state wiring without changing DSP or other visualizer presentation.
