## 1. Absolute Event Coordination

- [ ] 1.1 Add focused failing tests, then implement the fixed-capacity engine-owned `AbsoluteFeedbackCoordinator`, global nonzero epoch allocation, guarded per-controller-route expectations, and queue-failure rollback without changing relative input.
- [ ] 1.2 Carry epochs through `ParamSetAbsolute` routing and make each addressed slot position record every processed apply-or-reject decision, including modifiers, disconnected cells, and routing/view changes.

## 2. Coherent DSP Publication

- [ ] 2.1 Add snapshot tests, then publish normalized pre-modulation scene/gesture `rawKnobValue` and the slot position's processed epoch inside the existing visible-cell revision transaction while preserving all current display-state semantics.

## 3. Absolute Output and Twister Protocol

- [ ] 3.1 Add causal-output tests, then implement pending-epoch gating, stable-snapshot resolution, exact received-byte suppression, forced rejection correction, enqueue retry, and normal debounce resumption for absolute routes only.
- [ ] 3.2 Correct Twister output in the same processor change: make channel `0` the sole primary encoder/ring position path, remove channel `4` position output and cache state, retain channels `1`, `2`, and `5`, introduce clear protocol names/constants, and update blank/reset expectations from five messages to four.

## 4. Integration and Verification

- [ ] 4.1 Wire coordinator lifetime through engine/profile rebuilds and add integration coverage for pending rebuilds, rapid input, shared-cell controllers, bank/modulation-view changes, unstable snapshots, modulation-free absolute feedback, and unchanged modulation-aware relative feedback.
- [ ] 4.2 Run focused and full synth tests, validate the OpenSpec change, and complete cross-provider spec/code review with all blocking findings resolved.
