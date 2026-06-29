## Context

`projects/synth` currently contains a JUCE-free parameter/modulation library,
MIDI controller processors, synth tests, JUCE component helpers, and a miniapp
that demonstrates parameter pages, banks, scenes, gestures, and MIDI feedback.
It does not yet contain reusable audio DSP classes. The miniapp still behaves
like a parameter demo: it owns placeholder parameter groups and computes an
ad-hoc sine LFO in `timerCallback`.

The sibling repository `/Users/joyo/theallelectricsmartgrid` already contains
many of the desired algorithms and UI patterns:

- `Math.hpp`, `BasicWaveTable.hpp`, and `AdaptiveWaveTable.hpp` provide
  table-backed trig, FFT-derived band-limited levels, and wavetable evaluation.
- `Filter.hpp` provides one-pole low-pass/high-pass filters, transfer-function
  helpers, and the cubic rational tanh approximation
  `x * (27 + x * x) / (27 + 9 * x * x)`.
- `StereoUtils.hpp` and `QuadUtils.hpp` provide channel vector convenience
  types, but with duplicated 2-channel and 4-channel implementations.
- `ScopeWriter.hpp` provides circular scope storage, top/end markers, readers,
  and reader factories, but indexes by `(scopeIx, voiceIx)`.
- `PathDrawer.hpp` and `ScopeComponent.hpp` provide a 1024-point JUCE path
  drawer and marker rendering from `ScopeReader`.

The Sheaf port should use those algorithms, but make the API reusable and
native to the current synth project: C++20, tests under `projects/synth/tests`
for JUCE-free code, JUCE-only tests under `projects/synth/miniapp` where needed,
and no new runtime dependency.

## Goals / Non-Goals

**Goals:**

- Define the canonical Sheaf synth DSP class pattern.
- Add JUCE-free DSP library modules for math, channel values, filters, scope
  writing/reading, adaptive wavetables, morphing wavetables, incrementers, tanh,
  and wavetable VCOs.
- Use table-backed synth math for DSP trig instead of calling ordinary trig from
  DSP code after initialization.
- Generalize Smart Grid's stereo/quad helpers into an n-ary number type while
  keeping convenient aliases for stereo/quad float/double.
- Replace Smart Grid's scope `(scopeIx, voiceIx)` addressing with flat reserved
  channel blocks.
- Add a JUCE waveform drawing layer that can render one or more VCO scopes.
- Rework the miniapp into a natural consumer of the DSP library: one duophonic
  VCO parameter group, three modulators, and one shared waveform pane.

**Non-Goals:**

- No alias-protected incrementer. The requested incrementer intentionally
  accumulates total phase and exposes integer crossing without modulo-one state.
- No full audio engine, plugin processor, or real-time audio callback for the
  miniapp in this change. The miniapp may continue to drive demo processing from
  its timer or existing control loop.
- No hardware-specific WRLD.Bldr changes beyond preserving the existing
  profile-driven MIDI setup.
- No wholesale port of Smart Grid visualizer/page infrastructure.
- No polyphonic scope object per voice. Scope channels are flat reservations so
  one writer can cover one internal sample rate.

## Decisions

### Define DSP classes by stateful instance, input struct, and `Process(Input&)`

A DSP class in Sheaf synth should be a small stateful type that owns all
processing memory and output state. Runtime inputs are carried in a nested
`Input` struct, and processing happens through `Process(Input&)` or
`Process(const Input&)` depending on whether input smoothing/state helpers need
mutation. Outputs that downstream DSP or UI needs are stored on the instance
with names such as `m_output`, `m_top`, or type-safe accessors.

When a class has UI-visible state, it should define a nested `UIState` with
atomic fields or immutable pointers suitable for non-audio thread reads, plus
`PopulateUIState(UIState&) const`. Filter-like UI states that support response
drawing should inherit from the synth transfer-function interface and implement
`FrequencyResponse` and `TransferFunctionValue`.

Alternative considered: stateless functions returning sample values. That is
too weak for phase accumulators, filters, scopes, and UI-state publication.
Smart Grid's class pattern maps better to reusable instruments and avoids
threading state through every call site.

### Add a focused DSP module set rather than one large header

Create small public headers under `projects/synth/include/synth`, likely:

- `DspMath.hpp`
- `DspNumbers.hpp`
- `DspTransferFunction.hpp`
- `DspFilters.hpp`
- `DspScope.hpp`
- `DspWavetable.hpp`
- `DspOscillators.hpp`

Move non-template definitions and default wavetable construction into
`projects/synth/src` as needed. Update `projects/synth/Makefile` so the library
and tests build these sources.

Alternative considered: copy Smart Grid headers as-is. That would preserve
fixed typedefs, global names, and Smart Grid-specific assumptions that Sheaf is
explicitly trying to turn into a reusable environment.

### Generalize math table precision by template parameter

Port Smart Grid's `MathGeneric<Bits>` as `DspMath<Bits>` or equivalent. The
table size stays `1 << Bits`, but no fixed `Math` and `Math4096` pair should be
the only supported options. Provide convenient aliases for default precision if
useful, but algorithms should be written against the template.

The table initializes cosine values, root-of-unity values, and Hann kernels.
DSP classes use `DspMath<Bits>::Sin2Pi`, `Cos2Pi`, `TanPi`, `Polar`, and FFT
helpers instead of ordinary trig. Initialization code may use standard library
trig to populate tables.

Alternative considered: use `std::sin`/`std::cos` directly until performance
requires tables. The user explicitly asked DSP to use the copied trig, and the
wavetable FFT path already benefits from consistent table-backed roots.

### Use one `NaryNumber<T, Size>` with aliases

Replace Smart Grid's split `StereoFloat` and `QuadNumber` pattern with one
`NaryNumber<T, Size>` supporting indexed access, arithmetic, scalar operations,
`ModOne`, `Sum`, and `Average`. Add aliases such as `StereoFloat`,
`StereoDouble`, `QuadFloat`, and `QuadDouble`.

Size-specific helpers may be constrained where they only make sense, such as
stereo pan and quad pan/rotate. This keeps the common math generic while still
preserving familiar names for users porting from Smart Grid.

Alternative considered: copy `StereoUtils.hpp` and `QuadUtils.hpp` directly.
That duplicates operator logic and fails the requested n-ary shape.

### Keep one-pole filters simple and UI states optional

Port the one-pole low-pass and high-pass filters from `Filter.hpp` with
`Input` structs carrying normalized cutoff or alpha inputs as appropriate. The
classes should expose alpha setters and static transfer-function methods. Their
UI states inherit from the synth transfer-function interface when the filter is
used in a visualization context, following Smart Grid's `DampingFilter::UIState`
pattern.

Alternative considered: start with a state-variable filter. The request asks
for basic one-pole low-pass and high-pass first. More complex filters can later
reuse the same DSP/UI-state pattern.

### Adapt scope storage to flat channel reservations

Port `ScopeWriter`, `ScopeWriterHolder`, `ScopeReader`, and
`ScopeReaderFactory`, but replace `(scopeIx, voiceIx)` addressing with a single
flat channel index. A `ScopeWriter` owns a fixed circular sample buffer and
per-channel start/end marker rings. During synth or miniapp initialization,
each owner calls `ReserveChans(numChans)` once for each required channel block.
The returned holder records `baseChan` and `numChans`, and can write relative
channels later.

`Publish()` publishes the writer index and advances marker indices. The miniapp
must call publish after processing so the UI reads a stable snapshot. This lets
one writer represent an internal sample rate without allocating one writer per
polyphonic voice.

Alternative considered: preserve Smart Grid's scope and voice dimensions. That
works for Smart Grid's fixed topology, but it is the shape the user explicitly
wants to retire.

### Port adaptive wavetables but make morphing n-way

Port `BasicWaveTableGeneric`, `DiscreteFourierTransformGeneric`, and
`AdaptiveWaveTable` as template-backed Sheaf types. The default table factory
should create sine, triangle, saw, and square base tables, generate mipmapped
levels, and normalize consistently.

Unlike Smart Grid's two-table `MorphingWaveTable`, Sheaf's
`MorphingWaveTable` should own or reference a list of mipmapped wavetables and
map position in `[0, 1]` across adjacent tables. Position `0` selects the first
table and `1` selects the last table; inputs outside `[0, 1]` should clamp.
Evaluation uses the current oscillator frequency and max frequency to choose
the adaptive level and then crossfades between neighboring tables.

Alternative considered: keep a two-table morph and chain it externally. That
would make the default sine-to-triangle-to-saw-to-square VCO awkward and less
testable.

### Make the incrementer total-phase based

Add an `Incrementer` DSP class whose `Input` contains `freq` in cycles per
sample. Its state is a `double m_phase` containing total accumulated phase, not
modulo-one phase. Each process increments phase by `freq`, stores wrapped phase
separately for consumers if useful, and sets `m_top` true when the increment
crosses an integer boundary relative to the previous total phase. It does not
perform alias protection.

Alternative considered: copy Smart Grid's simple `VCO` phase wrap. The request
calls out total accumulated phase and integer-crossing behavior because the
scope and VCO need stable top markers.

### Build `WavetableVco` from incrementer plus morphing wavetable

`WavetableVco` owns an `Incrementer`, a `MorphingWaveTable` reference or value,
color metadata, and an optional nullable `ScopeWriterHolder*`. Its `Input`
contains `freq`, `phaseOffset`, `wavetablePosition`, and likely `maxFreq`.
`Process(Input&)` processes the incrementer, wraps the incrementer's total phase
plus phase offset to `[0, 1)`, evaluates the morphing wavetable using frequency
and position, writes output to the scope when configured, and records start/end
markers from `m_top`.

Its `UIState` publishes the VCO's reserved scope channel index, color, and
scope pointer or reader factory data required to render its waveform.

Alternative considered: make the VCO own its scope writer. Scope ownership
belongs to the app/synth sample-rate domain; VCOs should only hold a nullable
holder so the same DSP class works headless in tests.

### Keep JUCE waveform drawing thin

Port Smart Grid's `PathDrawer` into `projects/synth/juce`, then expose
`DrawWaveformFromScope(juce::Graphics&, ScopeReader&, Color, float minY,
float maxY, bool drawIndicator, juce::Rectangle<float>)` or an equivalent
signature that includes drawing bounds. The function maps `minY..maxY` into the
component bounds and draws the optional indicator from the reader's transfer
sample.

`VcoWaveformComponent` receives a list of `WavetableVco::UIState*`, creates a
reader for each connected scope channel, and draws all waveforms in their
published colors. It should tolerate missing scopes or disconnected UI states by
skipping that VCO.

Alternative considered: put waveform drawing into the miniapp component. A
small JUCE helper keeps rendering reusable while leaving DSP code JUCE-free.

### Rebuild the miniapp as a DSP consumer

The miniapp should create one `ParameterGroup` with two voices and three
modulators. Page 1 contains Tune, Phase, Shape, and Volume. Page 2 contains only
the speed parameter for the existing sine/cosine LFO, which can remain ad hoc.
The miniapp should show four encoder components so page 1 can expose all four
VCO parameters at once.

For this change, a miniapp "page" is both a `ParameterManager` page for metadata
and a corresponding bank selected into the existing single `BankSlot`, because
the current reusable encoder components bind to `BankSlot::UIState` cells rather
than directly to `Page` objects. Selecting page 1 selects the bank containing
Tune, Phase, Shape, and Volume. Selecting page 2 selects the bank containing
only LFO Speed, leaving the remaining encoder cells disconnected. The new Shape
parameter is the wavetable morph position, not the old placeholder switch-shaped
parameter.

The miniapp owns two `WavetableVco` instances using the default sine/triangle/
saw/square morphing wavetable. Each timer/process step reads the page
parameters, computes per-voice VCO inputs, processes the two VCOs, publishes the
scope writer, and populates UI state. It writes modulators as:

- modulator 0: VCO outputs by voice, normalized from bipolar wavetable output
  to `[0, 1]` with `(sample + 1) * 0.5`;
- modulator 1: swapped VCO outputs by voice with the same normalization;
- modulator 2: existing sine/cosine LFO by voice.

The first visible pane should include one `VcoWaveformComponent` bound to both
VCO UI states. Existing MIDI controller profile wiring can stay, but its visible
encoder count must become four and page-bank routing should control the new
parameter set.

Alternative considered: build a parallel miniapp screen just for DSP. Replacing
the placeholder demo better proves the library is natural to use.

## Risks / Trade-offs

- [Porting FFT and static table code can introduce subtle normalization or
  indexing regressions] -> Add focused tests comparing sine/table evaluation,
  FFT reconstruction, level selection, and default wave shapes against known
  invariants rather than only relying on audio inspection.
- [Scope writer buffering is large and easy to misuse] -> Keep constructor
  capacity explicit, bounds-check reservation, and test channel allocation,
  wraparound reads, top markers, and publish behavior.
- [UI state can accidentally expose audio-thread-owned mutable objects] ->
  Publish only atomics, stable pointers, and indices; keep ownership in the
  miniapp/synth object graph.
- [Template-heavy DSP headers can slow builds] -> Keep heavy default
  instantiations and default wavetable factories in `.cpp` files where practical.
- [The miniapp still has no real audio callback] -> Treat this change as a DSP
  library and UI demonstration step; audio-device integration can be a later
  capability.

## Migration Plan

The change is additive except for the miniapp demo content. Existing
parameter-modulation and MIDI APIs remain available. Implement the JUCE-free DSP
library first with tests, add JUCE waveform rendering second, then replace the
miniapp placeholder parameters with the VCO patch. Rollback is to remove the new
DSP modules and restore the previous miniapp parameter group setup from git.

## Open Questions

- The miniapp processing cadence can remain timer-driven for this change, but a
  future audio app should move VCO processing to an audio callback.
