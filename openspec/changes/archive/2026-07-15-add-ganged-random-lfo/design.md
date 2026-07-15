## Context

The synth DSP library already has double-precision phase accumulation, a table-backed `DefaultDspMath::Cos2Pi`, atomic UI-state publication patterns, and backend-neutral visualizers. MiniApp currently has two DSP voices, three modulation sources, a two-panel waveform row, and stable visualizer instances for materialized modulation-depth cells.

The new processor is not a conventional periodic oscillator. One round consists of a per-voice wait followed by one shaped move from source to target. The voices share statistically related duration and target centers, finish at different times, and start the next round together only after every voice is done. The visualizer must reconstruct the complete round—including its future—from current state rather than recorded scope samples.

The pseudocode contains two intentional-level ambiguities that need binding:

- `shape * shapedT` is interpreted as `shape * smoothT` so shape crossfades between linear and cosine-smoothed time.
- Both epsilon expressions use `max`, not `min`; `min(epsilon, abs(sample))` would collapse almost every duration/increment to epsilon. The outer normal is over center time in seconds, but the per-voice normal is over increment rate centered at the reciprocal of that sampled time, so internal sigma has rate units rather than time units.

## Goals / Non-Goals

**Goals:**

- Provide small, independently testable interpolation, center-time/increment-sampling, voice-state-machine, ganged-processor, snapshot, and drawing boundaries.
- Preserve strong but imperfect cross-voice correlation in timing and targets while keeping per-voice shapes independent.
- Keep all timing, progress, sampled duration, and increment calculations in `double` so multi-second and much slower configurations remain stable; narrow progress only at the float output-shaping boundary.
- Keep per-sample DSP allocation-free and make randomness reproducible in tests.
- Render a whole round from snapshot state with voice-specific colors, a shared time axis, solid past, dashed future, and present dots.
- Demonstrate the processor in MiniApp as a fourth, two-voice modulation source without adding performer controls.

**Non-Goals:**

- A parameterized module, bank/page controls, patch persistence, tempo sync, host automation, or runtime editing of the metaparameters.
- Recording or retaining past rounds.
- Crossfading between independently running rounds or starting a new round before the slowest voice finishes.
- A new portable draw-command dash protocol.

## Decisions

### 1. Sample center time, then sample voice rates around its reciprocal

For each waiting or moving population, sample one shared center time

`centerSeconds = max(samplePeriod, abs(N(muSeconds, sigmaSeconds)))`

convert that draw to the shared center rate

`centerRateHz = 1 / centerSeconds`

then sample every voice's rate around the reciprocal center and convert it to cycles per sample:

`epsilonIncrement = 1 / (sampleRate * 3600 seconds)`

`increment[i] = max(epsilonIncrement, abs(N(centerRateHz, internalSigmaHz)) / sampleRate)`.

The sample period floors the center-time draw before reciprocal conversion. The concrete epsilon is the per-sample progress needed to finish one phase in at most one hour, so a voice's wait-plus-move round lasts at most two hours (apart from at most process-boundary rounding). This is a deliberately permissive set-and-forget bound: it allows gestures far slower than the MiniApp's nominal two-second settings while preventing a draw arbitrarily close to zero from stalling the gang forever. All intermediate time, rate, and per-sample increment values remain `double`.

The second, folded normal has nonzero density near a rate of zero. Transforming those small rates into durations creates a heavy right tail, and because a new round waits for every voice, the slowest draw controls gang turnover and the chance of a very long round increases with voice count. The one-hour-per-phase floor truncates that pathological tail at an operationally finite bound without changing the requested two-stage distribution away from the extreme near-zero region. For the two-voice MiniApp configuration (`0.5 Hz` center rate and `0.125 Hz` internal sigma), reaching the bound is a far-tail event, while deliberately much slower configurations remain usable.

Alternatives considered:

- Sampling a per-voice time and then taking its reciprocal would keep all sigmas in seconds, but `N(centerTime, internalSigma)` followed by division is not the requested normal distribution over increments and does not commute with reciprocal conversion.
- Multiplying the center rate by a log-normal voice factor guarantees positivity and gives elegant relative spreads, but changes the requested normal/additive increment model.

The normal-over-time followed by normal-over-rate model is therefore the public contract. Negative normal draws are reflected with `abs`; invalid configuration values such as non-finite numbers, negative sigmas, or non-positive sample rate are programming/configuration errors rather than silently repaired.

### 2. Keep the voice deterministic and place all randomness in the gang

`GangedRandomLfoVoice` owns `State { Waiting, Moving, Done }`, double `currentStateProgress`, float `source`, `target`, and `output`; its default state is `Done`. Its input holds float shape plus double waiting and moving increments. `Reset(target)` changes the state to `Waiting`, zeros progress, moves the previous target into source, and installs the new target.

Processing follows the requested state machine. Waiting adds the waiting increment, changes to `Moving` at or above one, zeros progress, and outputs source. Moving adds the moving increment, evaluates interpolation with progress clamped to one, and changes to `Done` with exact target output at or above one. Done outputs target. This makes overshoot safe and guarantees outputs remain in the source/target convex hull.

`GangedRandomLfoProcessor<VoiceCount>` owns a fixed `std::array` of voices and matching voice inputs. Its process input contains waiting and moving triples of `(muSeconds, sigmaSeconds, internalSigmaHz)` plus target internal sigma. It processes all voices first. If they are then all done, it samples the next round and resets all voices together; consequently the call that completes the slowest voice still returns the completed round's targets, and the next call begins waiting. The default-done construction uses this same boundary behavior to seed the first round without a separate initialization path.

The gang owns the random engine. Construction accepts an entropy seed for application use, while an explicit seed/test random source makes unit tests reproducible. Distribution objects and fixed arrays do not allocate in `Process`. No module wrapper is added.

Round creation has one canonical logical draw order so deterministic sources and tests observe the same hierarchy: (1) waiting center time, (2) waiting voice-rate draws in ascending voice order, (3) moving center time, (4) moving voice-rate draws in ascending voice order, (5) target center, (6) target draws in ascending voice order, and (7) shape draws in ascending voice order. Each shape is sampled independently and uniformly in `[0,1]`. Tests bind this logical draw order through an injected draw source rather than assuming a standard-library normal distribution consumes a fixed number of engine values.

### 3. Use the fast cosine helper for a linear-to-smooth interpolation primitive

`ShapedInterpolate(x, y, shape, t)` accepts `t` as a `double` and clamps it in double precision to `[0,1]`. At the float output-evaluation boundary it narrows the clamped progress for the float `DefaultDspMath::Cos2Pi` call and float interpolation math, computes

`smoothT = 0.5 - 0.5 * DefaultDspMath::Cos2Pi(0.5 * t)`

and blends time with `shapedT = shape * smoothT + (1 - shape) * t` before interpolating between float `x` and `y`. Shape zero is linear; shape one is the cosine ease. No narrowed value is written back to the voice: accumulated progress and all state-transition comparisons remain double precision. The helper is pure, endpoint-preserving, and shared by DSP processing and predictive drawing so their curves cannot drift.

### 4. Publish a coherent predictive snapshot, not scope history

The gang maintains a double round-elapsed sample count in addition to the actual voice fields. Its UI state publishes sample rate, round elapsed samples, and for every voice: state, state progress, source, target, output, shape, waiting increment, moving increment, and color. Publication uses an odd/even atomic revision transaction; the visualizer retries a bounded number of times and emits no voice geometry for an unstable read rather than combining two rounds. The repository already contains this publication pattern, but the implementation SHALL NOT assume there is a reusable revision helper: if none fits, the gang snapshot owns a small local/new revision transaction.

Round elapsed time is gang-level because a voice that finishes early no longer has enough local state to locate the shared present while it holds target for the slowest voice. Each voice has an assignable color that is copied into the snapshot so the drawing can match that voice's visual identity; this design does not require the visualizer's immediate caller to supply it. There is no sample buffer or prior-round state.

### 5. Reconstruct the full shared-axis round analytically

The reusable `GangedRandomLfoVisualizer` reads one gang UI state and derives each voice's planned wait and move sample counts from its increments (`ceil(1 / increment)`) and sample rate. The x-axis spans zero to the maximum `wait + move` duration across voices. Each voice path is source through its wait, the shared `ShapedInterpolate` curve through its move, then target through the shared axis endpoint when that voice finishes early.

All voices use the same present x coordinate from gang round-elapsed time. The path up to that coordinate is emitted as a complete polyline, the path after it as alternating short polyline segments, and a filled voice-colored dot marks the reconstructed path value evaluated at that same shared present x. The dot deliberately does not use the snapshot's actual `output` field as its y coordinate, because doing so could put it off the displayed predictive path. Integer process boundaries use `ceil(1 / increment)`, while the voice discards phase remainder when changing states; consequently comparisons at wait/move boundaries allow sub-sample and drawing-geometry tolerance rather than requiring bit-exact coincidence. This implements dashes using current portable commands and avoids changes to JUCE, browser, serialization, and command-buffer protocols. A bounded fixed geometry resolution makes drawing cost independent of audio duration.

Recording a scope and extrapolating it was rejected because it cannot know future targets or durations and directly contradicts the no-recording requirement. Copying and simulating live processors in the UI was rejected because it would duplicate state-machine logic and RNG ownership. Analytic reconstruction from a coherent snapshot is host independent and agrees with the model within the stated process-boundary and drawing tolerances.

### 6. Integrate one two-voice gang into MiniApp

MiniApp adds `GangedRandomLfoProcessor<2>`, configures cyan and orange voice colors, supplies the negotiated sample rate in `PrepareToPlay`, and processes it once per audio sample before `UpdateModValues`. Its two unipolar outputs become modulator index `3`; the group modulator count and parameter capacity are increased as required without adding top-level parameters, pages, banks, or controls.

Waiting and moving both use `muSeconds=2.0`, `sigmaSeconds=0.5`, and `internalSigmaHz=0.125`; target internal sigma is `0.1`. The `0.125 Hz` value is the local first-order conversion of a `0.5 s` spread around `2 s`: `sigmaRate ≈ sigmaTime / meanTime² = 0.5 / 4`. The gang publishes its UI state at the same block boundary as existing module state. One address-stable predictive visualizer instance is owned by MiniApp and registered on modulator `3` for modulation-depth underlays. The main waveform row becomes three panels—VCO scope, ordinary LFO scope, and ganged-random-LFO round—with the main panel built directly from the same snapshot so one visualizer object is not assigned two placements.

## Risks / Trade-offs

- [Reflected normal sampling folds negative center-time and voice-rate tails and therefore is not an ordinary truncated normal] → Preserve the requested `abs(normal(...))` semantics explicitly and test both distribution stages rather than claiming truncation.
- [Folded-normal voice rates can land arbitrarily close to zero, producing heavy-tailed durations, and gang turnover is gated by the slowest voice] → Floor progress at `1 / (sampleRate * 3600 seconds)` so each phase is bounded to one hour and each two-phase voice round to two hours, and test the bound and slowest-gate behavior explicitly.
- [A large internal rate sigma can produce a per-sample increment at or above one] → Clamp state progress for interpolation, finish exactly at target, and cover one-sample/overshoot transitions and finite output in tests.
- [The standard normal distribution's exact sequence can differ across standard-library implementations] → Test deterministic injected draws and invariant relationships; do not golden-test implementation-specific distribution bytes.
- [Atomic snapshots can be observed during publication] → Use a revision transaction and bounded retry instead of accepting a torn round.
- [A third MiniApp waveform panel reduces horizontal room] → Use the existing bounded portable geometry, test default and resized layouts, and retain all three panels without adding scrolling.
- [Random sampling occurs on the audio thread at round boundaries] → Own fixed storage, seed before audio starts, avoid locks/I/O/heap allocation in `Process`, and add a real-time structural test or allocation guard around repeated round turnover.

## Migration Plan

1. Add and test the pure math and sampling primitives.
2. Add and test the deterministic voice and ganged processor, including UI snapshot publication.
3. Add and test portable round geometry and the concrete visualizer.
4. Wire the two-voice instance, fourth modulation source, snapshot publication, and three-panel visualization into MiniApp.
5. Update synth coverage documentation and run JUCE-free DSP/UI tests, MiniApp system tests, and relevant portable backend protocol/render tests.

Rollback removes the fourth MiniApp source and the new standalone DSP/visualizer types; no saved data or external configuration requires migration.

## Open Questions

None. The unit ambiguity, epsilon behavior, round-boundary ordering, snapshot consistency, and MiniApp placement are bound by the decisions above.
