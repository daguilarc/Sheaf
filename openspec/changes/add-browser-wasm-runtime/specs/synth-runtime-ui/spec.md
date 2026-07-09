## ADDED Requirements

### Requirement: sru-21 — Portable UI: browser command-buffer serialization
WHEN a portable UI surface is rendered by the browser backend, THE runtime UI layer SHALL provide a JUCE-free serialization boundary that converts the current `NodeTree` into a browser-consumable command buffer containing stable node identities, hierarchy, bounds, semantic control records, actions, scroll extents, string-table entries, and draw-command records; the serialization boundary SHALL be testable without JUCE, DOM, Canvas, or application-specific browser code.

#### Scenario: Representative tree serializes without host APIs
- **WHEN** a JUCE-free test builds a representative runtime/app portable UI tree and serializes it for the browser backend
- **THEN** the resulting buffer contains records for semantic controls, scroll areas, actions, and draw commands
- **AND** the test compiles without JUCE, DOM, Canvas, or JavaScript API headers

#### Scenario: Stable IDs survive frame updates
- **WHEN** two consecutive UI frames contain the same logical slider, text field, or draw node with changed value or draw commands
- **THEN** the serialized records preserve the same node identity
- **AND** the browser backend can update the existing browser-side control rather than recreating it solely because its value changed

### Requirement: sru-22 — Portable UI: browser backend rendering and dispatch
WHEN the browser backend receives a portable UI command buffer, THE backend SHALL render semantic controls as browser controls or browser-owned equivalents, render draw-command nodes through a batched canvas-oriented renderer, preserve scroll viewport and content-extent semantics, and translate browser input events into portable `Action` dispatches without requiring application-specific DOM or HTML.

#### Scenario: Semantic controls render from node kind
- **WHEN** the buffer contains button, toggle, slider, combo box, text field, label, status text, row, section, or scroll-area records
- **THEN** the browser backend renders them according to their portable node kind and state
- **AND** it does not inspect the concrete application type to choose the control

#### Scenario: Draw nodes render in browser-owned batches
- **WHEN** the buffer contains a draw node with multiple draw-command records
- **THEN** the browser backend renders those records through a browser-owned canvas path after receiving the buffer
- **AND** C++ draw-command producers make no synchronous Canvas or DOM calls

#### Scenario: Scroll extents remain reachable
- **WHEN** a portable scroll area has content height greater than its visible bounds
- **THEN** the browser backend maps visible bounds and content extent so the bottom content remains reachable

#### Scenario: Browser input dispatches portable actions
- **WHEN** the user changes a browser-rendered control, drags a draw node, or double-clicks a row or draw node
- **THEN** the browser backend sends the corresponding portable action name and value back to the runtime
- **AND** application behavior is reached only through `Surface::DispatchAction`
- **AND** encoder/rotary drag actions preserve the existing replacement-delta semantics expected by portable controls, including replacement of the suffix after the final colon in action values
- **AND** double-click dispatch preserves portable push actions for rows and draw nodes that define them

### Requirement: sru-23 — Portable UI: no app-specific browser fallback
WHEN browser UI support is added for a synth application, THE runtime UI layer SHALL use the same portable tree, command-buffer serializer, and browser backend for all synth applications; it SHALL NOT provide hand-written browser HTML, app-specific DOM layout, or app-specific fallback controls for the miniapp or any other concrete app.

#### Scenario: Miniapp uses generic portable backend
- **WHEN** the miniapp is rendered in Chrome
- **THEN** every visible control and draw region comes from the miniapp's portable `Surface` tree through the generic browser backend
- **AND** no miniapp-specific HTML template or DOM construction path is loaded

#### Scenario: Unsupported portable node blocks generically
- **WHEN** the browser backend encounters a portable node kind or draw command it cannot render
- **THEN** it reports the unsupported generic portable feature
- **AND** it does not substitute a miniapp-specific workaround
