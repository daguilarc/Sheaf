## Why

Synth applications currently recreate ownership, registration, processing, and visualization plumbing for the same generic modulation sources. A reusable opt-in standard bundle will give MIN-16 applications a consistent fifteen-slot modulation topology while keeping application-specific sources explicit.

## What Changes

- Add an opt-in `StandardModulators<VoiceCount>` component that owns four configurable ganged random LFOs, noise, polyphonic constant spread, their stable source storage, metadata, and portable visualizers.
- Define the MIN-16 default layout as random LFOs at indexes `0..3`, constant at `11`, and noise at `14`, with the six sources and all timing/index/appearance defaults configurable before registration.
- Skip constant registration for monophonic parameter groups while retaining the other five standard sources.
- Expand MiniApp to fifteen modulation slots and all sixteen physical slot positions, replace its app-owned generic modulators with `StandardModulators<2>`, and move VCO, swapped VCO, and LFO sources to `4`, `5`, and `6`.
- Expand all three Braid4 groups to fifteen modulation slots, give each group an independent standard bundle, and move each group's two existing sources to `4` and `5`.
- Preserve MiniApp's main random-LFO panel through standard source `0` and provide wrapper-owned visualizers in MiniApp and Braid4 modulation-depth views.
- Treat disconnected modulation-source indexes as empty UI positions: do not materialize depth parameters for them, ignore their encoder input, and exclude them from Random Mod.
- **BREAKING**: Modulator indexes and saved modulation-depth topology change without migration or compatibility handling.

## Capabilities

### New Capabilities

- `synth-standard-modulators`: Reusable ownership, configuration, registration, processing, visualization, and lifecycle contracts for the standard MIN-16 modulation bundle.

### Modified Capabilities

- `synth-parameter-modulation`: Replace MiniApp's single app-owned ganged random source and seven-position modulation view with the standard fifteen-source topology while retaining its main random panel, and make disconnected source indexes behave like empty bank positions.
- `synth-dsp-classes`: Replace MiniApp's app-owned noise and constant integration and old source indexes with the standard bundle and moved application-specific sources.
- `synth-braid-4`: Expand all Braid4 groups to the standard topology, move existing source pairs, process independent standard bundles at the internal rate, and populate standard visualizers.

## Impact

- Affected reusable code: `projects/synth/include/synth/` standard-modulator composition over existing random, noise, constant, and visualizer classes, plus generic bank modulation-view materialization.
- Affected applications: `projects/synth/apps/miniapp/` and `projects/synth/apps/braid-4/`, including parameter-group capacities, slot layouts, lifecycle calls, UI accessors, and source registration.
- Affected verification: synth DSP/unit tests, parameter-modulation tests, MiniApp and Braid4 system tests, portable/browser UI command tests, and coverage documentation.
- No new third-party dependency, patch migration, or saved-data upgrade path is introduced.
