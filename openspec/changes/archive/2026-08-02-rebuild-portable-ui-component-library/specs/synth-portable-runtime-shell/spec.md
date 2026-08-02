## RENAMED Requirements

- FROM: `### Requirement: sprs-6 — Browser layout: one resolved surface coordinate system`
- TO: `### Requirement: sprs-6 — Browser layout: one parent-relative coordinate system`

## MODIFIED Requirements

### Requirement: sprs-2 — Layout: app content remains intact beside runtime chrome
WHEN the shared main component builds its default tree, THE component SHALL preserve the application's configured origin-zero content rectangle without clipping, SHALL compose subtrees using parent-relative node coordinates so that placing a subtree's root places every descendant with it, SHALL position the fixed 96-pixel runtime sidebar root immediately to the app's right, and SHALL make runtime chrome additive to the application width; every subtree the component hands to a backend SHALL arrive fully laid out by the component library's resolver — nodes built without explicit bounds are resolved within their containing subtree root's extent before composition, and no backend positions or sizes them.

#### Scenario: App dimensions are preserved
- **WHEN** an app config declares a 900 by 560 UI and its portable root matches those dimensions
- **THEN** the composite root is 996 by 560
- **AND** the app subtree root remains at 0,0 relative to the composite root with dimensions 900 by 560
- **AND** the sidebar root sits at x 900 relative to the composite root
- **AND** sidebar descendants carry coordinates relative to their parents, resolving on screen within the x 900 through 996 band without any per-descendant translation

#### Scenario: Library-resolved content stays inside app content
- **WHEN** an application builds semantic controls through the component library without explicit bounds
- **THEN** the library resolves their bounds within the application root's 900-pixel width before the tree reaches any backend
- **AND** no control resolves into the sidebar band
- **AND** neither backend computes a position or size for them

#### Scenario: Runtime page replaces only app content
- **WHEN** the Audio, Controllers, or File page opens
- **THEN** exactly that page occupies the 900 by 560 app content rectangle
- **AND** the sidebar remains visible and unchanged at the right

#### Scenario: Invalid app root fails generically
- **WHEN** an application's portable tree has no single origin-zero root matching its configured positive UI dimensions, contains duplicate IDs, references unknown children, contains a cycle, or uses the reserved `runtime.*` node namespace
- **THEN** composition fails with a diagnostic naming the violated portable-tree contract
- **AND** no concrete-app fallback is used

### Requirement: sprs-6 — Browser layout: one parent-relative coordinate system
WHEN the browser backend renders a composite frame, THE backend SHALL treat every node's resolved bounds as coordinates in its parent node's space — the single parentless root's bounds being surface coordinates, and a `ScrollArea` child's bounds being coordinates in its parent's scroll-content space — SHALL position each node's DOM element directly from those bounds as an absolutely-positioned child of its parent's element with no origin subtraction and no coordinate-space classification, SHALL derive the host height from the resolved root extent rather than from flowed content, SHALL scale the single composite root uniformly when the viewport is narrower than the surface, and SHALL NOT flow, size, or expand any node — a node arriving without resolved bounds renders at its parent's origin with zero-based extent.

#### Scenario: Nested DOM consumes parent-relative bounds directly
- **WHEN** a sidebar root sits at x 900 relative to the composite root and its descendants carry coordinates relative to their own parents
- **THEN** each descendant's CSS offset equals its wire bounds with no parent-origin subtraction
- **AND** the descendants render in the same surface positions as the generic JUCE backend

#### Scenario: Host height follows the resolved root
- **WHEN** a page's content is resolved by the component library within the root extent
- **THEN** the browser host height is the resolved root extent
- **AND** no content is placed below it by backend flow

#### Scenario: Unbounded text is not expanded by the backend
- **WHEN** a label or status text carries more text than fits its resolved extent
- **THEN** the backend fits the text within that extent by shrinking, truncating, or clipping
- **AND** the node's resolved bounds are unchanged, so no adjacent control moves

#### Scenario: Narrow viewport preserves composition
- **WHEN** the browser viewport is narrower than the composite root
- **THEN** app content and sidebar scale together from one origin
- **AND** no independent-root gap or overlap appears

### Requirement: sprs-9 — JUCE layout: hierarchical generic portable backend
WHEN the generic JUCE backend renders a portable node tree, THE backend SHALL retain semantic `Row`, `Section`, and `ScrollArea` parentage; SHALL position every node at its parent-relative resolved bounds inside its resolved semantic host, accumulating ancestor origins only across ancestors not realized as components; SHALL treat every `Draw` node's complete command buffer as node-local geometry against that node's own origin, clipped to the node's bounds; SHALL contain no coordinate-space classification of any kind — neither of draw-command geometry nor of explicit node bounds — and SHALL NOT flow, size, or default the extent of any node; and SHALL render labels, controls, panels, and draw commands in the resolved location and clipping hierarchy without application-specific node IDs or page branches.

#### Scenario: Parent-local rows do not overlap
- **WHEN** two rows have different bounds in a scroll area's content coordinates and each row contains controls at local y zero
- **THEN** the controls render inside their owning rows at distinct surface y positions
- **AND** neither row obscures controls that precede the scroll area

#### Scenario: Nested root translates by its own bounds only
- **WHEN** a composite tree contains an application root at x zero and a sidebar root at x equal to the application width, whose descendants carry parent-relative coordinates
- **THEN** the generic JUCE backend places the sidebar root at its bounds and every descendant relative to its own parent
- **AND** it neither drops nor doubles the sidebar offset

#### Scenario: No node-bounds coordinate guess survives
- **WHEN** the JUCE and browser backend sources are inspected
- **THEN** neither contains a predicate that classifies a node's explicit bounds as parent-local or surface-absolute by testing whether they fall inside the parent's extent
- **AND** neither contains a predicate that classifies draw-command geometry as node-local or surface-absolute

#### Scenario: Nested drawing follows its container
- **WHEN** a draw node is inside a row, section, or scrolling content subtree
- **THEN** its painting and interactive pointer target use the same resolved bounds and clipping as sibling controls

#### Scenario: Application drawing is node-local by definition
- **WHEN** an application supplies draw-node bounds in its parent's space and draw commands against the node's own origin
- **THEN** the JUCE backend positions the hosted draw component at the resolved node bounds
- **AND** paints the commands in that component's own space with no translation
- **AND** the drawn pixels within the node are identical to those the application drew before this change

#### Scenario: Backend geometry is derivable from the tree alone
- **WHEN** either backend renders any node of a resolved tree
- **THEN** the node's rendered position equals its own resolved bounds offset by the accumulated origins of its ancestor chain, plus scroll offset and uniform surface scale where applicable
- **AND** no other input contributes to that position

#### Scenario: Refresh preserves live controls
- **WHEN** a stable node ID and kind survive a surface refresh while its text editor is focused or contains an uncommitted draft
- **THEN** the backend retains that JUCE component, focus, and draft while updating its current semantic properties and action

#### Scenario: Reparent preserves a live editor
- **WHEN** a stable text-editor node keeps its ID and kind while its semantic parent changes across refresh
- **THEN** the backend reparents the retained JUCE component without discarding its focus or uncommitted draft
