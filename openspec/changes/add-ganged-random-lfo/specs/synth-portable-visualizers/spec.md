## ADDED Requirements

### Requirement: spv-6 — Random modulation: predictive ganged-LFO round visualizer
WHEN ganged random LFO UI state is displayed, THE synth portable UI system SHALL provide a JUCE-free `GangedRandomLfoVisualizer` that reads a coherent live snapshot without owning or recording DSP samples, scales its x-axis to the maximum waiting-plus-moving duration among voices, reconstructs every voice's complete source-hold, shaped movement, and target-hold path over that shared window, draws path geometry before the shared present as solid and after the shared present as dashed, and draws one present-position indicator dot per voice at the reconstructed path value for the shared present using that voice's assigned color so it can match the voice's visual identity.

#### Scenario: Shared axis includes every voice round
- **WHEN** voices have different waiting and moving increments
- **THEN** each voice's wait and move sample counts are derived as `ceil(1 / increment)` and converted using sample rate
- **AND** the x-axis endpoint is the maximum total duration
- **AND** a voice that finishes early holds target through the shared endpoint

#### Scenario: Present is shared across voice paths
- **WHEN** the gang snapshot reports one round-elapsed sample count
- **THEN** every voice indicator has the same x coordinate after scaling
- **AND** each indicator's y coordinate is that voice's reconstructed value at the present time
- **AND** the indicator does not substitute the snapshot's actual output field for that reconstructed y coordinate

#### Scenario: Past is solid and future is dashed
- **WHEN** the shared present lies inside the displayed round
- **THEN** each path from round start through present is emitted as complete polyline geometry
- **AND** each path after present is emitted as alternating bounded polyline segments using existing portable draw commands

#### Scenario: Drawing matches DSP interpolation
- **WHEN** the visualizer samples a voice's moving interval
- **THEN** it uses the shared `ShapedInterpolate` primitive with the snapshot source, target, and shape
- **AND** its predicted curve reaches the same endpoints and intermediate values as the DSP model within sub-sample and drawing-geometry tolerance

#### Scenario: State boundaries tolerate discarded phase remainder
- **WHEN** an increment crosses one with a fractional phase remainder and the voice discards that remainder while changing state
- **THEN** visualizer comparisons at the waiting/moving and moving/done boundaries allow sub-sample and drawing-geometry tolerance
- **AND** the shared present, solid/future split, reconstructed dot, and path remain mutually aligned

#### Scenario: Voice colors are independent
- **WHEN** the snapshot contains a different assigned color for each voice
- **THEN** each voice's solid path, dashed segments, and indicator dot derive only from that voice color

#### Scenario: Unstable or unusable snapshots fail closed
- **WHEN** a coherent snapshot cannot be read within the bounded retry limit or has no positive finite sample rate or round duration
- **THEN** the visualizer emits its bounded background/axis treatment without non-finite or out-of-bounds voice geometry

#### Scenario: Visualizer remains portable and bounded
- **WHEN** the visualizer is compiled and drawn in JUCE-free tests at different bounds and round durations
- **THEN** it requires no JUCE, browser, scope-writer, or backend protocol type
- **AND** emits a bounded amount of clipped geometry independent of the round's audio-sample length
