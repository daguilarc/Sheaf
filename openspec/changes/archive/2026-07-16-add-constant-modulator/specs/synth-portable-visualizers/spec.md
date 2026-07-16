## ADDED Requirements

### Requirement: spv-8 — Constant visualizer: ordered voice bars
WHEN a fixed polyphonic modulation source needs a portable representation, THE synth portable UI system SHALL provide a JUCE-free `ConstantBarVisualizer` that borrows an immutable normalized value span and emits exactly one unlabeled filled bar per voice in span order over a `[-0.1, 1.1]` vertical data range, without requiring UI state, scope state, audio history, or backend-specific types.

#### Scenario: Every voice receives one ordered bar
- **WHEN** the visualizer draws a nonempty value span into positive finite bounds
- **THEN** it divides the available width into equal slots in span order
- **AND** emits exactly one filled rectangle inside each corresponding slot
- **AND** emits no label, tick, axis, outline, background, or other draw command

#### Scenario: Zero remains visible
- **WHEN** a voice value is `0`
- **THEN** its bar begins at the bottom edge representing `-0.1` and ends at the zero position
- **AND** the bar occupies exactly `1/12` of the drawing height

#### Scenario: One remains below the top
- **WHEN** a voice value is `1`
- **THEN** its bar begins at the bottom edge and ends at the one position
- **AND** the top `1/12` of the drawing height remains clear

#### Scenario: Bar geometry stays minimal and bounded
- **WHEN** finite normalized values draw into positive finite bounds
- **THEN** every rectangle has exactly half the positive width remaining after the slot-relative horizontal inset
- **AND** every rectangle is centered in its assigned voice slot
- **AND** every rectangle remains inside the assigned bounds
- **AND** all bars use the visualizer's retained color

#### Scenario: Constant chart omits the shared encoder frame
- **WHEN** the constant visualizer is composed beneath a modulation-depth encoder
- **THEN** the encoder omits its outer rounded-rectangle frame
- **AND** retains its body, indicators, badges, and interactions
- **AND** visualizers that do not request suppression retain the frame by default

#### Scenario: Invalid drawing input is safe
- **WHEN** the visualizer has an empty value span or non-finite or non-positive bounds
- **THEN** it emits no draw commands

#### Scenario: Immutable values need no publication model
- **WHEN** an application retains the borrowed source storage for the visualizer lifetime
- **THEN** repeated draws use the same per-voice values without copying or recomputation
- **AND** no processor `UIState`, atomic snapshot, scope reader, lock, or audio-thread publication is required
