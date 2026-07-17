## Context

Absolute encoders differ from relative encoders in two coupled ways. Their input byte asserts a position, and their output ring is itself stateful at that same position. Today MIDI output reads `Parameter::UIState::values[0]`, which is the smoothed post-modulation display center. Modulation therefore animates an absolute controller's ring; turning the controller then sends that animated position back as a new center. A second race lets output publish an older DSP snapshot after input has already asserted a newer position.

The parameter library already computes the correct control-domain quantity: the normalized scene/gesture center before modulation and display smoothing. The runtime already separates MIDI callbacks, the audio-thread `MessageInBus` consumer, audio-thread UI-state publication, and message-thread MIDI output polling. The design must preserve those boundaries, avoid audio-thread allocation and locks, survive controller processor rebuilds, and leave relative feedback unchanged.

The MF Twister implementation also contains a protocol error relevant to the debounce design. The official manual assigns the primary encoder value and primary LED-ring position to one message on zero-based channel `0`. Zero-based channel `4` is the shifted encoder and shifted ring, not a second indicator-position channel. Consequently there is only one primary position message to gate and debounce.

This design builds on the implemented `add-absolute-encoder-mode` change, specifically its exact normalized raw-center projection and `HandleSetAbsolute` proof. That earlier OpenSpec change is intentionally not archived by this proposal; it remains an explicit source-of-record dependency until separately synced or archived.

## Goals / Non-Goals

**Goals:**

- Make absolute hardware feedback represent the normalized scene/gesture control center, excluding modulation and display smoothing.
- Prevent position feedback derived from a pre-input DSP snapshot from being sent after a newer absolute input is accepted for queueing.
- Suppress the exact echo of a received 7-bit value after DSP acknowledgement while sending the acknowledged actual center when it differs.
- Acknowledge applied and deliberately rejected absolute messages so modifier rejection and routing changes cannot strand feedback.
- Preserve pending coordination across live profile processor rebuilds and support multiple controllers mapped to the same cell.
- Correct Twister primary-ring output without creating a separate cleanup project.

**Non-Goals:**

- Changing relative encoder input, its post-modulation output feedback, or `turnStep` behavior.
- Removing modulation animation from on-screen encoders or other controller protocols in relative mode.
- Adding Twister shifted-encoder support. This change stops writing the shifted channel unless such support is designed separately.
- Changing the exact-target scene/gesture projection specified by `add-absolute-encoder-mode`.
- Providing durable epochs across process restarts; epochs are runtime-local causal tokens.

## Decisions

### 1. Use one engine-owned absolute-feedback coordinator

The engine owns a fixed-capacity `AbsoluteFeedbackCoordinator` for the lifetime of the running instrument. It contains 4096 open-addressed route records, enough for the sender's eight live controller slots with 512 absolute routes each, while still permitting any distribution of those records across controller slots. Profile construction reserves each configured tracked absolute route before accepting input for it and gives matching input and output processors a non-owning interface to the record. Rebuilding processors does not recreate the coordinator, so an input already queued cannot lose its pending gate. Relative processors receive no active coordination path and never consult it.

Route records persist by key across rebuilds; matching routes reuse their records and pending state. If all 4096 records are occupied by distinct runtime-lifetime keys, a newly configured absolute route is untracked and fails closed: its mapped turn is consumed as a mapped controller message but no `ParamSetAbsolute` is queued. Its output uses ordinary raw-center debounce without an expectation until a record can be reserved. This preserves the causal contract for every accepted absolute position and avoids applying an input that could be immediately overwritten by stale feedback. Exhaustion is expected only after pathological configuration churn or an unsupported controller topology, but it is deterministic and tested rather than silently degrading to unsafe echo behavior.

Each configured absolute feedback route is identified by `(controllerSlot, parameterSlot, position)`. Its coordinator state contains:

- the latest expected nonzero 64-bit epoch;
- the received 7-bit value for that epoch;
- whether that expectation is unresolved; and
- a short per-route atomic guard used only by the MIDI callback and message-thread output processor.

Epoch `0` means “untracked.” An absolute message created outside the epoch-allocating encoder-input path retains the existing apply/reject routing but neither creates an output expectation nor advances a slot's processed epoch. All absolute encoders sharing a MIDI input bus allocate from one monotonically increasing engine counter, so comparisons remain meaningful even when several controllers address one cell. The counter does not wrap during one runtime lifetime.

The per-route guard makes input alerting and output position enqueueing linearizable. The input callback publishes a pending expectation while holding the guard, releases it, and only then exposes the message to DSP. The output processor holds the same guard while deciding and enqueueing that route's position message. Therefore a position enqueue is ordered either wholly before the input alert or wholly after it, in which case it observes the pending expectation. The guarded section is bounded, allocation-free, never runs on the audio thread, and contains only atomic state inspection plus the sender's nonblocking enqueue; `MidiSender::Enqueue` may briefly acquire its existing message-thread mutex but never waits for queue capacity or I/O.

Alternatives rejected:

- Giving the input processor a pointer to a concrete output processor would couple lifetimes and leave dangling state during profile rebuilds.
- Storing only a “last sent” byte in the output cache cannot distinguish a stale pre-DSP snapshot from an acknowledged rejection.
- A single parameter-owned epoch fails when bank or modulation-view routing changes between input and publication. The causal address is the visible slot cell, not the parameter object.
- An unguarded double-read of an atomic expectation still leaves a final check-to-enqueue race.

### 2. Establish expectation before queue visibility, and roll back failed pushes

For raw absolute byte `b` routed to cell `c`, the input processor:

1. allocates epoch `e > 0`;
2. under the route guard, saves the previous route state and publishes unresolved `(e, b)`;
3. pushes `ParamSetAbsolute(..., normalized=b/127, epoch=e)` to the MIDI input bus; and
4. if the bounded push fails, reacquires the guard and restores the saved state only if `e` is still the route's latest expectation.

Publishing before the queue push closes the stale-output window. Conditional rollback cannot erase a newer input. An output pass may conservatively skip while a failed push is being rolled back, but it cannot enqueue an incorrect value and does not mutate its value cache; after rollback the persistent coordinator and debounce state are exactly as before the failed input.

### 3. Acknowledge the slot route for every processed absolute message

`ParamSetAbsolute` carries its epoch through `MessageInBus`, `ParameterManager`, `BankSlot`, and `Bank`. The audio thread attempts the existing absolute edit and then records the processed epoch for `(slotIx, position)` regardless of whether the edit was applied, rejected by a modifier, found disconnected, or found no currently visible parameter. The slot owns this monotonically nondecreasing processed-epoch state because the slot position remains the causal route across bank and modulation-view changes.

The edit result and acknowledgement have distinct meanings:

- “processed” means DSP has made the final decision for that event;
- the raw center says what the route actually controls after that decision.

This is why rejected messages are acknowledged rather than silently dropped. Once acknowledged, output can compare the actual center with the asserted byte and correct the hardware if necessary.

### 4. Publish normalized raw center and processed epoch coherently

Every visible `Parameter::UIState` cell adds:

- `rawKnobValue`: one normalized `[0,1]` scene/gesture control center, before modulation, target/display smoothing, bipolar presentation conversion, and switch presentation; and
- `processedAbsoluteEpoch`: the latest absolute epoch processed for that slot position.

Both fields are copied inside the cell's existing odd/even revision transaction. Connected parameter cells compute `rawKnobValue` by normalizing the production `ComputeRawCenter(scene)` result through the parameter's range mapping. Disconnected cells publish a neutral raw value while still publishing the slot position's processed epoch. Existing per-voice `values`, spreads, min/max values, and colors retain their current semantics.

This deliberately publishes one control center rather than a per-voice value: scenes and gestures define the edited center, whereas modulation creates voice-specific output that an absolute knob must not capture. For a disconnected cell the neutral raw value is `0`, so resolving a pending expectation either suppresses an already-received zero or sends the same channel-0 zero required by normal blank feedback; there is no competing disconnected correction value.

### 5. Resolve pending feedback against the acknowledged actual byte

For each absolute output route, let coordinator state be expected epoch `E`, received byte `B`, and pending flag `P`. Let one coherent UI snapshot contain processed epoch `A` and normalized raw center `X`. Define

`Q(X) = round(127 * clamp(X, 0, 1))`.

Position output follows one compact state machine:

- If `P` and `A < E`, enqueue no position message and do not mutate the position cache.
- If `P` and `A >= E`, compute `V = Q(X)`. If `V == B`, enqueue nothing; otherwise enqueue `V` once as a correction. Then cache `V` and mark expectation `E` resolved, provided it is still the latest route expectation.
- If no expectation is pending, use ordinary value debounce against `V`.

Color and brightness fields are independent of the asserted absolute position, so they continue through their existing debounce while position feedback is gated. An unstable UI revision produces no position decision and leaves both coordinator resolution and value cache unchanged.

An enqueue failure on the correction path does not resolve the expectation or update the value cache, allowing a later output pass to retry. Exact-echo suppression needs no sender enqueue and may resolve immediately after the stable comparison.

Relative output bypasses this state machine and continues to quantize the existing post-modulation `values[0]` presentation.

### 6. Twister has one primary position path

Twister output uses the manual's zero-based channels:

| Channel | Meaning in this profile |
| --- | --- |
| `0` | Primary encoder value and primary LED-ring position |
| `1` | Encoder-switch RGB color |
| `2` | Encoder-switch RGB animation/brightness |
| `5` | Primary LED-ring animation/brightness |

The processor removes channel `4` position output and its `indicatorValue` cache member. Channel `4` remains reserved for a future explicit shifted-encoder feature. Naming uses `encoderRingValue`, `rgbColor`, `rgbBrightness`, and `ringBrightness`, and named channel constants replace ambiguous numeric comments. Initial or blank feedback therefore contains four debounced messages rather than five. Only `encoderRingValue` participates in absolute epoch gating.

### 7. Causal invariants and proof

The implementation maintains these invariants:

1. **Expectation-before-DSP:** if absolute message epoch `e` is visible to the audio consumer, every matching output route already exposes an unresolved expected epoch at least `e`.
2. **Processed-prefix:** a cell's published processed epoch `A` is the greatest epoch whose edit/apply-or-reject decision for that cell completed before the same snapshot's raw center was sampled.
3. **Snapshot coherence:** output observes `A` and `X` from one completed revision transaction or makes no position decision.
4. **Pending exclusion:** while the latest route expectation is `(E,B)` and a coherent snapshot has `A < E`, no position message can be enqueued for that route and its position cache cannot change.
5. **Resolution:** when `A >= E`, the pending route resolves to exactly `Q(X)`; equality with `B` suppresses output, inequality emits one correction before ordinary debounce resumes.
6. **Relative isolation:** relative input never creates an expectation, and relative output never reads `rawKnobValue` or an epoch.
7. **Twister uniqueness:** primary Twister position is emitted only on zero-based channel `0`.

**Proof of no stale post-alert position.** Consider any position enqueue and absolute input alert for the same route. Their guarded critical sections are totally ordered. If enqueue is first, it linearizes before the new physical assertion. If alert is first, invariant 1 publishes pending `E` before the DSP message can become visible; the later output section observes that state. Until DSP publishes `A >= E`, invariant 4 prohibits enqueue. Thus no position derived from the pre-input processed prefix can linearize after the alert.

**Proof of exact echo suppression.** The parameter core stores and computes both `RangeKind` variants in the same normalized `[0,1]` domain; bipolar conversion is presentation-only. For an applied absolute input byte `B`, `add-absolute-encoder-mode` therefore guarantees the production raw center `X` matches `B/127` within the same normalized tolerance `epsilon = 1e-5`, without a variable native-range span. Hence `|127X - B| <= 127epsilon = 0.00127 < 0.5`, so rounding gives `Q(X) = B`. By invariant 5, acknowledgement resolves without enqueueing that byte. This proof also covers `B=0` and `B=127` because clamping preserves the endpoints.

**Proof of rejection correction.** A rejected event still advances `A` by invariant 2 while leaving the actual raw center `X` unchanged. If `Q(X) != B`, invariant 5 requires `Q(X)` to be enqueued regardless of the pre-input output cache, so the hardware is restored. If `Q(X) == B`, the hardware already represents the actual center and no correction is necessary.

**Proof for rapid and multi-controller input.** Epochs are globally increasing and each route retains only its latest unresolved expectation. If several events arrive before publication, a snapshot with `A` below the latest `E` remains gated; a snapshot with `A >= E` contains a processed prefix including that event and resolves against the latest received byte. For two controllers sharing one cell, each has independent `(E,B,P)` state but compares against the cell's global processed epoch and actual center. The controller that supplied the final actual value suppresses its echo; any other controller whose asserted byte differs receives a correction. Therefore overwriting older expectations cannot release stale feedback or leave either device at a knowingly incorrect acknowledged position.

## Risks / Trade-offs

- **[A short per-route guard can briefly delay a MIDI callback]** → Keep the section fixed-size and allocation-free, perform only nonblocking enqueue work inside it, and stress concurrent input/output in tests.
- **[A profile rebuild may alter route membership while an event is pending]** → Key coordinator state by stable controller slot plus logical cell route, preserve it in the engine, and initialize/reconcile configured routes without clearing matching pending state.
- **[Pathological runtime-lifetime route churn can exhaust the 4096 records]** → Reserve routes at profile construction and fail closed by consuming but not queueing input for an unreservable route; never fall back to an untracked absolute apply that violates causal feedback.
- **[A rejected event can cause a visible correction rather than silence]** → This is intentional: acknowledgement means the DSP decision is final, and the hardware must be restored to the actual center.
- **[Raw-center quantization may expose floating error]** → Use the same normalized range mapping as absolute input and `round(127*x)`; the exact-target tolerance is far inside the half-step proof bound.
- **[Removing channel `4` changes existing Twister output traffic]** → The removed traffic targeted the shifted encoder/ring contrary to the manual; tests pin the four correct channels and explicitly forbid primary position on channel `4`.

## Migration Plan

No persisted profile schema changes are required. Existing Twister profiles retain their mappings; after deployment they stop receiving the erroneous shifted-ring CC. Runtime construction adds the coordinator and rebuild wiring in one release. Rollback restores the former feedback implementation without data migration.

## Open Questions

None.
