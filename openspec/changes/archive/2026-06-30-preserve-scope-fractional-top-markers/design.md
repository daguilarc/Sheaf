## Context

The previous fractional-reader change keeps draw/read coordinates continuous once a `ScopeReader` is constructed. The marker path still quantizes earlier: `Incrementer` reports only `m_top` as a boolean, `WavetableVco` calls `RecordStart()` with no offset, and `ScopeWriter` stores markers as `std::size_t`.

In the miniapp, each VCO sample is written before `scopeWriter_.AdvanceIndex()`. The VCO increments phase before evaluating and writing the sample at writer index `I`, so the top crossing occurs on the segment between the previous sample and the current sample. If phase crosses the top `f` of the way from the previous sample to the current sample, the scope marker should be recorded as `I - 1 + f`.

## Goals / Non-Goals

**Goals:**

- Preserve fractional top-crossing offsets from the incrementer through VCO scope recording.
- Store scope start/end marker positions as `double`.
- Let `ScopeReader` align cycles from fractional marker positions without rounding back to whole samples.
- Keep scope sample storage, channel reservation, and publish index semantics unchanged.

**Non-Goals:**

- Change oscillator audio generation or wavetable phase evaluation.
- Add temporal smoothing or averaging to the waveform UI.
- Rework marker drawing visual style.

## Decisions

1. Add a top-crossing offset to `Incrementer`.

   `Incrementer` keeps `m_top` for existing boolean checks and adds a floating-point offset in `[0, 1]` for the first integer phase crossing during the current sample. For positive frequency, the offset is `(floor(previous) + 1 - previous) / freq`, clamped to `[0, 1]`. Keeping the boolean avoids broad call-site churn while carrying the missing precision.

2. Store scope marker arrays as `double`.

   `ScopeWriter` start/end marker buffers should store absolute writer positions as doubles. End markers can use `NaN` as the unclosed sentinel. The writer's sample buffer remains indexed by `std::size_t`; interpolation already handles floating-point reads.

3. Record VCO starts at the true boundary between previous and current samples.

   `WavetableVco::Process` should call `RecordStart(0, m_incrementer.m_topOffset - 1.0)` when `m_top` is true and a previous sample exists. That records the top position on the interval ending at the current post-increment sample, matching the miniapp's write-then-advance loop. If a crossing happens on the first recorded sample and the offset would point before the buffer's usable history, skip that marker because the scope cannot interpolate the true boundary yet.

## Risks / Trade-offs

- Off-by-one convention for top offset -> Tests pin the miniapp convention: processing at current writer index `I` records the crossing at `I - 1 + offset`.
- Multiple top crossings in one sample at high frequencies -> Record the first crossing in the sample, matching the existing single-marker-per-sample behavior.
- NaN end-marker sentinel misuse -> `LatestEnd` should check `std::isnan` and only return closed marker positions.
