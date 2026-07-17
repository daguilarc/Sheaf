## Why

The shared desktop runtime now renders every portable surface through the generic JUCE backend, but that backend still flattens the semantic tree and treats parent-local bounds as surface-absolute coordinates. Nested runtime pages therefore overlap and `ScrollArea` nodes do not scroll, even though the same portable trees render correctly in the browser and an older Controllers-specific JUCE renderer already demonstrates the required behavior.

## What Changes

- Make the generic JUCE portable backend preserve semantic parent/child structure and resolve explicit bounds in the same coordinate model as the browser backend.
- Render every generic `ScrollArea` as a real JUCE viewport with independent visible bounds and content extent, including horizontal and vertical scrolling.
- Preserve stable component identity, focus, actions, drawing, and nested-root auto-flow while moving controls into their semantic parents.
- Add generic-backend and desktop-shell regression coverage using the real shared Controllers page tree, including non-overlap and reachability of content beyond the viewport.
- Remove the obsolete Controllers-specific renderer/harness path once the harness and tests exercise the production generic backend.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `synth-portable-runtime-shell`: Require the generic JUCE backend to implement hierarchical portable layout, real scroll areas, and integrated desktop parity coverage for shared runtime pages.

## Impact

- Affected code: `projects/synth/juce/PortableJuceBackend.hpp`, its JUCE tests, the desktop runtime-shell integration tests, and the Controllers harness/backend files that currently exercise a non-production renderer.
- Affected systems: desktop JUCE rendering for all portable applications and runtime pages; browser rendering remains behaviorally unchanged and supplies the parity reference.
- Dependencies and serialized formats: no new dependency, public persistence format, MIDI contract, or application-specific UI branch.
