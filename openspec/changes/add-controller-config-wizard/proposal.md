## Why

Configuring a newly connected MIDI controller currently requires manually adding a profile, assigning both endpoints, and editing low-level mappings. A controller-specific wizard can turn the common case into a three-click flow while keeping the generated profile editable through the existing Controllers page.

## What Changes

- Add a JUCE-free controller-wizard abstraction whose controller-specific configuration forms use the shared portable UI and retain their entered values in memory until submission.
- Add a baked registry that matches present MIDI input/output pairs to wizard factories, initially with one MIDI Fighter Twister wizard.
- Detect matched pairs that are neither configured nor blacklisted, show a warning on the Controllers sidebar entry, and expose them as available controllers on the Controllers page.
- Let a unique available controller open its wizard directly; let users choose among candidates when more than one is available.
- Add an explicit `Ignore` path for available controllers. Ignored pairs persist as visible blacklisted controller records, never open either endpoint, and provide rename, configure, and remove-from-blacklist actions.
- Add rename, delete, and wizard-based reconfiguration for existing controller profiles.
- Generate and install an MF Twister profile with exactly six buttons total, arranged as two columns of three message/argument pairs. Its defaults are hold Reset, hold Random, hold Random Mod, Next Bank for slot 0, Start Transport, and Previous Bank for slot 0.
- Verify the complete browser flow first with Playwright, then verify the same portable contracts and interactions through the JUCE backend.

## Capabilities

### New Capabilities

- `synth-controller-wizards`: Controller-pair discovery, wizard/form contracts, registry matching, MF Twister form defaults, profile generation, and blacklist candidate classification.

### Modified Capabilities

- `synth-runtime-ui`: Add warning, available-controller, wizard, blacklist, rename, delete, and reconfigure interactions to the portable runtime shell and Controllers page in both browser and JUCE hosts.
- `synth-midi-instrument`: Persist active versus blacklisted controller disposition and make blacklisted slots inert during profile construction and endpoint reconciliation.

## Impact

- Affected code is expected under `projects/synth/include/synth`, `projects/synth/src`, `projects/synth/runtime`, `projects/synth/browser`, and `projects/synth/juce`, with focused tests in the corresponding C++, JUCE simulation, and Playwright suites.
- The MIDI instrument JSON schema gains a backward-compatible controller-disposition field/version update; runtime configuration continues to own and save the instrument document.
- The portable UI and runtime service contracts gain wizard state, discovery state, and controller lifecycle actions without adding wizard policy to either renderer backend.
- No new third-party runtime dependency is required; Playwright remains a test-only dependency already present in the browser project.
