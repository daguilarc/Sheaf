# synth-portable-runtime-shell Specification

Project: `projects/synth`. ID prefix: `sprs`.

## Purpose

Define the shared portable runtime shell that lets JUCE and browser runtimes host the same application-shaped synth app through one JUCE-free main component, host-service adapters, and browser UI/audio/MIDI verification.

## Requirements

### Requirement: sprs-1 — Composition: shared portable runtime main component
WHEN a full synth application is hosted by a UI runtime, THE synth library SHALL instantiate one JUCE-free main component templated on the application and host services that composes the application's portable surface, runtime sidebar, and runtime pages into one portable node tree and is used by both the JUCE and browser runtimes.

#### Scenario: Both hosts use the same component
- **WHEN** the JUCE and browser runtime templates are instantiated for the same conforming application
- **THEN** each host builds UI frames and dispatches UI actions through the shared portable runtime main component
- **AND** neither host separately defines top-level sidebar or page navigation behavior

#### Scenario: Concrete app knowledge is absent
- **WHEN** the shared component and both host adapters are inspected
- **THEN** they depend only on the application concept, portable surface, runtime services, and generic runtime page models
- **AND** they contain no miniapp-specific or other concrete-app layout, node IDs, actions, parameters, or branches

### Requirement: sprs-2 — Layout: app content remains intact beside runtime chrome
WHEN the shared main component builds its default tree, THE component SHALL preserve the application's configured origin-zero content rectangle and absolute surface-space node coordinates without clipping, SHALL translate the fixed 96-pixel runtime sidebar root and every sidebar descendant immediately to the app's right, and SHALL make runtime chrome additive to the application width; every nested portable root SHALL constrain horizontal auto-flow and wrapping to that root's own width while allowing resolved content to extend vertically.

#### Scenario: App dimensions are preserved
- **WHEN** an app config declares a 900 by 560 UI and its portable root matches those dimensions
- **THEN** the composite root is 996 by 560
- **AND** the app subtree remains at 0,0 with dimensions 900 by 560
- **AND** the sidebar starts at x 900
- **AND** every sidebar descendant uses absolute surface coordinates within x 900 through 996

#### Scenario: App auto-flow stays inside app content
- **WHEN** an application root contains semantic controls without explicit bounds
- **THEN** both backends resolve those controls against the application root's 900-pixel width rather than the 996-pixel composite width
- **AND** no app control flows into the sidebar band

#### Scenario: Runtime page replaces only app content
- **WHEN** the Audio, Controllers, or File page opens
- **THEN** exactly that page occupies the 900 by 560 app content rectangle
- **AND** the sidebar remains visible and unchanged at the right

#### Scenario: Invalid app root fails generically
- **WHEN** an application's portable tree has no single origin-zero root matching its configured positive UI dimensions, contains duplicate IDs, references unknown children, contains a cycle, or uses the reserved `runtime.*` node namespace
- **THEN** composition fails with a diagnostic naming the violated portable-tree contract
- **AND** no concrete-app fallback is used

### Requirement: sprs-3 — Services: compile-time-swappable host adapters
WHEN the shared component needs audio, MIDI/controller, patch/file, deadline, or runtime-configuration behavior, THE component SHALL obtain it through a host services concept selected at compile time, with JUCE and browser adapters that expose equivalent generic page snapshots and actions while keeping host API objects outside application code.

#### Scenario: JUCE services retain desktop behavior
- **WHEN** the JUCE main component refreshes or dispatches a runtime page
- **THEN** its adapter delegates to the existing JUCE runtime, engine, audio manager, MIDI connection manager, and patch operations
- **AND** existing desktop page behavior remains available

#### Scenario: Browser audio choices remain generic
- **WHEN** the browser Audio page snapshot is built
- **THEN** it contains exactly one output option with id `system_default` and label `System Default`
- **AND** it contains no input selector or named output-device enumeration

#### Scenario: Browser runtime pages remain application-agnostic
- **WHEN** browser sidebar actions open Audio, Controllers, or File
- **THEN** the shared runtime page models build and dispatch those pages through browser services
- **AND** application code and browser HTML remain unchanged for the selected page

#### Scenario: Controllers refresh through host services
- **WHEN** a UI tick observes changed controller endpoints, connection state, or instrument state
- **THEN** the active host services refresh the shared Controllers page surface and its device list
- **AND** JUCE and browser hosts do not maintain separate controller page models

#### Scenario: File page patch semantics are shared
- **WHEN** the shared File page dispatches direct or confirmed patch actions for New, Save, Revert, Confirmed Save As, Confirmed Overwrite Save As, or Confirmed Load
- **THEN** one JUCE-free runtime-file helper maps those actions to host-provided patch operations and shared status text for both JUCE and browser services
- **AND** raw Save As and Load actions remain shared File page surface actions that open the file browser/confirmation flow rather than invoking patch operations directly
- **AND** the helper projects current patch directory, patch name, patches root, and status text into `FilePageSnapshot` for both hosts
- **AND** host adapters provide only the backend-specific patch operation bindings and data paths, with JUCE patch bindings continuing to log their patch command results
- **AND** neither host maintains an independent File action ladder with duplicated status strings

#### Scenario: Browser deadline sample comes from the runtime-owned callback
- **WHEN** the browser host refreshes the sidebar before a browser callback-load metric has been published
- **THEN** its services adapter supplies 0.0 percent
- **AND** after runtime-owned AudioWorklet callbacks have run, it supplies the averaged callback deadline percentage rather than deriving a misleading value from the legacy audio render timer
- **AND** the JUCE host continues to supply its device-manager CPU usage percentage

### Requirement: sprs-4 — Interaction: browser pointer parity
WHILE a browser-rendered portable node with a pointer-drag action is being dragged, THE browser backend SHALL capture that pointer and dispatch accepted incremental deltas using the JUCE formula `(dx - dy) * 0.0025`, the absolute threshold `0.001`, current surface scale compensation, and existing replacement-delta action formatting.

#### Scenario: Horizontal and vertical motion combine incrementally
- **WHEN** a captured pointer moves right by 8 CSS pixels and up by 4 CSS pixels on an unscaled surface
- **THEN** the backend dispatches a delta of 0.03
- **AND** the next move is measured from that accepted pointer position rather than the original pointer-down position

#### Scenario: Capture keeps an edge drag alive
- **WHEN** a drag starts inside an encoder and the pointer moves outside its element before release
- **THEN** pointer moves continue to dispatch to the originating node until pointer up, cancel, or lost capture

#### Scenario: Tiny movement is retained until meaningful
- **WHEN** incremental movement produces an absolute delta below 0.001
- **THEN** no action is dispatched and the accepted anchor is not advanced

### Requirement: sprs-5 — Drawing: rounded portable arc parity
WHEN a portable Arc draw command is rendered by the browser Canvas backend, THE backend SHALL use rounded line caps and joins for that command without leaking Canvas state to subsequent commands.

#### Scenario: Stationary indicator remains visible
- **WHEN** an encoder indicator is represented by a zero-length or near-zero-length stroked arc
- **THEN** the browser rendering shows a rounded dot/cap comparable to the JUCE backend

#### Scenario: Arc state is isolated
- **WHEN** an Arc command is followed by a command with different stroke semantics
- **THEN** the following command is rendered with its own stroke state

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

### Requirement: sprs-7 — Verification: cross-backend and Playwright coverage
WHEN the shared main component change is verified, THE synth project SHALL include JUCE-free component/service tests, retained JUCE backend tests, TypeScript backend tests, and Playwright Chromium tests that exercise the static website, shared sidebar/pages, app rendering, audio flow, bidirectional SysEx MIDI with multiple devices and reconnect polling, mouse gestures, and desktop/narrow visual layout.

#### Scenario: Generic fake app runs first
- **WHEN** browser integration tests execute
- **THEN** a generic fake conforming app proves the shared component and browser services without concrete miniapp browser code
- **AND** the real miniapp smoke reuses exactly that runtime and backend

#### Scenario: Browser behavior is visible and interactive
- **WHEN** Playwright opens the built static site and activates the runtime
- **THEN** screenshots show intact app content and the right sidebar
- **AND** tests can open and return from runtime pages, drag and double-click app controls, observe finite non-silent audio, and verify MIDI bytes flow in both directions including SysEx

### Requirement: sprs-8 — Browser audio: runtime-owned AudioWorklet callback
WHEN the Chrome static site starts audio for any conforming browser-hosted application, THE browser runtime SHALL prefer a generic Emscripten Wasm AudioWorklet callback that invokes the C++ `Runtime<App>::Process` path against the same runtime/engine instance used by UI, MIDI, patch, and controller operations.

#### Scenario: No duplicated application runtime
- **WHEN** the browser audio path starts
- **THEN** it does not construct a second application or runtime instance inside JavaScript or an AudioWorklet
- **AND** it does not use concrete-application JavaScript, HTML, node IDs, actions, or layout

#### Scenario: Diagnostic ring is fallback only
- **WHEN** an injected runtime client does not expose the native AudioWorklet start hook
- **THEN** the browser audio bridge may use the existing JavaScript ring-producer path as diagnostic fallback
- **BUT** the default static-site runtime does not use the timer/ring producer for audio startup

#### Scenario: Browser callback verification
- **WHEN** Chromium can be launched with the required host permissions
- **THEN** Playwright verifies the built miniapp WASM starts the runtime-owned AudioWorklet callback and observes multiple non-silent processed blocks from callback diagnostics

### Requirement: sprs-9 — JUCE layout: hierarchical generic portable backend
WHEN the generic JUCE backend renders a portable node tree, THE backend SHALL retain semantic `Row`, `Section`, and `ScrollArea` parentage; SHALL resolve parent-local explicit bounds exactly once while preserving surface-absolute bounds and nested-root coordinate spaces; SHALL resolve unbounded controls within their nearest root before translating them into their resolved semantic host; and SHALL render labels, controls, panels, and draw commands in the resolved location and clipping hierarchy without application-specific node IDs or page branches. Both generic backends SHALL apply one portable draw-coordinate rule per draw node: when every explicit bound and point in the node's complete command buffer fits within the draw node, the buffer is node-local; otherwise the complete buffer is surface-space. Commands without explicit geometry SHALL NOT determine that classification, and containment SHALL use the portable floating-point node dimensions before backend pixel rounding. Either representation SHALL be normalized into the hosted draw component exactly once.

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

#### Scenario: Surface-space application drawing is not double-translated
- **WHEN** an application supplies draw-node bounds and draw commands in established surface-space coordinates
- **THEN** the JUCE backend positions the hosted draw component at the resolved node bounds
- **AND** normalizes the commands into that component without applying the node origin twice
- **AND** the application's scopes and complete encoder grid retain their pre-change surface positions

#### Scenario: A draw node does not mix coordinate spaces internally
- **WHEN** one endpoint of a surface-space line could also be interpreted as node-local but the other endpoint cannot
- **THEN** the browser and JUCE backends treat both endpoints as surface-space
- **AND** the line retains its intended geometry

#### Scenario: Separate paths in one node use the same coordinate space
- **WHEN** one surface-space path happens to fit within the draw node but another path in the same command buffer does not
- **THEN** the browser and JUCE backends treat the complete buffer as surface-space
- **AND** the paths retain their relative geometry

#### Scenario: Browser and JUCE main pages remain unchanged
- **WHEN** the generic hierarchy and scrolling implementation is applied
- **THEN** the existing browser application page remains behaviorally and visually unchanged
- **AND** the existing JUCE application page retains the same resolved geometry and rendered output as before the change

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

### Requirement: sprs-12 — Deployment: Cloudflare Pages publish artifact
WHEN the browser runtime has been built and its browser application artifact is present, THE synth browser package SHALL provide a deterministic static publish step that assembles a Cloudflare Pages-compatible publish directory containing the HTML/CSS shell, compiled browser runtime modules, browser application WASM sidecar files, and a `_headers` file that preserves cross-origin isolation, Web MIDI permissions, and WASM content typing.

#### Scenario: Publish directory contains deployable assets
- **WHEN** a developer runs the browser publish step after building the TypeScript runtime and browser application artifact
- **THEN** the generated publish directory contains the static shell at its root
- **AND** the generated publish directory contains the compiled browser runtime modules under `dist/src`
- **AND** the generated publish directory contains the browser application artifact and its sidecars under `dist/wasm`

#### Scenario: Cloudflare headers preserve runtime requirements
- **WHEN** Cloudflare Pages serves the generated publish directory
- **THEN** every route is covered by headers declaring `Cross-Origin-Opener-Policy: same-origin`
- **AND** every route is covered by headers declaring `Cross-Origin-Embedder-Policy: require-corp`
- **AND** every route is covered by headers declaring `Permissions-Policy: midi=(self)`
- **AND** WASM assets are covered by headers declaring `Content-Type: application/wasm`

#### Scenario: Missing application artifact fails early
- **WHEN** a developer runs the browser publish step before the browser application artifact exists
- **THEN** the publish step fails before writing a complete publish directory
- **AND** the diagnostic names the missing artifact path.

#### Scenario: Git-backed Cloudflare build bootstraps Emscripten
- **WHEN** Cloudflare Pages runs the synth browser Git-backed build command in an environment without `em++`
- **THEN** the build command installs and activates Emscripten before invoking the browser application Make target
- **AND** the build command publishes the generated site directory after the browser application artifact exists.
