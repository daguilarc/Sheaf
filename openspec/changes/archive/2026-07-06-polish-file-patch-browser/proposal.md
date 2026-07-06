## Why

The runtime File page currently exposes the right commands, but the load/save chooser reads as a rough utility panel: cramped rows, weak patch identity, ambiguous selection, and little of the polish now present in the Controllers pages. This matters now because patch load/save is a core runtime workflow, and the MIDI controller page work established a better pattern: a dedicated viewer/state surface, JUCE-free semantics, JUCE rendering as a thin backend, and simulation tests that catch layout and interaction drift.

## What Changes

- Replace the inline File page browser section with a dedicated patch-browser viewer model for Save As and Load flows, still rooted under the runtime-owned `patches/` directory.
- Restyle the File page around a clear patch header, command strip, status area, and full-height browser viewer with selected-row affordances, path breadcrumb, empty/error states, and explicit primary/cancel actions.
- Reuse the controller-page process: keep file-page/browser state and action routing in JUCE-free runtime UI code, with JUCE components acting as renderers.
- Preserve current behavior: New, Save, Save As, Load, Revert; first Save without a current patch opens Save As; Save As refuses invalid names and existing patch directories/files before dispatch while the patch manager remains the defensive authority; Load resolves selected patch directories under the patch root.
- Add deterministic tests for the browser model, portable tree, JUCE renderer, and model-based File page simulation comparable to the Controllers page simulation tests.
- Use the all-electric smart grid reference as a design precedent: full-page file workflow, selected list rows, save-name entry, OK/Cancel semantics, dark restrained styling, and sidebar-hosted page navigation.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-runtime-ui`: refine the File page requirements to require a polished dedicated patch-browser viewer, clearer visual states, and simulation-level test coverage for load/save flows.

## Impact

- `projects/synth/include/synth/RuntimePages.hpp`: split File page browser semantics into a dedicated JUCE-free viewer model and expand the file-page semantic tree.
- `projects/synth/include/synth/PortableUI.hpp`: add only generic node semantics, such as selected/enabled/variant state, if the polished browser needs them.
- `projects/synth/include/synth/PatchBrowser.hpp`: keep patch-root resolution and validation, adding metadata or helper state only if needed for the richer viewer.
- `projects/synth/juce/RuntimePagesJuce.hpp` and `projects/synth/juce/PortableJuceBackend.hpp`: render the updated semantic controls and styling without moving behavior into JUCE.
- `projects/synth/runtime/FilePage.hpp`: remains the runtime alias/host boundary unless implementation needs a dedicated host wrapper.
- Tests under `projects/synth/tests` and `projects/synth/juce`: add JUCE-free model/tree tests, JUCE renderer checks, and a deterministic File page simulation test that exercises open, select, navigate, save-name edit, confirm, cancel, resize, and invalid-input flows.
