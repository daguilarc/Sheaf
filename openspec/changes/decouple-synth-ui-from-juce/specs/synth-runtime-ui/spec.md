## MODIFIED Requirements

### Requirement: sru-1 — Layout: main pane with sidebar and content host
WHEN a runtime-hosted application presents UI, THE runtime library SHALL provide a main pane composed of a right-hand sidebar menu subcomponent and a content host filling the remaining area; the content host SHALL display the application's portable UI surface through the active backend by default, SHALL display exactly one library page at a time when one is opened from the sidebar, SHALL return to the application's UI surface when the page is dismissed, and SHALL relayout the sidebar and content on window resize.

#### Scenario: Default view is the application
- **WHEN** the main pane opens with no page selected
- **THEN** the content host shows the application's portable UI surface, adapted by the active backend, beside the sidebar

#### Scenario: Page opens and returns
- **WHEN** the user opens a sidebar page and then dismisses it
- **THEN** the page replaces the application UI while open
- **AND** the application UI surface is restored, retaining its state, on dismissal

#### Scenario: Resize relays out
- **WHEN** the window is resized
- **THEN** the sidebar keeps its width, and the content host (application or page) fills the remaining bounds

## ADDED Requirements

### Requirement: sru-12 — Portable UI: semantic controls and drawing commands
WHEN runtime UI pages or synth widgets render, THE runtime UI layer SHALL express their host-independent structure through a JUCE-free portable UI model that supports semantic controls (buttons, toggles, sliders, combo boxes, text fields, labels, rows, sections, scroll areas, and status text), stable node identities for stateful controls, input/action callbacks, and bounded drawing commands for bespoke visual widgets; JUCE renderers SHALL consume that model through backend adapters under `projects/synth/juce` rather than owning page behavior directly, and the model SHALL be shaped so neither the JUCE backend nor a future browser/DOM backend is forced through toolkit-awkward abstractions.

#### Scenario: Portable UI model compiles without JUCE
- **WHEN** a JUCE-free synth test includes the portable UI model and builds a representative miniapp/runtime page tree
- **THEN** it compiles without JUCE headers
- **AND** the tree can represent buttons, toggles, sliders, combo boxes, text fields, labels, scroll areas, and custom drawing nodes

#### Scenario: Bespoke widgets emit drawing commands
- **WHEN** the miniapp encoder or waveform widget renders through the portable UI layer
- **THEN** it emits host-neutral geometry, color, text, path/arc/line/fill, and interaction descriptions sufficient for the JUCE backend to reproduce the existing visual widget

#### Scenario: Semantic controls remain backend-native
- **WHEN** the Audio, File, or Controllers page renders a form-like control through the portable UI layer
- **THEN** the page describes the control semantically rather than as raw drawing only
- **AND** the JUCE backend may realize it as native JUCE controls while a browser backend could map it to DOM controls

#### Scenario: Backend owns toolkit details
- **WHEN** a JUCE backend renders a portable UI tree
- **THEN** all JUCE component construction, graphics calls, focus handling, and toolkit-specific event translation happen inside JUCE-owned backend code under `projects/synth/juce`
- **AND** the portable UI tree producer remains free of JUCE references

### Requirement: sru-13 — Controllers page: DOM-friendly semantic presentation
WHEN the Controllers page is rendered, THE runtime UI layer SHALL derive a DOM-friendly semantic tree from the JUCE-free `MidiConfigViewModel`, preserving the page's existing controller list, endpoint selection, connection state display, add-controller flow, expandable config sections, mapping rows, block rows, add/delete affordances, validation/refusal status, focus-safe refresh, and commit-through-`EditInstrument` behavior; the JUCE backend SHALL render that semantic tree without reducing current functionality, SHALL NOT treat the current dense Controllers page look and feel as a visual-parity target, and MAY improve spacing, visual layout grouping, labels, and control presentation without relaxing sru-11's row/block presentation-stability requirements.

#### Scenario: Controller workflows are preserved
- **WHEN** the user adds a controller, selects input/output endpoints, expands sections, edits mapping fields, adds or deletes individual rows, adds or deletes block rows, or changes launchpad variant controls
- **THEN** each accepted action is applied through the existing `MidiConfigViewModel` edit APIs and committed through the runtime's instrument edit path
- **AND** refused actions show a status reason without mutating the live instrument

#### Scenario: Connection and rebuild refresh survives the refactor
- **WHEN** MIDI connection state changes, a patch load/revert changes the instrument, or an out-of-band MIDI processor rebuild occurs
- **THEN** the Controllers page marks its semantic tree dirty and refreshes from the current instrument snapshot and connection state
- **AND** active text editing is not clobbered before the edit commits or focus is released

#### Scenario: Empty groups remain editable
- **WHEN** a controller section has no existing mappings in an addable group
- **THEN** the semantic tree still exposes the group's add affordance and, where supported, block-add affordance
- **AND** adding the first row creates any absent profile-config container needed by the view model

#### Scenario: JUCE renderer may improve presentation
- **WHEN** the JUCE backend renders the Controllers page semantic tree
- **THEN** it may replace the current dense component layout with clearer visual layout grouping, spacing, headers, and form controls rather than preserving the current appearance for its own sake
- **AND** every capability required by `sru-4` through `sru-11` remains available and testable

### Requirement: sru-14 — File page: portable patch explorer
WHEN the File page opens Save As or Load, THE runtime UI layer SHALL represent patch browsing and confirmation as a JUCE-free portable state machine over `synth::PatchBrowser`, including current relative path display, directory rows, selection, parent navigation, save-name entry for Save As, confirm/cancel actions, status text, and safe root-constrained path resolution; the JUCE desktop backend SHALL render and dispatch that semantic tree without using `juce::FileChooser`, and accepted confirmations SHALL call the runtime's existing `SavePatchAs` or `LoadPatch` paths.

#### Scenario: Save As uses in-page browser state
- **WHEN** the user chooses Save As from the File page
- **THEN** the portable tree shows a Save As browser rooted at the runtime patches root
- **AND** the user can type a patch name and confirm only when `PatchBrowser::ResolveSaveAsPath` accepts it
- **AND** confirmation dispatches the resolved path through the host save callback

#### Scenario: Load uses in-page browser state
- **WHEN** the user chooses Load from the File page
- **THEN** the portable tree shows a Load browser rooted at the runtime patches root
- **AND** directory rows, parent navigation, and selected directory confirmation are represented by portable nodes/actions
- **AND** confirmation dispatches the resolved directory through the host load callback

#### Scenario: Browser state is backend-neutral
- **WHEN** a JUCE-free test builds and drives the File page browser tree
- **THEN** it can inspect rows, navigate, cancel, enter save names, and confirm valid paths without JUCE headers
- **AND** the JUCE runtime File page host contains no `juce::FileChooser` usage
