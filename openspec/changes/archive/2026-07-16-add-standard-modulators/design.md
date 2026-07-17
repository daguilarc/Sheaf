## Context

`ParameterGroup` already supports runtime voice counts, pointer-backed modulation sources, fifteen-source modulation views on a sixteen-position slot, and optional non-owning portable visualizers. The reusable processors exist separately: `GangedRandomLfoProcessor<VoiceCount>` has compile-time polyphony and requires explicit output adapter storage, while noise and constant processors are runtime-sized and expose stable source pointers directly.

MiniApp currently owns and registers one random gang, noise, and constant at indexes `3..5` beside app-specific sources at `0..2`. Braid4 has three differently shaped groups and only two app-specific sources at `0/1`; it has no modulator visualizers. Both applications therefore duplicate or omit generic source plumbing, and neither presents the intended fifteen-modulator MIN-16 topology.

## Goals / Non-Goals

**Goals:**

- Provide an explicit opt-in component for a standard fifteen-modulator group.
- Own every processor, input, adapter buffer, source pointer, metadata record, and visualizer whose lifetime registration depends upon.
- Allow all defaults to be changed before registration and freeze the effective configuration afterward.
- Keep per-sample processing bounded, allocation-free, lock-free, and independent of parameter-value update cadence.
- Adopt the component in MiniApp and in all three Braid4 groups without preserving old modulator indexes or saved depth data.

**Non-Goals:**

- Do not make standard modulators implicit members of every `ParameterGroup`.
- Do not convert the existing fixed-polyphony ganged random processor to runtime sizing.
- Do not add performer parameters for random timing, noise, or constant spread.
- Do not serialize standard-modulator configuration, random engine state, visualizer state, or source assignments.
- Do not migrate patches or provide aliases for former MiniApp/Braid4 modulator indexes.

## Decisions

### 1. Compose existing processors in `StandardModulators<VoiceCount>`

Add a focused reusable synth header containing a non-copyable, non-movable `StandardModulators<VoiceCount>`. Construct it with `ParameterGroup&` and retain that group as a non-owning pointer. Applications create it after their groups exist and retain it at an address-stable lifetime, for example through `std::unique_ptr` owned by the application core.

The wrapper owns four `GangedRandomLfoProcessor<VoiceCount>` objects, four `GangedRandomLfoInput` records, four `std::array<float, VoiceCount>` output rows and matching pointer rows, one `NoiseModulatorProcessor(VoiceCount)`, one `ConstantModulatorProcessor(VoiceCount)`, four predictive ganged-random visualizers, one noise waveform visualizer, and one constant bar visualizer. It exposes bounded inspection access needed by tests and applications while retaining the visualizers used by modulation-depth underlays.

This retains the existing compile-time storage and behavior of the random processor. A runtime-sized wrapper would require redesigning that processor and introduce unrelated allocation/storage work. Making `ParameterGroup` own the bundle would couple the generic parameter system to an opt-in selection of DSP sources and visualizers.

### 2. Use one editable configuration that freezes at registration

The wrapper configuration contains six registration indexes, six metadata records, four random inputs, and the random visualizer voice-color palette. A mutable configuration accessor is available only before successful registration; attempting to request mutable configuration afterward is a logic error. Read-only inspection remains available throughout the object's life.

Default source metadata is:

| Source | Name | Short name | Color | Index |
|---|---|---|---|---:|
| Random 0 | `Random 500 ms` | `Rnd .5` | Cyan | 0 |
| Random 1 | `Random 2 s` | `Rnd 2` | Blue | 1 |
| Random 2 | `Random 6 s` | `Rnd 6` | Indigo | 2 |
| Random 3 | `Random 16 s` | `Rnd 16` | Orange | 3 |
| Constant | `Constant` | `Const` | Yellow | 11 |
| Noise | `Noise` | `Noise` | White | 14 |

Random visualizers use the stable voice-identity palette Cyan, Orange, Green, Yellow, truncated to `VoiceCount`; if future use exceeds four voices, registration requires an explicitly supplied palette of exactly `VoiceCount` colors. All connected metadata is installed with `connected=true` and the wrapper-owned visualizer pointer.

The four default random inputs are derived rather than independently approximated. For waiting mean `W` and target sigma `T`, waiting is `(muSeconds=W, sigmaSeconds=0.3 * W, internalSigmaHz=0.2 / W)`, moving is `(muSeconds=W / 2, sigmaSeconds=0.3 * (W / 2), internalSigmaHz=0.2 / (W / 2))`, and `targetInternalSigma=T`:

| Random | `W` | Waiting `(mu, sigma, internal)` | Moving `(mu, sigma, internal)` | `T` |
|---:|---:|---|---|---:|
| 0 | 0.5 s | `(0.5, 0.15, 0.4)` | `(0.25, 0.075, 0.8)` | 0.1 |
| 1 | 2 s | `(2, 0.6, 0.1)` | `(1, 0.3, 0.2)` | 0.3 |
| 2 | 6 s | `(6, 1.8, 1/30)` | `(3, 0.9, 1/15)` | 0.2 |
| 3 | 16 s | `(16, 4.8, 0.0125)` | `(8, 2.4, 0.025)` | 0.1 |

The internal sigmas have inverse-second units and use the reciprocal of each phase mean.

### 3. Validate and register the complete lifetime bundle once

`Register()` requires the target group to have `VoiceCount` voices and exactly fifteen modulators. It validates all four random inputs, metadata required for connected sources, the voice-color count, active indexes in `0..14`, and uniqueness among active indexes before changing the group. Registration is atomic with respect to validation: invalid configuration installs no partial sources. A second call is a logic error.

For `VoiceCount > 1`, all six configured indexes are active. For `VoiceCount == 1`, constant remains owned but its index is excluded from active-index collision checks and no constant pointers, metadata, or visualizer are installed there; the slot remains disconnected unless the application separately owns it. This avoids publishing the constant processor's intentionally uninformative monophonic zero.

### 4. Separate preparation, sample processing, publication, and group updates

`Prepare(sampleRate)` prepares all four random processors and records a prepared lifecycle state. It rejects calls before registration and inherits the finite-positive rate requirement. `Process()` rejects use before preparation, advances each random processor once, copies its current voice outputs into the wrapper-owned stable rows, and advances noise once. Constant has no processing operation. The method performs no allocation, locking, system entropy acquisition, UI publication, or group update.

`PublishUiState()` publishes all four random processor snapshots at the application's existing UI/block boundary. `ParameterGroup::UpdateModValues()` deliberately remains application-owned so a caller chooses the precise point where every registered source, including application-specific sources, becomes visible.

MiniApp prepares at the host processing rate, calls the standard bundle once per audio sample immediately before its existing group modulation-value update, and publishes after each block. Braid4 prepares all three bundles at `4 * hostRate`, processes each bundle once per internal subframe before the three group updates, and publishes all three after the host block. Braid's existing application-specific outputs continue to have their documented one-internal-sample feedback delay.

### 5. Adopt a fifteen-source MIN-16 topology in both applications

MiniApp changes its group to fifteen modulators and expands its bank slot to all sixteen physical positions using the app's existing row-major physical-ID convention: position `0` is upper-left and position `15` is lower-right. Its twelve top-level parameters reserve `12 * (1 + 15) = 192` initial modulation-aware parameter slots. One `StandardModulators<2>` replaces direct random/noise/constant ownership and registration. Direct VCO, swapped VCO, and ordinary LFO move to indexes `4`, `5`, and `6`; their existing scope visualizers move with them.

At both the default `900x560` size and the supported `640x480` size, MiniApp stacks the VCO and ordinary-LFO scopes inside a bounded left region and lays out all sixteen encoder positions in a bounded right-side `4x4` grid whose cell dimensions derive from the available encoder area. Empty top-level positions remain disconnected placeholders. Modulation views continue mapping sources `0..14` to positions `0..14` and return to position `15`, including disconnected source gaps.

MiniApp removes the separate main-screen ganged-random panel and any MiniApp-only panel code or identifiers made unused by that removal. The standard bundle continues retaining random, constant, and noise visualizers so connected modulation-depth cells can render them as encoder underlays. Browser and JUCE backends continue consuming the same portable MiniApp node tree; the layout introduces no new rendering protocol.

Braid4 changes the stereo, quad, and mono groups to fifteen modulators. It owns `StandardModulators<2>`, `<4>`, and `<1>` respectively. Each group's audible source moves to `4` and its parallel LFO source to `5`; therefore the quad matrix feedback contract and stereo/mono normalized source contracts retain their signal behavior but change indexes. Group capacities must fit existing top-level registration plus every connected depth in one complete fifteen-position modulation view: stereo at least 19, quad at least 23, and mono at least 63 slots; larger existing capacities may remain. Additional persistent lazy depth controls continue using the existing storage-batch mechanism.

### 6. Represent disconnected sources as empty modulation-view positions

Opening a modulation view preserves one physical position for every configured modulator index, but materializes a depth parameter only when that index's `ModulatorMetadata.connected` is true. A disconnected index receives a bank cell with the correct encoder ID and a null parameter, reusing the existing empty-top-level-position behavior: UI state is disconnected and press, turn, Reset, and Random actions do nothing.

The bank's UI materialization helper checks source metadata before returning an existing depth or creating a new one. Explicit programmatic and legacy depth APIs remain unchanged, but the UI does not expose a depth attached to a disconnected source. Capacity preflight counts only connected missing depths.

Random Mod chooses only among connected source indexes. If a group has no connected sources, Random Mod is a no-op and does not request or create parameter storage. Source reconnection and saved-data migration are out of scope; disconnected indexes are fixed empty positions for this topology.

## Risks / Trade-offs

- [Four random processors plus visualizers increase per-group CPU and state] → Keep the wrapper opt-in, process exactly once per sample, publish atomics only at block boundaries, and include Braid4 release-budget regression coverage.
- [Registered raw pointers could dangle if the wrapper moves] → Delete copy/move operations and require app-owned address-stable retention through teardown.
- [Public defaults could be changed after pointers are registered] → Gate mutable configuration access on the pre-registration lifecycle state and validate everything before mutation.
- [Mono constant index could appear connected accidentally] → Exclude it from registration entirely and test null metadata/visualizer publication at index `11`.
- [Connected lazy depth controls can exhaust an undersized initial arena] → Recalculate application capacities for a complete fifteen-position view and retain the existing asynchronous storage-batch expansion for additional materialized controls.
- [Moving source indexes changes loaded modulation depths] → Treat the topology as intentionally breaking and add no migration, as requested.

## Migration Plan

Implement and test the reusable wrapper first, then migrate MiniApp, then Braid4. Update affected main specs and coverage documentation with the application changes. Rollback is a code rollback of the wrapper adoption and group shapes; saved data created with the new indexes is not translated in either direction.

## Open Questions

None. The MIN-16 slot count, template architecture, visualizer ownership, timing formulas, mono behavior, application indexes, and lack of saved-data migration are decided.
