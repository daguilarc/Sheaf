## ADDED Requirements

### Requirement: sru-20 — Portable UI: encoder mouse interaction parity
WHEN a miniapp encoder is rendered through the portable UI layer on the JUCE desktop backend, THE runtime UI layer SHALL preserve the pre-abstraction encoder mouse interaction behavior: mouse drag over the encoder dispatches a relative parameter increment/decrement for that encoder's bound slot and position using the existing `(deltaX - deltaY) * sensitivity` gesture mapping, and mouse double-click dispatches the encoder push action for that same slot and position; the portable tree producer SHALL remain JUCE-free and the JUCE backend SHALL only translate toolkit mouse events into portable actions.

#### Scenario: Mouse drag turns encoder
- **WHEN** the JUCE backend receives a mouse-down followed by a mouse-drag on a portable miniapp encoder node
- **THEN** the miniapp surface dispatches a `MessageIn::ParamIncDec` message to the UI bus for the encoder's slot and position
- **AND** the message delta follows the pre-abstraction encoder drag formula and sensitivity

#### Scenario: Mouse double-click pushes encoder
- **WHEN** the JUCE backend receives a mouse double-click on a portable miniapp encoder node
- **THEN** the miniapp surface dispatches a `MessageIn::ParamPush` message to the UI bus for the encoder's slot and position

#### Scenario: Portable boundary remains JUCE-free
- **WHEN** a JUCE-free synth test includes the portable UI model and miniapp encoder tree builder
- **THEN** it compiles without JUCE headers
- **AND** it can inspect the encoder node's host-neutral drag and double-click action metadata
