# Preserve Scope Reader Fractional Samples Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make synth scope reading and waveform drawing preserve floating-point x-sample coordinates until the final linear interpolation buffer read.

**Architecture:** `ScopeReader` becomes a continuous-coordinate reader: `Get(double)` and `TransferXSample()` use floating-point reader-space positions, while `ScopeWriter::Read` remains the late integer-conversion/interpolation boundary. JUCE path drawing passes fractional render samples through to the reader and rounds only where marker drawing needs a concrete screen coordinate.

**Tech Stack:** C++20 header-only DSP utilities, existing custom synth test harness, Makefile-based tests, xagent with Claude review passes.

---

### Task 1: Scope Reader Tests

**Files:**
- Modify: `projects/synth/tests/dsp_tests.cpp`
- Reference: `openspec/changes/preserve-scope-reader-fractional-samples/specs/synth-dsp-classes/spec.md`

- [ ] **Step 1: Add failing fractional interpolation tests**

Add tests near the existing scope reader tests:

```cpp
TEST_CASE(scope_reader_uses_floating_point_sample_coordinates) {
    synth::ScopeWriter writer(1, 32);
    auto holder = writer.ReserveChans(1);

    holder.RecordStart();
    holder.Write(0.0f);
    writer.AdvanceIndex();
    holder.Write(10.0f);
    writer.AdvanceIndex();
    holder.Write(20.0f);
    writer.AdvanceIndex();
    holder.RecordEnd();
    writer.Publish();

    synth::ScopeReader reader(&writer, holder.FlatChan(), 3);
    REQUIRE_TRUE(!reader.Empty());
    REQUIRE_NEAR(reader.Get(0.5), 5.0f, 0.0001f);
    REQUIRE_NEAR(reader.Get(1.5), 15.0f, 0.0001f);
}

TEST_CASE(scope_reader_exposes_floating_point_transfer_boundary) {
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

    synth::ScopeReader reader(&writer, holder.FlatChan(), 10);
    REQUIRE_TRUE(!reader.Empty());
    REQUIRE_NEAR(reader.TransferXSample(), 4.5f, 0.0001f);
    REQUIRE_NEAR(reader.Get(3.5), 13.5f, 0.0001f);
    REQUIRE_NEAR(reader.Get(4.5), 4.5f, 0.0001f);
}

TEST_CASE(scope_reader_no_longer_exposes_integer_sampling_contract) {
    static_assert(std::is_same_v<decltype(std::declval<const synth::ScopeReader&>().Get(0.5)), float>);
    static_assert(std::is_same_v<decltype(std::declval<const synth::ScopeReader&>().TransferXSample()), double>);
}
```

Also add `#include <type_traits>` and `#include <utility>` if needed.

- [ ] **Step 2: Run tests and verify RED**

Run: `make -C projects/synth test`

Expected: compile failure because `TransferXSample()` still returns `std::size_t`, or runtime failures because `Get(0.5)` is truncated.

### Task 2: Scope Reader Implementation

**Files:**
- Modify: `projects/synth/include/synth/DspScope.hpp`
- Test: `projects/synth/tests/dsp_tests.cpp`

- [ ] **Step 1: Change reader API and state**

Change `ScopeReader` to:

```cpp
float Get(double xSample) const;
double TransferXSample() const { return transferXSample_; }
std::size_t NumXSamples() const { return numXSamples_; }
```

Change internal stitch fields:

```cpp
double postTransferIndex_ = 0.0;
double transferXSample_ = 0.0;
```

- [ ] **Step 2: Compute transfer boundary as floating point**

In the constructor, compute fallback transfer as `static_cast<double>(numXSamples_)`. In the stitched-cycle branch, compute:

```cpp
const double cycleLength = static_cast<double>(std::max<std::size_t>(1, latestStart - previousStart));
const double elapsed = static_cast<double>(endIndex_ > latestStart ? endIndex_ - latestStart : 0);
const double cycles = static_cast<double>(std::max<std::size_t>(1, numCycles));
transferXSample_ = std::min(static_cast<double>(numXSamples_), elapsed * static_cast<double>(numXSamples_ - 1) / (cycleLength * cycles));
postTransferIndex_ = static_cast<double>(previousStart) + std::min(elapsed, cycleLength);
hasPostTransfer_ = transferXSample_ < static_cast<double>(numXSamples_ - 1);
```

Adjust exact constants if the red tests show a clearer mapping, but preserve the contract: continuous reader coordinate, no early integer truncation.

- [ ] **Step 3: Implement continuous `Get(double)`**

Clamp and map with floating point:

```cpp
inline float ScopeReader::Get(double xSample) const {
    if (empty_ || !writer_ || numXSamples_ == 0) {
        return 0.0f;
    }
    const double maxSample = static_cast<double>(numXSamples_ - 1);
    const double clampedSample = std::clamp(xSample, 0.0, maxSample);

    double readIndex = static_cast<double>(startIndex_);
    if (!hasPostTransfer_ || clampedSample < transferXSample_) {
        const double denominator = std::max(1.0, transferXSample_);
        const double wayThrough = clampedSample / denominator;
        readIndex = static_cast<double>(startIndex_) + wayThrough * static_cast<double>(endIndex_ - startIndex_);
    } else {
        const double denominator = std::max(1.0, maxSample - transferXSample_);
        const double wayThrough = (clampedSample - transferXSample_) / denominator;
        readIndex = postTransferIndex_ + wayThrough * (static_cast<double>(startIndex_) - postTransferIndex_);
    }
    return writer_->Read(channel_, readIndex);
}
```

- [ ] **Step 4: Run tests and verify GREEN for DSP**

Run: `make -C projects/synth test`

Expected: DSP tests compile and pass.

### Task 3: JUCE Path Drawing

**Files:**
- Modify: `projects/synth/juce/PathDrawer.hpp`
- Test: `projects/synth/juce/EncoderComponentGeometryTests.cpp` or an existing focused JUCE test target if available

- [ ] **Step 1: Update `DrawScopePath`**

Use a floating-point transfer coordinate and pass the floating sample directly:

```cpp
const double transferSample = scopeReader.TransferXSample();
const double sample = static_cast<double>(j) * static_cast<double>(scopeReader.NumXSamples() - 1)
    / static_cast<double>(kNumPoints - 1);
const float y = (scopeReader.Get(sample) - minY) / denominator;
```

When deciding whether to start a new subpath, compare the render index to the rounded transfer marker or detect crossing:

```cpp
const bool crossesTransfer = j > 0
    && static_cast<double>(j - 1) * static_cast<double>(scopeReader.NumXSamples() - 1) / static_cast<double>(kNumPoints - 1) < transferSample
    && sample >= transferSample;
if (j == 0 || crossesTransfer) { ... }
```

- [ ] **Step 2: Update `DrawScopeMarker`**

Round/clamp only at drawing time:

```cpp
const double sample = std::clamp(scopeReader.TransferXSample(), 0.0, static_cast<double>(scopeReader.NumXSamples() - 1));
const float x = xMin_ + width_ * static_cast<float>(sample) / static_cast<float>(scopeReader.NumXSamples() - 1);
const float normalizedY = (scopeReader.Get(sample) - minY) / denominator;
```

- [ ] **Step 3: Run focused compile/test**

Run: `make -C projects/synth test`

Expected: core synth tests pass and headers compile. If a JUCE test target exists in the current environment, run that target too.

### Task 4: Verification, OpenSpec Sync, and xagent Reviews

**Files:**
- Modify: `openspec/changes/preserve-scope-reader-fractional-samples/tasks.md`
- Use: `projects/xagent`

- [ ] **Step 1: Build/install xagent dependencies**

Run: `make -C projects/xagent install build`

Expected: npm install succeeds and TypeScript builds.

- [ ] **Step 2: Run full verification**

Run:

```bash
make -C projects/synth test
make -C projects/xagent test
openspec status --change "preserve-scope-reader-fractional-samples"
```

Expected: synth tests pass, xagent tests pass, OpenSpec artifacts remain complete.

- [ ] **Step 3: Run Claude spec-compliance review through xagent**

Run from repo root:

```bash
node projects/xagent/dist/src/main.js run --harness claude_code --model claude-sonnet-4.8 --subagent "<prompt>"
```

Prompt: ask for findings first, ordered by severity, against `openspec/changes/preserve-scope-reader-fractional-samples/specs/synth-dsp-classes/spec.md`, `projects/synth/include/synth/DspScope.hpp`, `projects/synth/juce/PathDrawer.hpp`, and `projects/synth/tests/dsp_tests.cpp`.

- [ ] **Step 4: Run Claude code-quality review through xagent**

Run the same xagent command with a code-quality prompt focused on correctness, edge cases, test adequacy, and unwanted compatibility overloads.

- [ ] **Step 5: Address review findings and mark OpenSpec tasks complete**

Fix any accepted review findings, rerun relevant tests, then update `openspec/changes/preserve-scope-reader-fractional-samples/tasks.md` checkboxes only for completed/reviewed work.
