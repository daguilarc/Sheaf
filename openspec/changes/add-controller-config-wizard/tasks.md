## 1. Browser-First Acceptance Contract

- [ ] 1.1 Extend the browser/Web MIDI test seam with deterministic MF Twister input/output ports and helpers that can add, remove, and duplicate recognized pairs without real hardware.
- [ ] 1.2 Add a failing Playwright acceptance test for the exact Controllers → Configuration Wizard → Submit three-click path, including the six visible defaults, installed active profile, endpoint identities, warning clearance, and runtime-configuration save.
- [ ] 1.3 Add failing Playwright cases for multiple-candidate selection, Ignore from an available row and from the unique-candidate form, warning return after remove-from-blacklist, validation/disconnect refusal with retained form values, rename, delete, and reconfigure.

## 2. Instrument Disposition and Inert Runtime Behavior

- [ ] 2.1 Add JUCE-free model tests for Active/Blacklisted record validity, name uniqueness across dispositions, required blacklist endpoint pairs, dormant-profile handling, ordered add/rename/replace/remove operations, and middle/trailing record removal.
- [ ] 2.2 Extend the MIDI instrument model with Active/Blacklisted disposition and optional dormant profile representation while adapting existing callers to require a valid profile only for Active records.
- [ ] 2.3 Add persistence tests for the new instrument schema, previous-schema-as-Active migration, active and blacklisted round trips, dormant profile round trip, and atomic rejection of malformed dispositions or records.
- [ ] 2.4 Implement the nested instrument schema update and backward-compatible reader without adding a separate runtime blacklist document.
- [ ] 2.5 Add reconciliation planner/executor tests proving Blacklisted records never open, claim, update, or resync endpoints and that changing an online Active record to Blacklisted closes both endpoints into inert state.
- [ ] 2.6 Implement blacklist-aware reconciliation actions/state while preserving all existing Active identifier/name matching, contention, offline, and resync behavior.
- [ ] 2.7 Add engine/runtime tests for a Blacklisted slot's explicit drop/no-op input processor, absent output processors/sender sink, Active-to-Blacklisted teardown, Blacklisted-to-Active rebuild, and record deletion slot resizing.
- [ ] 2.8 Implement blacklist-aware MIDI processor construction and runtime rebuild/resize behavior.

## 3. Wizard Core, Discovery, and MF Twister Generation

- [ ] 3.1 Add JUCE-free tests for `ControllerConfigForm`, `ControllerWizard`, and the typed wizard adapter, including concrete form pairing, explicit ownership, wrong-form refusal, validation errors, and form-state retention.
- [ ] 3.2 Implement the abstract form/wizard contracts and checked `TypedControllerWizard<Form>` adapter without JUCE or backend dependencies.
- [ ] 3.3 Add pure discovery tests for registry order, recognized pair creation, exclusive endpoint use, deterministic duplicate-device pairing, exact-identifier/name-fallback claiming, half-configured claim suppression, and Active/Blacklisted availability classification.
- [ ] 3.4 Implement the baked registry, wizard descriptors, `WizardCandidate`, and pure discovery/classification API with the MF Twister device-name descriptor and diagnostic unmatched-name data.
- [ ] 3.5 Add MF Twister form tests for the two-column button layout; six message/argument controls; Hold Reset, Hold Random, Hold Random Mod, Next Bank 0, Start, and Previous Bank 0 defaults; argument enablement; and invalid-value reporting.
- [ ] 3.6 Implement `MfTwisterConfigForm` as a portable in-memory surface using the existing system-message catalog and stable wizard node/action ids.
- [ ] 3.7 Add generation tests proving all sixteen encoder defaults, side-button channel 3 CCs 8–13, hold release messages, relative-bank slot arguments, disabled no-argument values, input-only side buttons, discovered endpoints, and atomic refusal.
- [ ] 3.8 Implement the MF Twister wizard generator by supplying six typed associations to `MfTwisterDefaultProfileConfig`.

## 4. Portable Runtime and Controllers Workflow

- [ ] 4.1 Extend JUCE-free runtime-main/controller-surface fixtures with wizard discovery snapshots, active wizard-session ownership, instrument commit, and runtime-configuration save callbacks.
- [ ] 4.2 Add portable-tree tests for the sidebar warning outside the Controllers page, Available controllers rows, Configure/Ignore actions, unique direct form opening, multi-candidate chooser, form Submit/Ignore, and warning refresh.
- [ ] 4.3 Implement runtime refresh/classification and sidebar warning plumbing without placing device matching or wizard policy in tree construction or a renderer.
- [ ] 4.4 Implement `ControllersPageSurface` wizard-session state and portable chooser/form routing, including candidate revalidation, inline errors, retained state, unique naming, atomic commit, and save only after successful Submit/Ignore.
- [ ] 4.5 Add view-model and portable-page tests for unique rename, active Reconfigure/Blacklist/Delete, blacklisted Rename/Configure/Remove-from-blacklist, hidden blacklisted mapping/endpoint controls, offline reconfigure, and preserved name/endpoints/order.
- [ ] 4.6 Implement controller lifecycle view-model APIs and portable row actions through the existing instrument-edit/rebuild/reconcile path.
- [ ] 4.7 Add focused runtime-configuration tests proving successful wizard/blacklist lifecycle commits save the new instrument schema and refused actions do not overwrite persisted configuration.

## 5. Chrome Completion

- [ ] 5.1 Update the generic browser command-buffer/control backend only as required to render the portable wizard nodes, disabled argument fields, warning marker, chooser, and lifecycle controls, with no MF Twister or blacklist policy in TypeScript.
- [ ] 5.2 Make the browser-first Playwright tests from task group 1 pass, including three-click installation and browser persistence reload.
- [ ] 5.3 Run browser unit, command-buffer, MIDI bridge, and targeted Playwright suites and fix any generic backend regressions before starting JUCE parity work.

## 6. JUCE Backend Parity

- [ ] 6.1 Add JUCE Controllers-page simulation tests that drive the same stable portable node ids/actions for warning, unique and multiple candidate flows, all six form rows, Submit/Ignore, rename, delete, blacklist removal, and reconfigure.
- [ ] 6.2 Update the generic JUCE portable backend only where needed for the wizard's semantic nodes and disabled controls, with no controller-specific policy.
- [ ] 6.3 Add or extend JUCE backend parity assertions comparing the MF Twister tree's ids, labels, options, selected values, enabled state, and action results with the browser/portable expectations.
- [ ] 6.4 Build and run the Controllers harness and focused JUCE portable/runtime page tests, confirming both configuration and blacklist flows are visually reachable and dispatch through the shared surface.

## 7. Final Verification and Documentation

- [ ] 7.1 Run focused JUCE-free instrument, reconciliation, engine, view-model, Controllers page, runtime main, browser runtime, and persistence tests.
- [ ] 7.2 Run the complete synth C++ test suite, browser unit/Playwright suite, and JUCE application/test build matrix with no skipped wizard or blacklist cases.
- [ ] 7.3 Update synth runtime/controller documentation and spec-to-test coverage mappings for wizard registration, known MF Twister aliases, blacklist persistence, three-click UX, and browser/JUCE acceptance coverage.
