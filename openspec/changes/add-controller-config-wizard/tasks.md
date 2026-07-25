## 1. Browser-First Acceptance Contract

- [ ] 1.1 Extend the browser/Web MIDI test seam with deterministic MF Twister input/output ports and helpers that can add, remove, and duplicate recognized pairs without real hardware.
- [ ] 1.2 Add a failing Playwright acceptance test for the exact Controllers → Configuration Wizard → Submit three-click path, including Encoder Slot 0, the six visible defaults in a two-column 3+3 layout, exactly six generated buttons, all sixteen encoders on slot 0, endpoint identities, wizard id, warning clearance, and runtime-configuration save.
- [ ] 1.3 Add failing Playwright cases for disabled zero-candidate state, multiple-candidate selection, Ignore from an available row and from the unique-candidate form, warning return after remove-from-blacklist, cached-warning recomputation after lifecycle commits, numeric validation/disconnect/stale-session refusal with retained form values, deterministic suffix naming, rename, delete, destructive full-profile reconfigure, and the absence of Ignore while reconfiguring.

## 2. Instrument Disposition and Inert Runtime Behavior

- [ ] 2.1 Add JUCE-free model tests for Active/Blacklisted record validity, name uniqueness across dispositions, optional opaque wizard id on Active records, required non-empty opaque wizard id and endpoint pairs on Blacklisted records, registry-independent validity, dormant-profile handling, ordered add/rename/replace/remove operations, and middle/trailing record removal.
- [ ] 2.2 Extend the MIDI instrument model with Active/Blacklisted disposition, optional stable wizard id, and optional dormant profile representation while adapting existing callers to require a valid profile only for Active records.
- [ ] 2.3 Add persistence tests for the new instrument schema, previous-schema-as-Active/no-wizard-id migration, manual Active omission of wizard id, wizard Active and Blacklisted round trips, unknown-but-well-formed wizard-id preservation, dormant profile round trip, retained multi-kind round-trip coverage, and atomic rejection of malformed/empty wizard ids, malformed dispositions, duplicate names, missing active profiles, or incomplete blacklisted records.
- [ ] 2.4 Implement the nested instrument schema update and backward-compatible reader without adding a separate runtime blacklist document.
- [ ] 2.5 Add reconciliation planner/executor tests proving disposition handling precedes Active matching/status rules; Blacklisted records with present or absent populated references remain deliberately `Unconfigured`, never become Offline, and never open, claim, update, or resync endpoints; and changing an online Active record to Blacklisted closes both endpoints into that inert state.
- [ ] 2.6 Implement blacklist-aware reconciliation actions/state while preserving all existing Active identifier/name matching, contention, offline, and resync behavior.
- [ ] 2.7 Add engine/runtime tests for a Blacklisted slot's explicit drop/no-op input processor, absent output processors/sender sink, Active-to-Blacklisted teardown, Blacklisted-to-Active rebuild, and record deletion slot resizing.
- [ ] 2.8 Implement blacklist-aware MIDI processor construction and runtime rebuild/resize behavior.

## 3. Wizard Core, Discovery, and MF Twister Generation

- [ ] 3.1 Add JUCE-free tests for `ControllerConfigForm`, `ControllerWizard`, and the typed wizard adapter, including concrete form pairing, explicit ownership, wrong-form refusal, validation errors, and form-state retention.
- [ ] 3.2 Implement the abstract form/wizard contracts and checked `TypedControllerWizard<Form>` adapter without JUCE or backend dependencies.
- [ ] 3.3 Add pure discovery tests for registry order, case-insensitive exact alias matching, explicit rejection of prefix/suffix/fuzzy names, unmatched-name diagnostics, recognized pair creation, exclusive endpoint use, deterministic duplicate-device pairing, exact-identifier/name-fallback claiming, half-configured claim suppression, and Active/Blacklisted availability classification.
- [ ] 3.4 Implement the baked registry, stable wizard descriptors, `WizardCandidate`, and pure discovery/classification API with explicit MF Twister input/output alias lists and diagnostic unmatched-name data.
- [ ] 3.5 Add MF Twister form tests for one Encoder Slot control defaulting to 0; exactly six message/argument controls in left CC 8–10 and right CC 11–13 columns; Hold Reset, Hold Random, Hold Random Mod, Next Bank, Start, and Previous Bank defaults; the exact closed message-choice set with no None/unassigned option; the wizard-owned argument enablement table (not generic `UISystemMessageHasArg`) with arguments enabled only for gesture select, Bank Select, and Scene Select; and empty, negative, non-base-10, overflow, and valid `std::size_t` input handling.
- [ ] 3.6 Implement `MfTwisterConfigForm` as a portable in-memory surface using the existing system-message catalog and stable wizard node/action ids.
- [ ] 3.7 Add generation tests proving all sixteen encoder defaults target the selected Encoder Slot; exactly six side buttons occupy channel 3 CCs 8–13; hold choices emit release messages; Bank Select carries the selected slot plus its bank argument; Next/Previous Bank carry the selected slot and ignore disabled argument state; disabled values cannot affect messages; side buttons are input-only; discovered endpoints and wizard id are installed; and invalid generation is atomic.
- [ ] 3.8 Implement the MF Twister wizard generator by supplying six typed associations to `MfTwisterDefaultProfileConfig`.

## 4. Portable Runtime and Controllers Workflow

- [ ] 4.1 Extend JUCE-free runtime-main/controller-surface fixtures with wizard discovery snapshots, active wizard-session ownership, instrument commit, and runtime-configuration save callbacks.
- [ ] 4.2 Add portable-tree tests for the sidebar warning outside the Controllers page, classification recomputation after device changes and successful instrument commits, disabled zero-candidate wizard action and explanation, Available controllers rows, Configure/Ignore actions, unique direct form opening, multi-candidate chooser, the one-slot/exactly-six-row form, form Submit/Ignore, and warning refresh.
- [ ] 4.3 Implement runtime cached-device classification and sidebar warning plumbing without forcing enumeration/reconciliation for unchanged lists and without placing device matching or wizard policy in tree construction or a renderer.
- [ ] 4.4 Implement `ControllersPageSurface` wizard-session state and portable chooser/form routing, including one-session ownership, candidate/existing-record revalidation, disappeared chooser entries, inline errors, retained state, deterministic suffix naming, Ignore only for new candidates, atomic commit, and save only after successful Submit/Ignore.
- [ ] 4.5 Add view-model and portable-page tests for unique rename; Rename/Delete and generic editing on manual/legacy Active rows; registry-resolved wizard-id gating for Reconfigure/Blacklist/Configure; recoverable unknown opaque ids; blacklisted Rename/Configure/Remove-from-blacklist; mandatory dormant retention; hidden blacklisted mapping/endpoint controls; offline reconfigure; exact-shape compatibility across all turn/push/output/system/bank mappings; extra or incoherent mapping rejection to defaults-with-warning; destructive full-profile replacement; and preserved name/endpoints/wizard-id/order.
- [ ] 4.6 Implement controller lifecycle view-model APIs and portable row actions through the existing instrument-edit/rebuild/reconcile path.
- [ ] 4.7 Add focused runtime-configuration tests proving successful wizard/blacklist lifecycle commits save the new instrument schema and refused actions do not overwrite persisted configuration.

## 5. Chrome Completion

- [ ] 5.1 Regression-test the existing generic portable enabled-state path, then update the generic browser command-buffer/control backend only if required to render and suppress actions for disabled wizard fields/button, warning marker, chooser, and lifecycle controls, with no MF Twister or blacklist policy in TypeScript.
- [ ] 5.2 Make the browser-first Playwright tests from task group 1 pass, including three-click installation and browser persistence reload.
- [ ] 5.3 Run browser unit, command-buffer, MIDI bridge, and targeted Playwright suites and fix any generic backend regressions before starting JUCE parity work.

## 6. JUCE Backend Parity

- [ ] 6.1 Add JUCE Controllers-page simulation tests that drive the same stable portable node ids/actions for warning, disabled zero-candidate state, unique and multiple candidate flows, Encoder Slot, all six form rows, Submit/Ignore, rename, delete, blacklist removal, and reconfigure.
- [ ] 6.2 Regression-test the existing generic portable enabled-state path, then update the generic JUCE portable backend only if needed for the wizard's semantic nodes and action suppression on disabled controls, with no controller-specific policy.
- [ ] 6.3 Add or extend JUCE backend parity assertions comparing the MF Twister tree's ids, labels, options, selected values, enabled state, and action results with the browser/portable expectations.
- [ ] 6.4 Build and run the Controllers harness and focused JUCE portable/runtime page tests, confirming both configuration and blacklist flows are visually reachable and dispatch through the shared surface.

## 7. Final Verification and Documentation

- [ ] 7.1 Run focused JUCE-free instrument, reconciliation, engine, view-model, Controllers page, runtime main, browser runtime, and persistence tests.
- [ ] 7.2 Run the complete synth C++ test suite, browser unit/Playwright suite, and JUCE application/test build matrix with no skipped wizard or blacklist cases.
- [ ] 7.3 Update synth runtime/controller documentation and spec-to-test coverage mappings for stable wizard ids, exact MF Twister aliases and unmatched-name diagnostics, the controller-wide Encoder Slot and six-button choice/argument semantics, destructive reconfigure behavior, blacklist persistence, three-click UX, and browser/JUCE acceptance coverage.
