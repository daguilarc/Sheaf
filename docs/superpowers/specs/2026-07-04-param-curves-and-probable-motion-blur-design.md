# Parameter Curves And Probable Motion Blur Design

## Goals

- Keep parameter mapping families explicit: linear, exponential, zero-based exponential, and bipolar versions of each.
- Remove the discontinuous signed-minimum `GetBipolarExponential(minAbs, maxAbs)` behavior from the semantic family.
- Make zero-based exponential use `max * (pow(base, knob) - 1) / (base - 1)`, with a helper that derives `base` from an offline midpoint and max.
- Make encoder motion blur indicate the region the value probably visited around the smoothed UI center, not the entire min/max range and not an arbitrary fixed visual width.

## Parameter Mapping

The supported mapping family is:

- `GetLinear(min, max, voice, id)`
- `GetExponential(min, max, voice, id)`
- `GetZeroBasedExponential(max, midpoint, voice, id)`
- `GetBipolarLinear(maxAbs, voice, id)`
- `GetBipolarExponential(left, center, right, voice, id)`
- `GetBipolarZeroBasedExponential(maxAbs, midpointAbs, voice, id)`

`GetZeroBasedExponential(max, midpoint, ...)` remains source-compatible, but internally computes a base from `midpoint / max` and evaluates the base curve. Modules that want no runtime midpoint-to-base work can call `ZeroBasedExponentialBaseFromMidpoint(midpoint, max)` once and then call `ZeroBasedExponentialMap(knob, base, max)`.

The old two-endpoint `GetBipolarExponential(minAbs, maxAbs, ...)` is not part of the intended family because it jumps from exact zero to `minAbs` for any nonzero knob value. Existing callers should use `GetBipolarZeroBasedExponential(maxAbs, midpointAbs, ...)` for signed zero-based depth, or the positive `(left, center, right)` overload for positive bipolar curves.

## Motion Blur

The UI state already publishes a smoothed center and an RMS-like spread. The renderer should treat the center as the visible slow value and the spread as a probable visited band. For mixed modulation, a subaudio LFO moves the center at a visible rate while audio-rate modulation widens the band around that moving center.

The motion indicator uses one continuous rendering path. Its arc half-width in normalized knob units is `spread * kProbableSigma`, clamped to the knob domain at render time. Opacity and radial softness still increase gradually with spread, but the arc length is now driven by the actual UI spread instead of a fixed pixel maximum.

## Tests

- Parameter tests cover zero-based helper/base equivalence and bipolar zero continuity near zero.
- Encoder geometry tests cover spread-to-arc-width mapping, center anchoring, and continuous small-motion growth.
