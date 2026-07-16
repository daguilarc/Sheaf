# Less-Predictable Standard Random Timing and MiniApp 4x4 Grid

## Context

The standard ganged-random modulators use two temporal distributions per source: one for the waiting phase and one for the moving phase. Each phase has an external center-time sigma in seconds and an internal rate sigma in hertz. The current defaults use ten percent of the phase mean for the external sigma and ten percent of the reciprocal phase mean for the internal sigma, which makes transition timing feel too predictable.

MiniApp now exposes a sixteen-position bank slot but its main surface still draws only seven encoder positions. Its separate main-screen ganged-random panel occupies space that can instead support the same complete 4x4 encoder grid used by Braid4.

## Standard Random Timing Defaults

For every standard random source, let `W` be its waiting mean. The target-value sigma remains unchanged.

- Waiting mean: `W`.
- Waiting external sigma: `0.3W` seconds, three times the current default.
- Waiting internal sigma: `0.2/W` hertz, twice the current default.
- Moving mean: `W/2`.
- Moving external sigma: `0.3(W/2) = 0.15W` seconds, three times the current default.
- Moving internal sigma: `0.2/(W/2) = 0.4/W` hertz, twice the current default.

The four derived configurations are:

| Source | Wait mean | Wait sigma | Wait internal sigma | Move mean | Move sigma | Move internal sigma | Target sigma |
|---|---:|---:|---:|---:|---:|---:|---:|
| Random 500 ms | 0.5 s | 0.15 s | 0.4 Hz | 0.25 s | 0.075 s | 0.8 Hz | 0.1 |
| Random 2 s | 2 s | 0.6 s | 0.1 Hz | 1 s | 0.3 s | 0.2 Hz | 0.3 |
| Random 6 s | 6 s | 1.8 s | 1/30 Hz | 3 s | 0.9 s | 1/15 Hz | 0.2 |
| Random 16 s | 16 s | 4.8 s | 0.0125 Hz | 8 s | 2.4 s | 0.025 Hz | 0.1 |

These are defaults only. Applications retain the existing ability to override all inputs before registration, and registration validation remains unchanged.

## MiniApp Main Layout

MiniApp adopts the Braid4 page composition at its existing default size and at smaller supported sizes:

- The left region contains the existing VCO and LFO scope panels stacked vertically.
- The right region contains all sixteen encoder positions in four rows of four.
- Encoder positions retain their existing row-major physical mapping: index `0` is the upper-left cell and index `15` is the lower-right cell.
- Top-level banks show unassigned positions as the existing empty/disconnected placeholders.
- Modulation views continue to show the fifteen fixed modulator positions plus the return position, including empty disconnected modulator gaps.

The layout uses responsive cell dimensions derived from the available encoder area rather than the current fixed two-row dimensions. Every cell and scope remains within the root bounds at the default `900x560` size and the existing `640x480` compact test size.

## Main-Screen Random Panel Removal

MiniApp no longer constructs the separate main-screen ganged-random node in the former bottom-right panel. The VCO and LFO scopes remain. MiniApp-specific panel code and identifiers that become unused are removed rather than retained solely for obsolete tests.

This does not remove standard random visualizers from the modulation system. Each registered random source retains its owned visualizer, and connected modulation-depth cells continue rendering the visualizer as an encoder underlay.

## Compatibility and Scope

- The parameter, bank, modulator-index, MIDI, and saved-data contracts do not change.
- The standard target sigmas do not change.
- The generic ganged-random processor and sampling algorithm do not change; only `StandardModulators` defaults change.
- Braid4 already has the desired 4x4 layout and is not visually redesigned.
- Browser and JUCE backends continue consuming the portable MiniApp node tree; no new rendering protocol is introduced.

## Verification

Tests will prove:

- all four standard sources use the exact new waiting and moving external/internal sigma formulas;
- target sigmas and pre-registration overrides remain unchanged;
- MiniApp builds sixteen row-major encoder nodes, including encoder `15`, and routes its drag/push actions to slot `0`, position `15`;
- the VCO and LFO scopes occupy bounded, non-overlapping left-side regions;
- the 4x4 encoder grid occupies a bounded right-side region at `900x560` and `640x480`;
- the separate main-screen ganged-random node is absent;
- modulation-view random visualizer underlays remain present;
- focused DSP, MiniApp system, portable UI, browser command-buffer, JUCE parity, full synth, and strict OpenSpec checks pass.
