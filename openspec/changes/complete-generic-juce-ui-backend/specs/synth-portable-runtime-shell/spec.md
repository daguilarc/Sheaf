## MODIFIED Requirements

### Requirement: sprs-6 — Browser layout: one resolved surface coordinate system
WHEN the browser backend renders a composite frame, THE backend SHALL treat resolved node bounds as absolute surface coordinates, convert child positions to parent-relative CSS offsets only for DOM nesting, resolve unbounded controls within their nearest nested root, scale the single composite root uniformly when needed, include resolved auto-flow content in the host height, and size unbounded labels and status text sufficiently for their content without overlapping adjacent controls.

#### Scenario: Auto-flow content is not clipped
- **WHEN** unbounded controls flow below the explicit composite root height
- **THEN** the browser host height includes the resolved bottom edge and the controls remain visible

#### Scenario: Long status text does not overlap
- **WHEN** an unbounded label or status text contains more text than fits the default width
- **THEN** its resolved width expands within the available row before subsequent controls are placed

#### Scenario: Narrow viewport preserves composition
- **WHEN** the browser viewport is narrower than the composite root
- **THEN** app content and sidebar scale together from one origin
- **AND** no independent-root gap or overlap appears

#### Scenario: Nested DOM preserves absolute portable bounds
- **WHEN** a sidebar root and its descendants have absolute x coordinates beginning at the app width
- **THEN** DOM nesting subtracts the resolved parent origin exactly once
- **AND** the descendants render in the same surface positions as the generic JUCE backend

## ADDED Requirements

### Requirement: sprs-9 — JUCE layout: hierarchical generic portable backend
WHEN the generic JUCE backend renders a portable node tree, THE backend SHALL retain semantic `Row`, `Section`, and `ScrollArea` parentage; SHALL resolve parent-local explicit bounds exactly once while preserving surface-absolute bounds and nested-root coordinate spaces; SHALL resolve unbounded controls within their nearest root before translating them into their resolved semantic host; and SHALL render labels, controls, panels, and node-local draw commands in the resolved location and clipping hierarchy without application-specific node IDs or page branches.

#### Scenario: Parent-local rows do not overlap
- **WHEN** two rows have different bounds in a scroll area's content coordinates and each row contains controls at local y zero
- **THEN** the controls render inside their owning rows at distinct surface y positions
- **AND** neither row obscures controls that precede the scroll area

#### Scenario: Nested absolute root translates exactly once
- **WHEN** a composite tree contains an application root at x zero and a sidebar root whose descendants already begin at the application width
- **THEN** the generic JUCE backend preserves the sidebar descendants' surface positions
- **AND** it neither drops nor doubles the sidebar offset

#### Scenario: Unbounded semantic child retains root flow
- **WHEN** an unbounded control is a descendant of a bounded row but participates in its nearest root's auto-flow
- **THEN** its surface position is resolved by the root flow cursor
- **AND** its JUCE bounds are translated into the owning row without changing that surface position

#### Scenario: Nested drawing follows its container
- **WHEN** a draw node is inside a row, section, or scrolling content subtree
- **THEN** its painting and interactive pointer target use the same resolved bounds and clipping as sibling controls

#### Scenario: Refresh preserves live controls
- **WHEN** a stable node ID and kind survive a surface refresh while its text editor is focused or contains an uncommitted draft
- **THEN** the backend retains that JUCE component, focus, and draft while updating its current semantic properties and action

#### Scenario: Reparent preserves a live editor
- **WHEN** a stable text-editor node keeps its ID and kind while its semantic parent changes across refresh
- **THEN** the backend reparents the retained JUCE component without discarding its focus or uncommitted draft

### Requirement: sprs-10 — JUCE scrolling: real portable scroll areas
WHEN the generic JUCE backend renders a `ScrollArea`, THE backend SHALL present its declared bounds as a JUCE viewport, SHALL size one content component to at least `scrollContentWidth` by `scrollContentHeight`, SHALL parent the scroll area's descendants into that content component, and SHALL provide horizontal and vertical scrolling when content exceeds the visible bounds so clipped descendants remain reachable and interactive.

#### Scenario: Content extent is distinct from viewport
- **WHEN** a scroll area declares visible bounds smaller than its content extent
- **THEN** the viewport remains at the visible bounds
- **AND** its content component uses the declared content extent without enlarging the viewport

#### Scenario: Final mapping row is reachable
- **WHEN** the shared Controllers page expands a mapping section whose final row lies below the visible viewport
- **THEN** a user can scroll to the final row
- **AND** the final row remains visible, editable, and clipped to the viewport during scrolling

#### Scenario: Wide controller content scrolls horizontally
- **WHEN** a Controllers row or mapping editor requires more width than the page viewport
- **THEN** the generic JUCE backend exposes horizontal scrolling to the declared content width
- **AND** it does not compress or overlap the row's controls

### Requirement: sprs-11 — Verification: production generic JUCE page coverage
WHEN the generic JUCE backend change is verified, THE synth project SHALL exercise hierarchy, nested roots, stable refresh, nested drawing, and scroll extents in backend tests; SHALL open the real shared Controllers page through the desktop runtime shell and verify non-overlap plus final-row reachability; and SHALL keep the standalone Controllers harness on the same generic backend path used by the desktop application, without retaining a Controllers-specific production renderer as an alternate implementation.

#### Scenario: Desktop shell exercises the production renderer
- **WHEN** the JUCE runtime-shell integration test opens Controllers from the shared sidebar
- **THEN** the Back control, controller rows, Add row, status line, and scroll viewport have non-overlapping resolved bounds
- **AND** the test reaches content beyond the initial viewport through the generic backend

#### Scenario: Harness cannot hide generic regressions
- **WHEN** the standalone Controllers harness renders its fixtures
- **THEN** it uses `PortableComponent` over the production `ControllersPageSurface`
- **AND** it does not instantiate or test a separate Controllers tree renderer
