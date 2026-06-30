# Preserve Scope Fractional Top Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve fractional oscillator top-crossing positions through scope marker storage and reader alignment.

**Architecture:** Keep audio sample writes and ring-buffer indexing unchanged, but store scope cycle marker positions as `double`. `Incrementer` continues exposing `m_top` for existing callers and adds `m_topOffset`, which `WavetableVco` converts into a marker at `currentIndex - 1 + m_topOffset`.

**Tech Stack:** C++20 headers in `projects/synth/include/synth`, local test harness in `projects/synth/tests/dsp_tests.cpp`, OpenSpec change `preserve-scope-fractional-top-markers`.

---

### Task 1: Pin Fractional Marker Behavior With Tests

**Files:**
- Modify: `projects/synth/tests/dsp_tests.cpp`

- [ ] **Step 1: Add an incrementer offset regression test**

Add a test named `incrementer_reports_fractional_top_offset` that sets `Incrementer::m_phase = 0.75`, processes `.freq = 0.5`, and expects `m_top == true` with `m_topOffset == 0.5`.

- [ ] **Step 2: Add a scope marker alignment regression test**

Add a test named `scope_reader_aligns_fractional_start_markers` that records two start markers with offset `0.25`, publishes sample data, constructs `ScopeReader(&writer, holder.FlatChan(), 10)`, and expects `reader.Get(0) == 10.25` and `reader.Get(4.0) == 4.25`.

- [ ] **Step 3: Add a VCO marker regression test**

Add a test named `wavetable_vco_records_top_marker_at_true_cycle_boundary` that processes samples around a fractional top crossing and expects the reader's first sample to land at the sine zero-crossing.

- [ ] **Step 4: Verify the tests fail before implementation**

Run: `make -C projects/synth test`

Expected before implementation: failure because `Incrementer` has no `m_topOffset`, `RecordStart` cannot preserve fractional offsets, or reader alignment truncates marker positions.

### Task 2: Preserve Fractional Positions in DSP Code

**Files:**
- Modify: `projects/synth/include/synth/DspOscillators.hpp`
- Modify: `projects/synth/include/synth/DspScope.hpp`

- [ ] **Step 1: Add `Incrementer::m_topOffset`**

Add `double m_topOffset = 0.0;` next to `m_top`. In `Process`, reset it to `0.0`; when `m_top && input.freq > 0.0`, compute the first integer crossing with `std::floor(previous) + 1.0` and clamp `(crossing - previous) / input.freq` to `[0.0, 1.0]`.

- [ ] **Step 2: Make marker APIs accept floating offsets**

Change `ScopeWriterHolder::RecordStart` / `RecordEnd` and `ScopeWriter::RecordStart` / `RecordEnd` from `std::size_t uBlockIndex` to `double uBlockOffset`, storing `static_cast<double>(index_) + uBlockOffset`.

- [ ] **Step 3: Store marker arrays as doubles**

Change `startMarkers_` and `endMarkers_` to `std::vector<std::vector<double>>`, initialize open end markers with `std::numeric_limits<double>::quiet_NaN()`, and have `LatestEnd` check `!std::isnan(end)`.

- [ ] **Step 4: Keep reader alignment in double precision**

Change `ScopeReader`'s `startIndex_`, `endIndex_`, `postTransferIndex_`, and `transferXSample_` to `double`. Compute `cycleLength`, `elapsed`, transfer boundary, and read indexes without converting marker positions to integers.

- [ ] **Step 5: Pass the VCO top boundary into scope recording**

When `WavetableVco::Process` sees `m_top`, call `m_scopeWriterHolder->RecordStart(0, m_incrementer.m_topOffset - 1.0)` if that marker has a previous sample to interpolate from.

### Task 3: Verify and Synchronize OpenSpec

**Files:**
- Modify: `openspec/changes/preserve-scope-fractional-top-markers/tasks.md`

- [ ] **Step 1: Run synth tests**

Run: `make -C projects/synth test`

Expected: parameter modulation tests and DSP tests pass, including `scope_reader_aligns_fractional_start_markers`, `incrementer_reports_fractional_top_offset`, and `wavetable_vco_records_top_marker_at_true_cycle_boundary`.

- [ ] **Step 2: Run miniapp tests**

Run: `make -C projects/synth/miniapp test`

Expected: `Encoder geometry tests passed` and `Demo modulation tests passed`.

- [ ] **Step 3: Mark OpenSpec tasks complete**

Update every checkbox in `openspec/changes/preserve-scope-fractional-top-markers/tasks.md` from `[ ]` to `[x]` after the implementation and verification commands pass.

- [ ] **Step 4: Confirm OpenSpec status**

Run: `openspec status --change "preserve-scope-fractional-top-markers"` and `openspec instructions apply --change "preserve-scope-fractional-top-markers" --json`.

Expected: planning artifacts are complete and implementation task progress is complete.
