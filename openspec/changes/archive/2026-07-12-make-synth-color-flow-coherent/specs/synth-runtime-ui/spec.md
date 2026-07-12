## MODIFIED Requirements

### Requirement: sru-14 — Portable UI: semantic controls and drawing commands
WHEN runtime UI pages or synth widgets render, THE runtime UI layer SHALL express their host-independent structure through a JUCE-free portable UI model that supports semantic controls (buttons, toggles, sliders, combo boxes, text fields, labels, rows, sections, scroll areas, and status text), stable node identities for stateful controls, input/action callbacks, and bounded drawing commands for bespoke visual widgets using the canonical `synth::Color` RGBA type; JUCE renderers SHALL consume that model through backend adapters under `projects/synth/juce` rather than owning page behavior directly, and the model SHALL be shaped so neither the JUCE backend nor a future browser/DOM backend is forced through toolkit-awkward abstractions.

#### Scenario: Portable UI model compiles without JUCE
- **WHEN** a JUCE-free synth test includes the portable UI model and builds a representative miniapp/runtime page tree
- **THEN** it compiles without JUCE headers
- **AND** the tree can represent buttons, toggles, sliders, combo boxes, text fields, labels, scroll areas, and custom drawing nodes

#### Scenario: Bespoke widgets emit drawing commands
- **WHEN** the miniapp encoder or waveform widget renders through the portable UI layer
- **THEN** it emits host-neutral geometry, canonical `synth::Color` values, text, path/arc/line/fill, and interaction descriptions sufficient for the JUCE backend to reproduce the existing visual widget
- **AND** no second portable RGBA type is required

#### Scenario: Semantic controls remain backend-native
- **WHEN** the Audio, File, or Controllers page renders a form-like control through the portable UI layer
- **THEN** the page describes the control semantically rather than as raw drawing only
- **AND** the JUCE backend may realize it as native JUCE controls while a browser backend could map it to DOM controls

#### Scenario: Backend owns toolkit details
- **WHEN** a JUCE backend renders a portable UI tree
- **THEN** all JUCE component construction, graphics calls, focus handling, and toolkit-specific event translation happen inside JUCE-owned backend code under `projects/synth/juce`
- **AND** the portable UI tree producer remains free of JUCE references

## ADDED Requirements

### Requirement: sru-23 — Portable encoder consumes complete parameter snapshot
WHEN a portable synth surface builds an encoder, THE runtime UI layer SHALL derive its complete encoder draw state from one `Parameter::UIState` without app-supplied parameter, indicator, modulation-source, gesture, bank, or scope palette arguments.

#### Scenario: Shared builder is app independent
- **WHEN** Braid 4 and MiniApp build encoders from visible slot cells
- **THEN** both call the same reusable encoder-state and drawing functions
- **AND** neither app contains a color reconstruction or post-snapshot override
