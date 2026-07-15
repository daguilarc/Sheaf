# Coherent Scope Publication Design

## Goal

Keep scope waveforms visible and stable while the audio thread writes the next
block by publishing sample boundaries and cycle-marker history as one coherent
reader contract.

## Current Problem

`ScopeWriter::Publish()` exposes only `publishedIndex_`. `RecordStart()` writes
a marker and immediately advances the atomic `markerWriteIndices_` cursor.
Consequently, a UI-thread `ScopeReader` can observe a cycle marker from the
in-flight audio block while it still observes the previous block's published
sample boundary. The resulting `startIndex_ > endIndex_` makes the reader empty,
and portable waveform drawing omits the trace until the next block publish.

Braid 4 makes the defect conspicuous because its four audible oscillators run
at increasing frequencies and its shared writer advances at four times the
host rate. Higher-frequency voices publish new markers near the beginning of
most blocks, so their readers are empty during most UI sampling instants.

## Considered Approaches

### Stage Marker Publication

Keep marker samples writable during audio processing, but stage the number of
new markers in audio-thread-owned counters. `Publish()` exposes the sample
boundary first and then advances each channel's atomic marker cursor. Readers
snapshot one published marker count and use it throughout construction.

This is the selected approach. It restores the invariant used by the original
All Electric Smart Grid scope system, retains the current flat-channel and
fractional-marker improvements, and adds only fixed-size per-channel counters
to the realtime writer path.

### Filter Future Markers in ScopeReader

The reader could inspect marker values and walk backward past markers newer
than `PublishedIndex()`. This would leave unpublished marker state visible and
would require additional concurrent ring traversal, making the contract harder
to reason about.

### Double-Buffered or Versioned Snapshots

The writer could publish an immutable metadata copy or use a seqlock around all
scope metadata. This provides a broader snapshot mechanism but introduces more
state and copying than this bounded marker-ring contract needs.

## Design

### Writer State

`ScopeWriter` will add one non-atomic pending marker count per reserved channel.
Only the audio writer thread accesses these counters. The existing atomic
`markerWriteIndices_` values become explicitly published marker counts.

`RecordStart(channel, offset)` will:

1. Load the channel's published marker count.
2. Add the channel's pending count to select the next marker-ring slot.
3. Store the fractional start marker and clear that slot's end marker.
4. Increment only the pending count.

`RecordEnd(channel, offset)` will address the latest marker using the combined
published and pending count, preserving the existing behavior for both
published and in-flight cycles.

### Publication Ordering

`Publish()` will expose `index_` through `publishedIndex_` before exposing any
pending marker counts. It will then advance each affected atomic published
marker count and clear the corresponding pending count.

The stores and reader loads will use release/acquire ordering. A reader that
observes a newly published marker is therefore guaranteed to observe the
sample boundary and marker contents published before it. A reader may safely
observe older marker history with a newer sample boundary, but it cannot
observe a marker newer than its sample boundary.

### Reader Snapshot

`ScopeReader` will load the channel's published marker count once, then load the
published sample boundary, and use that single count for the latest start,
previous start, and latest end lookups. It will not reload the marker cursor
through separate helper calls while constructing one reader.

No waveform interpolation, fractional top-marker, transfer-coordinate, or
flat-channel behavior will change.

## Tests

The DSP regression test will:

1. Write and publish enough samples and marker history for a non-empty reader.
2. Record a newer marker and additional samples without publishing.
3. Construct another reader and prove it remains non-empty and still uses the
   last published marker history.
4. Publish and prove a subsequent reader observes the new marker history.

Portable UI coverage will build waveform commands before and after an
unpublished marker and require that both command sets contain a waveform
polyline. This pins the visible symptom rather than merely checking that the
panel background and centerline exist.

Focused DSP and portable UI tests will run before the complete synth suite.

## Specification Updates

- `openspec/specs/synth-dsp-classes/spec.md` will state that sample boundaries
  and marker-count advances are published coherently, unpublished markers are
  invisible to readers, and one reader uses one marker-history snapshot.
- `openspec/specs/synth-braid-4/spec.md` will require scope rendering to remain
  non-empty while a subsequent internal block is in flight and will include
  this behavior in Braid 4 verification coverage.

## Review

After implementation and local verification, xagent will run a Claude Opus
review with findings first, ordered by severity, covering concurrency ordering,
realtime safety, tests, and specification compliance. Accepted findings will be
addressed and the affected verification rerun.

## Non-Goals

- No Braid4-only rendering workaround.
- No change to scope buffer capacity or channel topology.
- No change to waveform transfer interpolation or marker drawing geometry.
- No new locks, allocation, or copying on the steady-state audio path.
- No redesign of unrelated visualizer or UI-state publication systems.
