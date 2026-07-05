## Why

The synth runtime already keeps DSP, parameter state, patching, and most controller page logic JUCE-free, but the visible application and runtime UI are still expressed directly as JUCE components. A portable UI boundary is needed before the same synth applications can be hosted by a browser/Wasm runtime without duplicating every bespoke synth widget and runtime page.

## What Changes

- Introduce a JUCE-free synth UI interface for application widgets, runtime pages, drawing, layout, input events, and semantic controls.
- Refactor the miniapp UI so its visible behavior and layout remain unchanged while its application-facing components no longer include or name `juce::` types directly.
- Keep JUCE as a desktop backend implemented behind a narrow adapter layer that translates the portable UI interface into real JUCE components, drawing, controls, and events.
- Preserve runtime-owned audio, MIDI, patching, file, and controller management behavior while separating host I/O from the UI component contract.
- Reshape the Controllers page around a more semantic, DOM-friendly UI tree over the existing JUCE-free `MidiConfigViewModel`, preserving all edit/reconcile functionality while allowing the JUCE backend to render a richer, cleaner page.
- Add tests that enforce JUCE-free compilation for the portable UI/application layer and behavioral parity for miniapp and controller-page workflows.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-app-runtime`: Change the runtime application UI contract so applications expose a JUCE-free portable UI surface rather than a `juce::Component`, while the JUCE desktop runtime remains one host implementation.
- `synth-runtime-ui`: Change runtime pages and synth widgets to render through a portable semantic/drawing interface, including a DOM-centric Controllers page representation that the JUCE backend must implement without losing current behavior.

## Impact

- Affected code: `projects/synth/include/synth/AppConcepts.hpp`, `projects/synth/include/synth/AppContext.hpp`, `projects/synth/runtime/*`, `projects/synth/juce/*`, `projects/synth/apps/miniapp/*`, and synth UI tests.
- API impact: the full application UI hook will stop exposing JUCE types directly; desktop JUCE code will move behind adapter/backend files.
- Build impact: core synth tests must continue to build without JUCE; new compile checks should prove portable UI headers and miniapp UI code do not include JUCE.
- User impact: no visible regression in the miniapp; Controllers page keeps its existing functionality but may become cleaner and more structured through better abstractions.
