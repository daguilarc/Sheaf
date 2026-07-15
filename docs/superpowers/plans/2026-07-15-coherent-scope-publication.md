# Coherent Scope Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep scope waveforms visible while an audio block is in flight by exposing cycle-start markers only with a compatible published sample boundary.

**Architecture:** `ScopeWriter` will retain audio-thread-only pending marker counts per channel. `RecordStart` writes into the pending portion of the marker ring, while `Publish` stores the sample boundary first and then releases pending marker-count advances. `ScopeReader` captures one published marker count before loading the sample boundary and uses that count for all marker lookups in the reader snapshot.

**Tech Stack:** C++20 header-only DSP utilities, custom JUCE-free synth test harnesses, OpenSpec Markdown requirements, Makefile verification, xagent Claude Opus review.

## Global Constraints

- Preserve flat channel reservation and relative-channel holder APIs.
- Preserve fractional marker offsets, floating-point reader coordinates, and transfer interpolation.
- Add no locks, allocation, or copying to steady-state sample writes or publication.
- Keep pending marker counters audio-writer-owned and non-atomic.
- Publish the sample boundary before publishing marker-count advances.
- A reader must load one marker count and use it for latest-start, previous-start, and latest-end lookups.
- Do not add a Braid4-only rendering workaround.

---

### Task 1: Reproduce and Fix Coherent Scope Publication

**Files:**
- Modify: `projects/synth/tests/dsp_tests.cpp:478`
- Modify: `projects/synth/tests/portable_ui_tests.cpp:257`
- Modify: `projects/synth/include/synth/DspScope.hpp:76`

**Interfaces:**
- Consumes: `ScopeWriter::RecordStart`, `ScopeWriter::Publish`, `ScopeReader::ScopeReader`, and `BuildScopeWaveformCommands`.
- Produces: unchanged public APIs with new internal `pendingMarkerCounts_` state and coherent reader snapshots.

- [ ] **Step 1: Add the failing DSP regression**

Add this test after `scope_reader_stitches_previous_cycle_after_latest_partial_cycle`:

```cpp
TEST_CASE(scope_reader_ignores_unpublished_cycle_start_markers) {
    synth::ScopeWriter writer(1, 64);
    auto holder = writer.ReserveChans(1);

    holder.RecordStart();
    for (std::size_t ix = 0; ix < 10; ++ix) {
        holder.Write(static_cast<float>(ix));
        writer.AdvanceIndex();
    }
    holder.RecordStart();
    for (std::size_t ix = 10; ix < 15; ++ix) {
        holder.Write(static_cast<float>(ix));
        writer.AdvanceIndex();
    }
    writer.Publish();

    const synth::ScopeReader published(&writer, holder.FlatChan(), 10);
    REQUIRE_TRUE(!published.Empty());
    REQUIRE_NEAR(published.Get(0), 10.0f, 0.0001f);

    holder.RecordStart();
    for (std::size_t ix = 15; ix < 18; ++ix) {
        holder.Write(static_cast<float>(ix));
        writer.AdvanceIndex();
    }

    const synth::ScopeReader whileWriting(&writer, holder.FlatChan(), 10);
    REQUIRE_TRUE(!whileWriting.Empty());
    REQUIRE_NEAR(whileWriting.Get(0), published.Get(0), 0.0001f);

    writer.Publish();
    const synth::ScopeReader afterPublish(&writer, holder.FlatChan(), 10);
    REQUIRE_TRUE(!afterPublish.Empty());
    REQUIRE_NEAR(afterPublish.Get(0), 15.0f, 0.0001f);
}
```

- [ ] **Step 2: Add the failing portable waveform regression**

After the existing left/right waveform geometry checks, add a one-channel scope whose third start marker remains unpublished:

```cpp
    synth::ScopeWriter inFlightScope(1, 128);
    auto inFlightHolder = inFlightScope.ReserveChans(1);
    inFlightHolder.RecordStart();
    for (std::size_t frame = 0; frame < 32; ++frame)
    {
        inFlightHolder.Write(std::sin(static_cast<float>(frame) * 0.2f));
        inFlightScope.AdvanceIndex();
    }
    inFlightHolder.RecordStart();
    for (std::size_t frame = 0; frame < 16; ++frame)
    {
        inFlightHolder.Write(std::sin(static_cast<float>(frame) * 0.2f));
        inFlightScope.AdvanceIndex();
    }
    inFlightScope.Publish();

    const std::vector<synth::ui::WaveformLayerDrawState> inFlightLayer{
        {.connected = true, .scopeColor = synth::Color::Red, .scope = &inFlightScope, .scopeChannel = 0},
    };
    inFlightHolder.RecordStart();
    inFlightHolder.Write(0.25f);
    inFlightScope.AdvanceIndex();
    const auto inFlightCommands = synth::ui::BuildScopeWaveformCommands(
        inFlightLayer, {10.0f, 120.0f, 180.0f, 90.0f}, -1.1f, 1.1f, 64, true);
    const bool inFlightHasPolyline = std::any_of(
        inFlightCommands.begin(), inFlightCommands.end(), [](const synth::ui::DrawCommand& command) {
            return command.kind == synth::ui::DrawCommand::Kind::Polyline;
        });
    Require(inFlightHasPolyline, "scope waveform remains visible while a new marker is unpublished");
```

- [ ] **Step 3: Build and run both tests to verify RED**

Run:

```bash
make -C projects/synth build/dsp_tests build/portable_ui_tests
projects/synth/build/dsp_tests
projects/synth/build/portable_ui_tests
```

Expected: both binaries build; `dsp_tests` fails at `!whileWriting.Empty()` and `portable_ui_tests` fails with `scope waveform remains visible while a new marker is unpublished`.

- [ ] **Step 4: Stage marker-count publication in `ScopeWriter`**

Initialize a pending count vector with the other writer storage:

```cpp
          endMarkers_(maxChannels, std::vector<double>(kNumMarkerIndices, std::numeric_limits<double>::quiet_NaN())),
          markerWriteIndices_(maxChannels),
          pendingMarkerCounts_(maxChannels, 0) {}
```

Replace `Publish`, `RecordStart`, and the count selection in `RecordEnd` with:

```cpp
    void Publish() {
        publishedIndex_.store(index_, std::memory_order_release);
        for (std::size_t channel = 0; channel < reservedChannels_; ++channel) {
            const std::size_t pending = pendingMarkerCounts_[channel];
            if (pending == 0) {
                continue;
            }
            const std::size_t published = markerWriteIndices_[channel].load(std::memory_order_relaxed);
            markerWriteIndices_[channel].store(published + pending, std::memory_order_release);
            pendingMarkerCounts_[channel] = 0;
        }
    }

    void RecordStart(std::size_t channel, double uBlockOffset = 0.0) {
        CheckChannel(channel);
        const std::size_t published = markerWriteIndices_[channel].load(std::memory_order_relaxed);
        const std::size_t count = published + pendingMarkerCounts_[channel];
        const std::size_t markerIndex = count % kNumMarkerIndices;
        startMarkers_[channel][markerIndex] = static_cast<double>(index_) + uBlockOffset;
        endMarkers_[channel][markerIndex] = std::numeric_limits<double>::quiet_NaN();
        ++pendingMarkerCounts_[channel];
    }

    void RecordEnd(std::size_t channel, double uBlockOffset = 0.0) {
        CheckChannel(channel);
        const std::size_t published = markerWriteIndices_[channel].load(std::memory_order_relaxed);
        const std::size_t count = published + pendingMarkerCounts_[channel];
        if (count == 0) {
            return;
        }
        endMarkers_[channel][(count - 1) % kNumMarkerIndices] = static_cast<double>(index_) + uBlockOffset;
    }
```

Add the private storage:

```cpp
    std::vector<std::atomic<std::size_t>> markerWriteIndices_;
    std::vector<std::size_t> pendingMarkerCounts_;
```

- [ ] **Step 5: Make `ScopeReader` consume one published marker snapshot**

At the start of the non-null constructor path, load the published marker count once, then load the published index:

```cpp
    const std::size_t markerCount =
        writer_->markerWriteIndices_[channel_].load(std::memory_order_acquire);
    const std::size_t publishedIndex = writer_->publishedIndex_.load(std::memory_order_acquire);
```

Replace the separate `LatestStart`, `LatestEnd`, and `PreviousStart` calls with direct lookups from `markerCount`:

```cpp
    if (markerCount == 0) {
        endIndex_ = static_cast<double>(publishedIndex > 0 ? publishedIndex - 1 : 0);
        startIndex_ = endIndex_ > static_cast<double>(numXSamples_)
            ? endIndex_ - static_cast<double>(numXSamples_)
            : 0.0;
        transferXSample_ = static_cast<double>(numXSamples_);
        hasPostTransfer_ = false;
        empty_ = endIndex_ <= startIndex_;
        return;
    }

    const double latestStart =
        writer_->startMarkers_[channel_][(markerCount - 1) % ScopeWriter::kNumMarkerIndices];
    startIndex_ = latestStart;
    const double latestEnd =
        writer_->endMarkers_[channel_][(markerCount - 1) % ScopeWriter::kNumMarkerIndices];
    if (!std::isnan(latestEnd) && latestEnd > latestStart) {
        endIndex_ = latestEnd;
    } else {
        endIndex_ = static_cast<double>(publishedIndex > 0 ? publishedIndex - 1 : 0);
    }

    double previousStart = 0.0;
    const bool hasPreviousStart = markerCount >= 2;
    if (hasPreviousStart) {
        previousStart =
            writer_->startMarkers_[channel_][(markerCount - 2) % ScopeWriter::kNumMarkerIndices];
    }
```

Use `hasPreviousStart && previousStart < latestStart` for the existing transfer-stitch branch. Leave interpolation arithmetic unchanged.

- [ ] **Step 6: Run focused tests to verify GREEN**

Run:

```bash
make -C projects/synth build/dsp_tests build/portable_ui_tests
projects/synth/build/dsp_tests
projects/synth/build/portable_ui_tests
```

Expected: both binaries exit `0`; the new DSP and portable waveform regressions pass.

- [ ] **Step 7: Commit the coherent publication implementation**

```bash
git add projects/synth/include/synth/DspScope.hpp projects/synth/tests/dsp_tests.cpp projects/synth/tests/portable_ui_tests.cpp
git commit -m "Fix coherent scope marker publication"
```

---

### Task 2: Specify the Shared and Braid4 Contracts

**Files:**
- Modify: `openspec/specs/synth-dsp-classes/spec.md:100`
- Modify: `openspec/specs/synth-braid-4/spec.md:115`

**Interfaces:**
- Consumes: the coherent `ScopeWriter` and `ScopeReader` behavior from Task 1.
- Produces: authoritative requirements for atomic cycle-start publication and Braid4 waveform continuity.

- [ ] **Step 1: Strengthen the shared scope publication requirement**

Replace the existing `Publish exposes stable read index` scenario with:

```markdown
#### Scenario: Publish exposes a coherent sample and marker boundary
- **WHEN** the scope writer records samples and cycle-start markers after its latest publish
- **THEN** readers continue to observe the previously published sample boundary and marker count
- **AND** a subsequent publish exposes the new sample boundary before exposing the pending marker-count advances
- **AND** a reader uses one published marker count for every marker lookup in that reader snapshot
```

Keep the existing marker-alignment scenario after it.

- [ ] **Step 2: Add the Braid4 in-flight rendering scenario**

After `Scope remains pre-gain`, add:

```markdown
#### Scenario: In-flight scope writes do not blank published traces
- **WHEN** Braid has published audible and LFO scope history
- **AND** a VCO records a new cycle-start marker while the next internal block is still in flight
- **THEN** portable scope rendering continues to draw the last published waveform
- **AND** the new cycle marker becomes visible only with a compatible published sample boundary
```

Extend requirement `d4-6`'s coverage list by changing `scope/UI publication` to `coherent scope/UI publication during in-flight block writes`.

- [ ] **Step 3: Check specification formatting and scope**

Run:

```bash
git diff --check
rg -n "coherent sample and marker|In-flight scope writes|coherent scope/UI" openspec/specs/synth-dsp-classes/spec.md openspec/specs/synth-braid-4/spec.md
```

Expected: `git diff --check` exits `0`; the search prints all three new contract phrases.

- [ ] **Step 4: Commit the specification updates**

```bash
git add openspec/specs/synth-dsp-classes/spec.md openspec/specs/synth-braid-4/spec.md
git commit -m "Specify coherent scope publication"
```

---

### Task 3: Verify and Run Claude Opus Review

**Files:**
- Review: `projects/synth/include/synth/DspScope.hpp`
- Review: `projects/synth/tests/dsp_tests.cpp`
- Review: `projects/synth/tests/portable_ui_tests.cpp`
- Review: `openspec/specs/synth-dsp-classes/spec.md`
- Review: `openspec/specs/synth-braid-4/spec.md`

**Interfaces:**
- Consumes: Tasks 1 and 2 plus the approved design document.
- Produces: verified implementation and an external findings-first architecture/correctness review.

- [ ] **Step 1: Run the complete synth verification**

Run:

```bash
make -C projects/synth test
```

Expected: every synth test target builds and exits `0`, including DSP, portable UI, Braid4 system, and Braid4 deadline tests.

- [ ] **Step 2: Run repository hygiene checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; status contains only intentional committed work or accepted review follow-ups.

- [ ] **Step 3: Run the requested xagent Claude Opus review**

Run from the worktree root:

```bash
plugins/xagent/scripts/xagent run --harness claude_code --model opus --subagent "Review the coherent scope-publication fix against docs/superpowers/specs/2026-07-15-coherent-scope-publication-design.md and the authoritative OpenSpec requirements. Inspect the branch diff and the files projects/synth/include/synth/DspScope.hpp, projects/synth/tests/dsp_tests.cpp, projects/synth/tests/portable_ui_tests.cpp, openspec/specs/synth-dsp-classes/spec.md, and openspec/specs/synth-braid-4/spec.md. Return findings first, ordered by severity, with concrete file and line references. Focus on C++ memory ordering, writer/reader snapshot coherence, realtime safety, marker-ring edge cases, regression-test adequacy, and spec compliance. Call out uncertainty rather than filling gaps. Do not modify files."
```

Expected: xagent exits `0` and returns an Opus findings-first review. Do not silently substitute another harness or model if the run fails.

- [ ] **Step 4: Address accepted findings test-first**

For each accepted behavioral finding, add or refine a failing focused regression, run it to verify RED, make the smallest production/spec correction, and rerun the focused tests. If the review has no actionable findings, make no changes.

- [ ] **Step 5: Run final verification**

Run:

```bash
make -C projects/synth test
git diff --check
git status --short
```

Expected: the full synth suite exits `0`, no whitespace errors are reported, and the worktree is clean.
