## 1. Absolute Event Coordination

- [x] 1.1 Add focused failing tests, then implement the fixed-capacity engine-owned `AbsoluteFeedbackCoordinator`, global nonzero epoch allocation, guarded per-controller-route expectations, and queue-failure rollback without changing relative input.
- [x] 1.2 Carry epochs through `ParamSetAbsolute` routing and make each addressed slot position record every processed apply-or-reject decision, including modifiers, disconnected cells, and routing/view changes.

## 2. Coherent DSP Publication

- [x] 2.1 Add snapshot tests, then publish normalized pre-modulation scene/gesture `rawKnobValue` and the slot position's processed epoch inside the existing visible-cell revision transaction while preserving all current display-state semantics.

## 3. Absolute Output and Twister Protocol

- [x] 3.1 Add causal-output tests, then implement pending-epoch gating, stable-snapshot resolution, exact received-byte suppression, forced rejection correction, enqueue retry, and normal debounce resumption for absolute routes only.
- [x] 3.2 Correct Twister output in the same processor change: make channel `0` the sole primary encoder/ring position path, remove channel `4` position output and cache state, retain channels `1`, `2`, and `5`, introduce clear protocol names/constants, and update blank/reset expectations from five messages to four.

## 4. Integration and Verification

- [x] 4.1 Wire coordinator lifetime through engine/profile rebuilds and add integration coverage for pending rebuilds, rapid input, shared-cell controllers, bank/modulation-view changes, unstable snapshots, modulation-free absolute feedback, and unchanged modulation-aware relative feedback.
- [x] 4.2 Run focused and full synth tests, validate the OpenSpec change, and complete cross-provider spec/code review with all blocking findings resolved.

## 5. Generic Encoder Position Feedback

- [x] 5.1 Add focused processor, factory, engine, and rig tests, then implement automatic Generic encoder output derived from turn input mappings: send one debounced position CC on the same channel and CC, emit no appearance or protocol-specific traffic, reuse causal epoch gating/suppression/correction/retry in Absolute mode, retain post-modulation feedback in relative modes, preserve explicit specialized-output override compatibility and rebuild persistence, update coverage, run focused and full synth verification plus strict OpenSpec validation, and resolve all blocking cross-provider review findings.
