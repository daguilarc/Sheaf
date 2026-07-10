## ADDED Requirements

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

#### Scenario: Browser deadline sample is explicitly unavailable
- **WHEN** the browser host refreshes the sidebar before a browser callback-load metric has been designed
- **THEN** its services adapter supplies 0.0 percent rather than deriving a misleading value from the audio render timer
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
- **AND** the descendants render in the same surface positions as the flat JUCE backend

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
