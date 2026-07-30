## ADDED Requirements

### Requirement: sru-43 — Portable UI: single hierarchical authoring library
WHEN any runtime page, runtime shell surface, or synth application builds a portable node tree, THE runtime UI layer SHALL provide one JUCE-free component library through which the tree is authored, supporting container components (column, row, section, scroll area) that nest to arbitrary depth, leaf semantic controls with their colour, text style, caption, selected, enabled, and action state settable at construction, reusable components defined as ordinary callables that emit into the same builder so components can compose other components, and splicing of an externally built subtree; the library SHALL emit the existing `NodeTree` contract (kind-tagged nodes, stable ids, `children` references) so hierarchy and composition require no protocol change beyond the sru-46 coordinate-semantics shift, and runtime page code SHALL NOT assemble `ui::Node` structs by hand outside the library.

#### Scenario: Containers nest through the public API
- **WHEN** a JUCE-free test builds a section containing a scroll area containing rows of controls through the component library
- **THEN** the resulting `NodeTree` contains the corresponding `Section`, `ScrollArea`, and `Row` nodes with correct parent-child `children` references at each depth
- **AND** the tree serializes over the command buffer's existing node/children encoding without hierarchy-specific additions

#### Scenario: Components compose components
- **WHEN** a reusable component (a callable taking the builder) emits a captioned control row, and a page component invokes it multiple times inside a column
- **THEN** each invocation produces its subtree in place with distinct stable node ids
- **AND** neither the page nor the component constructs `ui::Node` values directly

#### Scenario: Construction expresses full control state
- **WHEN** a builder call creates a button with a colour, text style, selected state, and disabled state
- **THEN** the resulting node carries that colour, text style, `selected`, and `enabled` without any post-build mutation of the tree

#### Scenario: External subtrees splice without a nested root
- **WHEN** a page splices an externally built subtree (such as the File page patch-browser tree) into its own tree
- **THEN** the spliced nodes appear as descendants of the splice point with exactly one root node in the final tree

#### Scenario: Config pages contain no hand-rolled nodes
- **WHEN** the runtime page sources are inspected after migration
- **THEN** Audio, Sync, File, and Controllers page tree construction goes through the component library
- **AND** no runtime page code initializes `ui::Node` structs field-by-field

### Requirement: sru-44 — Portable UI: declarative build-time layout with library-owned metrics
WHEN a portable tree is built through container components, THE component library SHALL resolve every contained node's parent-relative `Bounds` at build time from declarative layout inputs — vertical stacking in columns/sections/scroll areas, horizontal stacking in rows, per-child fixed extents, intrinsic defaults, fractions of the container's content extent, or weights over remaining space, each optionally bounded by a declared minimum and maximum extent, resolved by one stated deterministic allocation algorithm: fixed, intrinsic, and fractional extents resolve first (a fraction being taken of the container's extent less its padding, before gaps and siblings are considered); weights then divide whatever main-axis space remains after those extents, all inter-child gaps, and the container's padding; every resolved extent is then clamped to its declared minimum and maximum, and the space freed or demanded by clamping is redistributed in exactly one further pass across only those children that are weighted and not themselves clamped, in proportion to their weights; residual space that no eligible child can absorb is left unallocated at the end of the container rather than forced onto a clamped child, and a container whose children's minima exceed its extent overflows deterministically in declaration order rather than shrinking any child below its minimum — with padding and inter-child gaps drawn from the library's shared spacing metrics — SHALL provide an explicit wrapping-row container option that flows children onto additional lines within the container's extent, SHALL own the intrinsic sizing contract in place of any backend default-size table: per-kind intrinsic extents are library constants, and text-bearing extents are deterministic reservations derived from character count and per-text-style advance metrics, resolved without consulting any backend so that geometry never depends on toolkit font measurement (fitting text within a resolved extent is the backend's own local concern under sru-49), SHALL provide a form-grid facility that aligns the label and control columns of participating rows to shared x-offsets within their container, SHALL resolve each container's children against only that container's own extent so a resolved subtree resolved against the same available extent is identical wherever it is mounted, and SHALL leave explicitly positioned children at their author-supplied parent-relative bounds, treating them as out of flow so they consume no stacking space and their stacked siblings resolve as if they were absent; out-of-flow SHALL be a positioning mode a producer chooses per node and SHALL NOT be an intrinsic property of any node kind, so that a `Draw` node may equally participate in flow; a producer SHALL also be able to place an out-of-flow node by naming the in-flow sibling it overlays, resolving to that sibling's bounds, so that an overlay whose extent is decided by the resolver — such as the sru-25 translucent visualizer underlay beneath a resolver-sized encoder cell — is expressible without its producer computing any geometry; and for an in-flow `Draw` node the library SHALL accept a command factory in place of fixed geometry and SHALL invoke it during resolution with that node's own resolved node-local extent, so a drawn component can fill a layout slot without its producer computing the slot's size; no backend SHALL perform layout or supply default sizes.

#### Scenario: Inserting a row shifts no hand-written offsets
- **WHEN** a page adds one captioned row in the middle of a column
- **THEN** subsequent siblings' resolved bounds move down by the row's extent plus the shared gap metric without any producer-side coordinate edits

#### Scenario: Like controls align in a form grid
- **WHEN** a form grid lays out rows whose labels have differing text lengths
- **THEN** every participating control column starts at the same resolved x-offset within the container
- **AND** every participating label column starts at the same resolved x-offset within the container

#### Scenario: Weights divide remaining space deterministically
- **WHEN** a row contains one fixed-width child and two weight-1 children
- **THEN** the two weighted children resolve to equal widths filling the remaining row width
- **AND** re-resolving the same inputs yields byte-identical bounds

#### Scenario: A component resolves the same everywhere
- **WHEN** the same component is emitted into two different parents that differ in position but offer the same available extent and layout inputs
- **THEN** the resolved parent-relative bounds of the component's subtree are identical in both placements
- **AND** no node in the subtree encodes a surface-global position

#### Scenario: Extents are clamped by declared minima and maxima
- **WHEN** a child declares a weight together with a maximum extent, and its weighted share exceeds that maximum
- **THEN** the child resolves to exactly its maximum extent
- **AND** the freed space is redistributed in one further pass across only the weighted, unclamped siblings, in proportion to their weights
- **AND** space that no eligible sibling can absorb is left unallocated at the end of the container rather than forced onto a clamped child

#### Scenario: A fraction is taken of the container's content extent
- **WHEN** a child declares a fractional extent of 0.46 inside a container whose extent less padding is 868
- **THEN** the child resolves to 399.28 before clamping, independently of the container's gaps and its siblings' extents
- **AND** declaring a maximum of 390 alongside it resolves the child to exactly 390

#### Scenario: Infeasible minima are deterministic, and then fail
- **WHEN** a container's children declare minimum extents whose sum exceeds the container's extent
- **THEN** no child resolves below its declared minimum
- **AND** the order in which they exceed the container is deterministic and follows declaration order, so the diagnostic always names the same first offending child
- **AND** resolution then fails per sru-54 rather than yielding a tree whose overflowing children would be silently clipped — determinism describes *how* the overflow is computed, not that it is an acceptable result

#### Scenario: An in-flow Draw node is given its resolved extent
- **WHEN** a `Draw` node participates in flow and supplies a command factory instead of fixed geometry
- **THEN** the library invokes the factory during resolution with that node's own resolved node-local extent
- **AND** the resulting commands fill the extent the layout allocated, with no producer-side computation of the slot's size
- **AND** re-resolving the same producer code at a different root extent produces commands filling the new extent

#### Scenario: A wrapping row flows onto additional lines
- **WHEN** a wrapping-row container holds more children than fit its extent on one line
- **THEN** the overflowing children resolve onto subsequent lines separated by the shared gap metric
- **AND** the container's resolved extent grows to contain every line

#### Scenario: Text extents are reservations, not measurements
- **WHEN** a label's intrinsic width is resolved
- **THEN** the width derives from the label's character count and its text style's advance metric in the library
- **AND** the resolved bounds are identical regardless of which backend later renders the tree
- **AND** no layout input is obtained by asking a backend to measure text

#### Scenario: An overlay is positioned by naming what it overlays
- **WHEN** a producer marks a node out of flow by naming an in-flow sibling it overlays, and that sibling's extent is decided by the resolver rather than by the producer
- **THEN** the overlay resolves to exactly that sibling's bounds
- **AND** the producer supplies no coordinates or extents of its own
- **AND** the sibling's own resolved bounds and every other sibling's are unchanged by the overlay's presence

#### Scenario: Explicitly positioned children are out of flow
- **WHEN** a container holds an explicitly positioned `Draw` child among stacked siblings
- **THEN** the child's resolved bounds equal its author-supplied parent-relative bounds
- **AND** the stacked siblings resolve to the same bounds they would have had if the explicitly positioned child were absent

### Requirement: sru-45 — Portable UI: direct colour and text style on components
WHEN a portable semantic control is constructed, THE component library SHALL accept an optional colour (plain `synth::Color` RGBA, as `DrawCommand::color` already carries) and an optional text style as direct component properties carried on the node record with no indirection; the carried colour SHALL have one defined meaning per node kind — the control fill for `Button` and `Toggle`, the field background for `ComboBox` and `TextField`, the filled-track accent for `Slider`, the container or surface background fill for `Root`, `Row`, `Section`, and `ScrollArea`, and the text background for `Label` and `StatusText` (whose glyph colour comes from the carried text style, never from the carried colour) — and SHALL be ignored for `Draw`, whose commands carry their own colours; a carried value SHALL take precedence over every backend constant for that node, and a backend SHALL derive its selected, hover, pressed, and disabled presentation from the carried colour rather than substituting a colour of its own; a caption SHALL be expressed as an ordinary library-emitted `Label` node in the control's form-grid row rather than as a node-record field or wire addition; THE JUCE backend SHALL render carried values so that its hardcoded per-variant colour constants no longer decide the appearance of a node that carries them, THE browser backend SHALL render carried values rather than dropping styling, and a node carrying no colour or text style SHALL render each backend's plain default look, including that backend's existing selected and disabled treatment.

#### Scenario: A green button is a green button
- **WHEN** an application constructs a button with a green colour through the component library
- **THEN** the node record carries that RGBA value across the command buffer
- **AND** the button renders green in both the JUCE and browser backends with no lookup or vocabulary in between

#### Scenario: Text style is direct
- **WHEN** a label is constructed with an explicit text style (size and colour)
- **THEN** both backends render that size and colour from the carried value

#### Scenario: Unstyled nodes keep a default look
- **WHEN** a tree sets no colour or text style on its controls
- **THEN** every control still renders with the backend's default appearance
- **AND** no control renders unstyled or invisible

#### Scenario: One colour has one meaning per kind
- **WHEN** the same RGBA value is carried by a `Button`, a `Slider`, a `TextField`, and a `Label`
- **THEN** it fills the button, tints the slider's filled track, backs the text field, and backs the label without recolouring the label's glyphs
- **AND** both backends agree on which surface the value paints for each kind

#### Scenario: Selected state is derived from the carried colour
- **WHEN** a `Button` carrying a colour is selected, hovered, pressed, or disabled
- **THEN** each backend derives that state's appearance from the carried colour
- **AND** neither backend substitutes a per-variant colour constant of its own

#### Scenario: A caption is a label node, not a field
- **WHEN** a form control is built with a caption through the component library
- **THEN** the caption appears in the tree as a `Label` node in the control's form-grid row with its own stable id
- **AND** the `Node` record and the command buffer gain no caption field

#### Scenario: Appearance changes need no backend edit
- **WHEN** a producer changes the colour it passes to a control
- **THEN** that control's appearance changes in both backends
- **AND** no library, codec, or backend source change is required

### Requirement: sru-46 — Portable UI: hierarchical parent-relative coordinates
WHEN a portable tree crosses the model or the command buffer, THE runtime UI layer SHALL express every node's `Bounds` relative to its parent's coordinate space (the root's relative to the surface, and `ScrollArea` children relative to the scroll-content origin), SHALL express all `Draw` command geometry relative to the owning node's own origin with content clipped to the node's bounds, SHALL remove from both backends every coordinate-space classification heuristic — the draw-geometry family (`DrawCommandsLookLocal` and its per-command variants, and the `nodeLocal` dispatch flag) and the node-bounds family (`ExplicitBoundsAreParentLocal` / `explicitBoundsAreParentLocal`, which today decides whether a node's explicit bounds are parent-local or surface-absolute by testing containment within the parent) — so no backend guesses which space any geometry is in, and SHALL carry this coordinate semantics change together with the sru-45 style fields in a single version bump to version 2 applied consistently across every artifact that advertises the UI protocol version — the C++ `kCommandBufferVersion`, the TypeScript `COMMAND_BUFFER_VERSION`, and each Wasm package's exported `synth_browser_ui_protocol_version()` — retaining the strict version-equality check on both ends with no fallback decoding of version-1 buffers; the shell bundle and every app package SHALL be rebuilt and republished together against the new version.

#### Scenario: Moving a parent moves only one record
- **WHEN** a parent node's bounds change position while its subtree is unchanged
- **THEN** only that parent's node record differs on the wire
- **AND** every descendant's serialized bounds are byte-identical to the previous frame

#### Scenario: Draw geometry is node-local without guessing
- **WHEN** a `Draw` node's commands place geometry at the node's origin
- **THEN** both backends render it at the node's position by definition
- **AND** neither backend contains code that classifies command coordinates as local or absolute

#### Scenario: Scroll children ignore scroll offsets
- **WHEN** a `ScrollArea` is scrolled
- **THEN** its children's bounds in the tree and on the wire are unchanged
- **AND** the visible movement is entirely a backend view transform

#### Scenario: Version mismatch fails loudly
- **WHEN** a decoder receives a command buffer whose version differs from its own
- **THEN** decoding fails with an explicit version error and no frame is rendered
- **AND** no fallback or negotiation path exists

#### Scenario: Every version site advertises the same version
- **WHEN** the version-2 runtime is built
- **THEN** the C++ command-buffer constant, the TypeScript constant, and every Wasm package's exported UI protocol version all report version 2
- **AND** a package still advertising version 1 is rejected before any frame is rendered

#### Scenario: Publication moves as one set
- **WHEN** the version-2 runtime is published
- **THEN** the shell bundle and all app packages in the catalog are rebuilt against version 2 in one whole-catalog publication
- **AND** rollback restores the previous complete publication rather than mixing versions

### Requirement: sru-47 — Configuration pages: rebuilt on the component library
WHEN the Audio, Sync, File, and Controllers pages are rebuilt on the component library, THE runtime library SHALL preserve every behavior these pages are required to have by sru-3 through sru-13, sru-15 through sru-18, sru-26 through sru-33, and sru-34 — including Controllers edit-session stability (sru-11) and scrollable mapping reachability (sru-5) — while replacing manual pixel arithmetic with declarative layout; every form control on these pages SHALL have a visible caption naming what it controls (including the Audio page's output and input device selectors, visible while a device is selected), like-type controls SHALL align through the form grid, and the pages SHALL contain no text that conveys no information to the user, with any removal of text whose presence a spec scenario pins made only through an explicit spec change rather than silently.

#### Scenario: Page behavior suites stay green through migration
- **WHEN** each page's tree construction moves to the component library
- **THEN** the page's existing behavioral and simulation test suites pass unchanged in what they assert about behavior
- **AND** only position-pinning expectations are re-pinned to the new resolved layout

#### Scenario: Audio selectors are captioned
- **WHEN** the rebuilt Audio page renders with an output selector and (when configured) an input selector
- **THEN** each selector shows a visible caption identifying it while a device is selected, in both backends
- **AND** a hidden input selector shows no orphaned caption

#### Scenario: Controllers edit session survives the rebuild
- **WHEN** a user edits mapping rows while a Controllers section stays expanded on the rebuilt page
- **THEN** the edit-session row list behaves exactly as sru-11 requires (no re-coalescing, stable rows, session flush on collapse)

#### Scenario: Content audit removes only uninformative text
- **WHEN** the per-page content audit completes
- **THEN** removed strings are limited to text carrying no user information (decorative chrome, duplicate labels, leaked placeholders)
- **AND** every status or readout pinned by an existing requirement remains present and reachable

#### Scenario: Hierarchy replaces offset arithmetic
- **WHEN** the rebuilt pages' sources are inspected
- **THEN** page-level `y +=` style offset accumulation and per-site pixel constants are gone
- **AND** grouping is expressed through nested sections, rows, and grids

### Requirement: sru-48 — Portable UI: named visual criteria with a Playwright verification loop
WHEN the rebuilt pages' appearance is verified, THE synth project SHALL define named visual acceptance criteria — like-type controls share column positions; all spacing drawn from the library's shared spacing metrics; every form control captioned; no overlapping nodes and no container overflow on either axis at the reference viewport; every text element rendered within its allocated extent; text contrast meeting at least the WCAG AA 4.5:1 ratio against its effective background; no non-informative text — SHALL fix one named reference viewport, device scale factor, and deterministic page and app fixture state under which every criterion is evaluated and every screenshot captured, SHALL enforce the machine-checkable criteria through Playwright structural assertions against the rendered browser DOM (including an extent check that re-renders at a different root extent and asserts weighted redistribution, verifying sru-50's property without implementing host resizing) and through headless bounds assertions for the resolved portable tree, and SHALL drive overall appearance to a good state through an iteration loop in which page and app screenshots are captured and evaluated against the criteria, concluding in a single collaborative human review of the final appearance. **Appearance SHALL NOT be pinned as a regression gate**: no screenshot is committed as a baseline, and no pixel-diff comparison gates verification. Screenshots exist to inform the iteration and the final human review, not to fail a later build. The machine-checkable criteria above are the durable regression surface — they are structural and hold at any extent — while the aesthetic judgement is made once, together, and is not re-litigated by a test.

#### Scenario: Appearance is reviewed once, not pinned
- **WHEN** the rebuilt pages and apps reach a state satisfying every machine-checkable criterion
- **THEN** their appearance is reviewed collaboratively with a human and adjusted to a final agreed result
- **AND** no screenshot baseline is committed and no later build fails on a rendered-appearance difference

#### Scenario: Alignment is machine-checked
- **WHEN** the Playwright suite renders a rebuilt config page
- **THEN** it asserts equal rendered x-positions for controls declared in the same form-grid column
- **AND** asserts no horizontal overflow at the reference viewport

#### Scenario: Containment and overlap are machine-checked
- **WHEN** the structural assertions run over a rendered page
- **THEN** every node's rendered rectangle lies within its parent's containing rectangle on both axes — that rectangle being the parent's declared scroll-content rectangle where the parent is a `ScrollArea`, so a row below the visible viewport is contained rather than overflowing
- **AND** a `ScrollArea` whose content exceeds its visible extent clips that content to its viewport and leaves it scroll-reachable, which is asserted separately from containment
- **AND** no two sibling nodes' rectangles intersect, and no node overhangs its parent's rectangle, except where the producer declares a deliberate overlay or overhang — such as a visualizer underlay beneath an encoder
- **AND** every gap and padding between stacked siblings equals a value drawn from the library's shared spacing metrics

#### Scenario: Text fit is machine-checked
- **WHEN** the structural assertions run over a rendered page
- **THEN** every text element fits its allocated extent with no overflow or unintended truncation at the reference viewport
- **AND** a failing element is named, exposing a too-tight sizing reservation

#### Scenario: Contrast is checked against rendered styles
- **WHEN** the structural assertions run over a rendered page
- **THEN** each text element's computed colour is checked against its effective background for the stated minimum contrast
- **AND** a failing pair names the element and the computed colours

#### Scenario: Baselines gate on a human
- **WHEN** the visual iteration loop concludes for a page
- **THEN** its screenshots become baselines only after recorded human sign-off
- **AND** CI thereafter compares renders against the approved baselines

#### Scenario: Unapproved drift is a regression
- **WHEN** a later change alters a page's rendering without updating its baseline
- **THEN** the Playwright comparison fails
- **AND** an intended change passes only by updating the baseline with renewed sign-off in the same change

### Requirement: sru-49 — Portable UI: backends are dumb renderers
WHEN a backend renders a portable tree, THE backend SHALL receive a fully resolved tree and paint it without performing layout, inferring coordinate space, supplying default sizes, or deciding appearance — every position, extent, and carried style it needs is on the node — and THE runtime UI layer SHALL remove from both backends both coordinate-space classifier families (the draw-geometry classifier and the node-bounds parent-local classifier), the auto-flow layout cursor with its per-kind default-size table and lowest-Draw starting-y scan, and the hardcoded per-variant colour constants as appearance policy; backend responsibilities SHALL be limited to toolkit realization, input translation into portable actions, scroll view transforms, the existing uniform surface scaling, interaction-state presentation derived from carried properties, and fitting text within the extent already resolved for it — a purely local decision requiring no knowledge of the surrounding tree, which each backend SHALL make for itself by shrinking, truncating, or clipping so that text never overflows its node's bounds.

#### Scenario: Rendered positions are derivable from the tree alone
- **WHEN** either backend renders any node of a resolved tree
- **THEN** the node's rendered position equals its own resolved bounds offset by the accumulated origins of its ancestor chain (plus scroll offset and uniform surface scale where applicable)
- **AND** a geometry property test in each backend's suite verifies this for every node of a representative tree

#### Scenario: A node without resolved bounds is not rescued
- **WHEN** a tree reaches a backend containing a node with no resolved bounds
- **THEN** the backend renders it at its parent's origin with zero-based extent rather than flowing or sizing it
- **AND** no backend contains a layout cursor or default-size table to fall back on

#### Scenario: Deleted policy stays deleted
- **WHEN** backend sources are inspected
- **THEN** they contain no draw-geometry coordinate classifier, no node-bounds parent-local classifier, no auto-flow cursor or per-kind default-size table, and no per-variant colour table deciding carried appearance
- **AND** the inspection runs as a committed grep-backed check, not a one-time review

#### Scenario: Fitting text does not feed layout back
- **WHEN** a backend's font renders a string wider than the extent resolved for it
- **THEN** the backend shrinks, truncates, or clips the text within the node's bounds
- **AND** the node's resolved bounds are unchanged, so no other node moves
- **AND** the backend reports no measurement back into layout

### Requirement: sru-50 — Portable UI: extent-driven layout
WHEN the component library resolves a tree, THE layout resolver SHALL derive every position and extent from the extent it is given rather than from any hardcoded surface size, so that rebuilding the same producer code against a different root extent redistributes weighted and intrinsic children correctly with no producer-side recomputation and no backend involvement; this change SHALL establish that property and SHALL NOT introduce host window resizing, minimum host-window, surface, or root-extent declarations, or any change to the existing uniform surface scaling, which remains exactly as it is today. This exclusion covers host and surface sizing only; it does not restrict sru-44's per-child minimum and maximum layout extents, which are ordinary layout inputs.

#### Scenario: A different root extent redistributes children
- **WHEN** the same producer code is resolved twice against root extents of different widths
- **THEN** the weighted children resolve to proportionally different extents in the two results
- **AND** fixed and intrinsic children keep their extents in both

#### Scenario: No hardcoded surface size in the resolver
- **WHEN** the layout resolver's sources are inspected
- **THEN** no resolution path depends on a compiled-in surface width or height
- **AND** every container resolves against the extent passed to it

#### Scenario: Resizing is not implemented here
- **WHEN** this change is complete
- **THEN** host window resize handling is unchanged
- **AND** the existing shrink-to-fit uniform surface scaling behaves as it did before

### Requirement: sru-51 — Portable UI: enforced layering
WHEN the portable UI stack is organized, THE runtime UI layer SHALL maintain explicit layers with bounded knowledge — the model (node/tree/draw/colour/text-style/action data and its coordinate contract, knowing nothing above it), the component library with layout resolver and metrics contract (knowing only the model; owning all layout and sizing policy), producers (config pages and apps, owning their own content and appearance choices; knowing model and library; JUCE-free; no wire or backend knowledge), the wire codec (model to bytes and back; no policy), and the backends (consuming resolved trees and translating input; never including the library's authoring or layout API; containing no layout, sizing, coordinate, or appearance policy) — and SHALL enforce these boundaries through JUCE-free compile tests for the model, library, and producer layers and a committed include-graph inspection for the codec and backend layers.

#### Scenario: Library and producers compile JUCE-free
- **WHEN** the JUCE-free test target builds the component library, config pages, and app surfaces
- **THEN** they compile without JUCE headers
- **AND** without any backend or wire-codec includes

#### Scenario: Backends do not include authoring machinery
- **WHEN** the committed include-graph inspection runs over backend sources
- **THEN** neither backend includes the component library's authoring or layout headers
- **AND** the inspection fails if a deleted policy symbol (layout cursor, default-size table, coordinate classifier, per-variant colour table) reappears

#### Scenario: Appearance ownership is single-layer
- **WHEN** a producer's appearance is changed
- **THEN** the edit happens in that producer's own sources
- **AND** no library, codec, or backend source changes

### Requirement: sru-52 — Portable UI: Draw node click actions
WHEN a portable `Draw` node carries a plain click action, THE runtime UI layer SHALL dispatch that action on a single click in every backend, independently of whether the node also carries a pointer-drag or double-click action, and the component library SHALL let a producer attach that click action when the node is constructed; a `Draw` node carrying no action SHALL remain non-interactive and SHALL NOT intercept pointer input.

#### Scenario: Click-only Draw node dispatches on single click
- **WHEN** a tree contains a `Draw` node whose only interaction is a plain click action, and the user single-clicks it
- **THEN** the JUCE backend dispatches that action exactly once
- **AND** the browser backend dispatches that action exactly once
- **AND** neither backend requires a double-click or a drag to reach it

#### Scenario: Click coexists with drag and double-click
- **WHEN** a `Draw` node carries a click action, a pointer-drag action, and a double-click action
- **THEN** a single click dispatches the click action alone
- **AND** a drag gesture past the drag threshold dispatches the pointer-drag action and no click action
- **AND** a double-click dispatches the same ordered sequence of actions, with the same number of click dispatches, that a `Button` node carrying the same click and double-click actions dispatches for a double-click in that same backend

#### Scenario: The double-click sequence is pinned exactly
- **WHEN** each backend's suite exercises a double-click on a `Draw` node carrying both a click and a double-click action
- **THEN** the test asserts the complete ordered list of dispatched actions and the exact count of each
- **AND** the same assertion is made for a `Button` node carrying the same actions, so any divergence between the two kinds fails

#### Scenario: Inert Draw nodes stay transparent to input
- **WHEN** a `Draw` node carries no click, drag, or double-click action
- **THEN** neither backend dispatches an action for pointer input over that node
- **AND** the node does not intercept pointer input from what is behind it

#### Scenario: Disabled Draw nodes do not dispatch
- **WHEN** a `Draw` node carrying a click action is disabled
- **THEN** clicking it dispatches no action in either backend

### Requirement: sru-53 — Portable UI: standard synth application layout
WHEN a synth application presents the conventional encoder-and-visualizer arrangement, THE component library SHALL provide one reusable standard layout component composing a title row, a visualizer column holding two stacked component slots anchored on the left, an encoder region to its right, and a widget bay spanning the bottom; each slot and region SHALL accept an arbitrary application-supplied component and THE layout SHALL prescribe nothing about their contents — no grid, no cell count, no visualizer or encoder semantics — beyond position and extent; the layout's proportions SHALL be derived from the arrangement Braid 4 and Mini App already share; every semantic control an application presents outside its visualizer slots and encoder region SHALL be supplied to the widget bay, so that both Braid 4 and Mini App populate the bay and no application-supplied control is left without a declared region; and Braid 4 and Mini App SHALL both be built on the component rather than on their own hand-computed layouts, resolving through the ordinary layout resolver so its regions redistribute under sru-50.

#### Scenario: Slots accept arbitrary components
- **WHEN** one application supplies a grid of scope cells to a visualizer slot and another supplies a single waveform component to the same slot
- **THEN** both resolve correctly within the slot's extent
- **AND** the standard layout contains no grid, cell-count, or content-kind logic of its own

#### Scenario: Both applications share the standard layout
- **WHEN** Braid 4 and Mini App build their main surfaces
- **THEN** both compose the same standard layout component
- **AND** neither computes its own region positions
- **AND** `Braid4PageLayout`, `Braid4EncoderGridLayout`, `MiniAppPageLayout`, and `EncoderGridLayout` no longer own surface-level position arithmetic

#### Scenario: Application content keeps its existing behavior
- **WHEN** Braid 4 supplies its VCO scope cells to the upper slot, its LFO scope cells to the lower slot, its sixteen encoders to the encoder region, and its four bank buttons, scene buttons, and scene-blend slider to the widget bay
- **THEN** every scope remains individually addressable and independently bounded as sru-21 requires
- **AND** every one of those semantic controls dispatches the same action it dispatches today

#### Scenario: Every application control has a region
- **WHEN** Mini App builds its main surface with its waveform components, sixteen encoders, two bank buttons, four toggles, scene buttons, Start and Stop buttons, and two sliders
- **THEN** every one of those controls resolves inside a declared standard-layout region
- **AND** no control is positioned outside the layout or overlapping another control

#### Scenario: An application may leave the widget bay empty
- **WHEN** an application supplies no widget-bay content
- **THEN** the bay occupies no space and the regions above it take its extent
- **AND** no placeholder or empty chrome is rendered

#### Scenario: Standard layout resolves like any component
- **WHEN** the standard layout is resolved against different root extents
- **THEN** its regions redistribute through the ordinary resolver with no layout logic of its own outside container declarations

### Requirement: sru-54 — Portable UI: every container absorbs its overflow or fails loudly
WHEN the component library resolves a container whose in-flow children cannot fit its extent along the stacking axis, THE layout resolver SHALL treat that as an error rather than an accepted outcome: it SHALL fail with a diagnostic naming the container, the axis, the extent available, the extent required, and the identity of the first child that does not fit, and it SHALL NOT silently clip, truncate, or drop the overflowing children. A container SHALL be able to absorb its own overflow by declaring either a `ScrollArea`, whose children lay out in scroll-content space and whose resolved content extent the resolver publishes so the tail stays reachable, or at least one weighted in-flow child that takes up the remaining space; a container that declares neither and whose intrinsic content exceeds its extent is a producer defect, not a rendering outcome. THE component library SHALL NOT require producers to express sizes as pixel literals to satisfy this requirement — an item inside a scrolling region legitimately carries its own extent along the scroll axis, because a fraction of the container would be circular for a list whose length varies.

#### Scenario: A page that cannot fit its surface fails at build time
- **WHEN** a page's in-flow content exceeds the surface extent it is resolved against, and the page declares no scroll area and no weighted child to absorb the difference
- **THEN** resolution fails with a diagnostic naming the container, the axis, the available and required extents, and the first child that does not fit
- **AND** no tree is handed to a backend, so the failure cannot reach a user as invisible clipped content

#### Scenario: A scroll area absorbs a list longer than its viewport
- **WHEN** a list of arbitrary length is declared inside a `ScrollArea` whose viewport is smaller than the list
- **THEN** resolution succeeds, every item keeps its own extent, and the resolver publishes a scroll-content extent that contains the last item
- **AND** the same declaration resolves at a different viewport extent with no producer change

#### Scenario: A weighted child absorbs the remainder
- **WHEN** a container's other children are intrinsic and one child is weighted
- **THEN** the weighted child takes the remaining space and resolution succeeds at any container extent large enough for the intrinsic children

#### Scenario: The rebuilt config pages absorb their own content
- **WHEN** each rebuilt config page is resolved at the smallest surface extent any first-party app declares
- **THEN** every page resolves without error, with its variable-length region absorbing the difference rather than the page relying on the surface being tall enough

### Requirement: sru-55 — Portable UI: container background and border
WHEN a portable container is constructed, THE component library SHALL accept the container's own appearance at construction on the same footing as a semantic control's — a background fill colour and a border described by colour, width, and corner radius — for `Root`, `Row`, `Section`, and `ScrollArea`, carried on the node record as optional values with explicit wire presence, absent meaning the backend's plain default look; and both backends SHALL render the carried fill and border, the fill covering the container's own area including its padding and the gaps between its children, which no child's colour can paint. This closes the gap where sru-45 already assigned `Root`, `Row`, `Section`, and `ScrollArea` the meaning "container or surface background fill" and both backends already rendered it, while no container builder accepted a colour, so no producer could ask for one.

#### Scenario: A panel is a panel
- **WHEN** a producer constructs a section carrying a fill colour and a border
- **THEN** both backends paint that fill across the section's whole area, including its padding and the gaps between its children, with the border drawn at the declared width, colour, and corner radius

#### Scenario: Container appearance needs no out-of-flow stand-in
- **WHEN** a page needs a filled, bordered, rounded panel behind a group of controls
- **THEN** it declares the appearance on the container itself
- **AND** it does not emit an out-of-flow `Draw` underlay to stand in for the container's own background

#### Scenario: Unstyled containers keep the default look
- **WHEN** a container carries neither fill nor border
- **THEN** both backends render their existing default appearance for that container kind
