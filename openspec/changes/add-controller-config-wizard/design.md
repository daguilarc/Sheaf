## Context

The synth already has the pieces needed to host this workflow without adding backend-specific UI: `MidiDeviceList` provides portable endpoint identity, `MidiInstrumentConfig` persists ordered controller slots, `MidiConfigViewModel` and `ControllersPageSurface` own JUCE-free Controllers-page state, and both JUCE and Chrome render the same portable `ui::NodeTree`. Controller edits already commit through `Engine::EditInstrument`, rebuild MIDI processors, reconcile endpoints, and save through the runtime configuration document.

What is missing is the layer between raw device discovery and a complete profile. The current page asks the user to add a kind, choose endpoints independently, and edit mappings. It also has no way to remember that a recognized physical pair was intentionally ignored. The design must preserve the existing generic/manual editor while providing a three-click path for known hardware.

In these artifacts, “controller record” and “controller slot” refer to the same ordered `MidiControllerSlot` entry; “slot” inside Encoder Slot or a MIDI message means a parameter-bank slot index instead.

C++ ownership is another constraint. The desired wizard API is conceptually covariant—a concrete wizard creates a concrete form—but `std::unique_ptr<Derived>` is not a covariant override of a function returning `std::unique_ptr<Base>`. The public abstraction therefore needs safe type erasure without falling back to ambiguous raw ownership.

## Goals / Non-Goals

**Goals:**

- Discover known input/output pairs and distinguish available, active, and blacklisted controllers.
- Provide an abstract, JUCE-free wizard/form contract with strongly paired concrete form and generator implementations.
- Render and edit wizard forms through the existing portable UI in Chrome and JUCE.
- Make the unique-controller success path Controllers → Configuration Wizard → Submit.
- Persist blacklist intent without pretending that blacklist is a hardware profile kind.
- Add rename, delete, and wizard-based reconfigure operations to existing controller rows.
- Ship one registry entry and wizard: MIDI Fighter Twister with six system-button choices.
- Exercise the full flow in Playwright first, then pin portable and JUCE parity.

**Non-Goals:**

- Runtime plugin loading or user-authored wizard discovery.
- MIDI-learn, arbitrary form schemas, or a general-purpose form language.
- Automatically configuring unknown controllers.
- Fuzzy inference across unrelated MIDI device names.
- Replacing the existing low-level controller mapping editor or manual add flow.
- Adding wizards for WRLD.Bldr, Launchpad, or Generic controllers in this change.

## Decisions

### D1 — Use a typed adapter over two polymorphic base contracts

Introduce a JUCE-free `ControllerConfigForm` base that implements `ui::Surface` and owns only in-memory form state. Introduce a `ControllerWizard` base with operations equivalent to:

- create a form from a new-device candidate or an existing controller record;
- identify the produced form/wizard type;
- validate the current form;
- generate a complete active controller record from the form and install context.

Concrete authors use a `TypedControllerWizard<Form>` adapter. The adapter returns `std::unique_ptr<ControllerConfigForm>` to callers, checks that generation receives its exact `Form` type, and delegates to typed `CreateForm`/`GenerateProfile` hooks. A mismatched form is an impossible internal state and should assert in debug builds while returning an explicit generation error in production.

This provides the intended covariant authoring experience while keeping ownership explicit. Raw-pointer covariance was rejected because it obscures lifetime. A single `std::variant` of every form was rejected because adding a wizard would require editing a central closed union.

### D2 — Forms are stateful portable surfaces, not renderer schemas

Each concrete form builds semantic portable nodes and handles portable actions directly. It stores message choices and arguments in ordinary C++ fields and exposes validation errors in its tree. It does not enumerate MIDI, open endpoints, edit the engine, or save files.

`ControllersPageSurface` owns the active wizard session: selected candidate or existing record identity, wizard instance, and form instance. Browser and JUCE renderers remain generic consumers of nodes/actions and contain no Twister, wizard, profile, or blacklist branches.

A generic declarative form schema was considered but rejected for this first wizard. The portable UI contract already supplies the necessary controls, and a schema would add a second UI language before there is evidence that multiple forms share enough structure.

### D3 — Registry entries own exact pair matching and wizard construction

Add a baked, ordered registry of descriptors. Each descriptor owns:

- a stable wizard id;
- a display name and resulting hardware/profile kind;
- predicates for compatible input and output device names/known aliases;
- a factory for the wizard;
- deterministic pairing rules for matching inputs and outputs.

Discovery filters the current `MidiDeviceList` through each descriptor, pairs the descriptor's matching inputs and outputs deterministically, and never assigns one endpoint to two candidates. When multiple indistinguishable devices exist, matching input and output lists are paired by their stable enumeration order; the chooser displays both endpoint names/identifiers so the user can disambiguate. This limitation is explicit because the current endpoint API exposes no cross-direction physical-device key.

The first descriptor recognizes the known MIDI Fighter Twister input/output names by case-insensitive exact comparison against descriptor-local aliases. It performs no prefix, substring, implicit-number-suffix, or other fuzzy matching. Multiple devices may have the same alias and remain distinguishable by identifier and enumeration order; a platform-specific numbered name must be added as an explicit alias before it matches.

### D4 — Availability is a pure classification over devices, records, and the registry

Provide a JUCE-free discovery function that returns deterministic `WizardCandidate` values and a derived `hasUnconfiguredWizardCandidate` flag. A candidate is available only when:

- both endpoints are currently present;
- one registry entry recognizes the pair;
- neither endpoint is claimed by any active or blacklisted controller record; and
- the pair has not already been emitted in the current discovery pass.

Claim comparison follows reconciliation identity semantics: exact identifier first, then stored name fallback. A half-configured existing record claims its configured endpoint, preventing the wizard from offering a pair that would contend with it.

The runtime refresh path snapshots this classification alongside the existing controller/device state even while the Controllers page is closed. Classification is recomputed from the cached device snapshot after every device-list change and every successful instrument commit; it never forces enumeration or reconciliation when the device list is unchanged. The sidebar warning is therefore a view of current model state, not state maintained by the renderer.

### D5 — Wizard submission uses the existing atomic edit path

For a new candidate, Submit rechecks that the candidate is still present and unclaimed, validates the form, asks the wizard to generate a complete profile, assigns both discovered endpoint references and the descriptor's stable wizard id, chooses the descriptor display name as the default record name, and commits one new active record through the existing instrument-edit callback. Name collisions use the smallest available numeric suffix beginning with ` 2` (for example `MIDI Fighter Twister`, `MIDI Fighter Twister 2`, `MIDI Fighter Twister 3`). Ignore uses the same naming rule.

For reconfiguration, the wizard is selected only by resolving the record's persisted `wizardId` in the current registry. Wizard ids are persisted as opaque non-empty strings; instrument validity and loading do not depend on the current registry. New wizard-created and ignored records carry the descriptor id; prior-schema and manual-add records have no wizard id and retain low-level editing without a wizard Reconfigure action. A record whose non-empty id is unknown to the current build remains loadable and removable but has no wizard lifecycle actions.

The form is compatible for seeding only when the existing profile is exactly the complete Twister generator shape: no analog config or extra mapping; exactly sixteen turn mappings, sixteen push mappings, and sixteen encoder-output mappings covering their default addresses/positions; one common slot across every turn, push, output, Bank Select, Next Bank, and Previous Bank message; and exactly six expressible system associations at channel 3 CCs 8–13 with no release/feedback shape the form cannot represent. An incompatible profile opens the defaults with an explicit warning that Submit replaces the whole profile. Submit is the confirmation and replaces the complete profile/disposition while preserving its name, endpoints, wizard id, and ordered position; extra or hand-edited mappings are deliberately dropped. Reconfiguring an offline existing record is allowed because its stored endpoint references are sufficient; a new candidate that disappears while its form is open is refused with a reconnect message.

An accepted Submit or Ignore commit triggers the existing processor rebuild, endpoint reconciliation, Controllers-page refresh, and an immediate runtime-configuration save request. Validation or generation failure leaves the instrument, persisted configuration, and open wizard session unchanged.

### D6 — Blacklist is a record disposition with no profile, not a profile kind

Extend the controller record with `Active` and `Blacklisted` dispositions and an optional stable `wizardId`. The id is an opaque persistence value, not a model-layer registry foreign key. Active records require a profile config. A newly ignored Blacklisted record has no profile. Changing a wizard-associated Active record to Blacklisted always retains its previous config as dormant wizard seed data; runtime construction and validation never treat that config as active. Both dispositions retain unique name, hardware kind, optional wizard id, input reference, output reference, and ordered-list position. Prior-schema and manual-add records load with no wizard id. This keeps `MidiProfileKind` about hardware/profile behavior and prevents lifecycle UI from guessing wizard association from kind alone.

Ignoring an available candidate creates a blacklisted record with the concrete endpoint identities and no profile. It appears in the normal ordered Controllers list with a `Blacklisted` badge. It can be renamed, configured (which runs its wizard and atomically changes it to Active), or removed from the blacklist. Removing it deletes the inert record, so if the pair remains attached it becomes an available candidate and restores the sidebar warning.

All Active records offer Rename and Delete. Records whose persisted wizard id resolves in the current registry additionally offer Reconfigure and Blacklist. Blacklisting is immediate, moves the row to the Blacklisted presentation, and always retains its profile as dormant reconfiguration seed data. Re-enabling always passes through Configure/Reconfigure rather than silently opening hardware with an unreviewed profile. Manual and legacy records are never stranded in a Blacklisted disposition because they are not offered Blacklist. A Blacklisted record with an unknown opaque wizard id remains visible and renameable/removable but cannot be configured until that descriptor is restored.

A `Blacklist` value in `MidiProfileKind` was rejected because every kind switch would gain a non-hardware case and the original kind needed for later reconfiguration would be lost. A separate top-level blacklist file was rejected because it would introduce another persistence lifecycle and atomicity boundary.

### D7 — Blacklisted records are inert at both processor and endpoint boundaries

Processor rebuild installs an explicit no-op/drop input processor and no output processors for a blacklisted slot, preserving controller-slot indexing without routing ordinary or realtime MIDI. Reconciliation checks disposition before every Active matching/status rule and never opens, claims, updates, resyncs, or marks Offline either stored endpoint for a blacklisted record. If a record is changed from Active to Blacklisted while endpoints are online, the plan closes both and returns their connection state to `Unconfigured`, which for a Blacklisted slot explicitly means deliberately inert even though its stored references remain populated.

These are independent defenses: not opening devices is the primary behavior, while the drop processor prevents accidental message flow if a stale host callback reaches the slot during the rebuild window. No sender sink is registered for the blacklisted output.

### D8 — The Controllers page exposes discovery and lifecycle actions without obscuring manual configuration

The Controllers page adds a top-level `Configuration Wizard` button and an `Available controllers` area. Available rows show the recognized controller and its paired endpoint labels with `Configure` and `Ignore` actions.

When no candidate exists, `Configuration Wizard` remains visible but disabled and the available area explains that no recognized unconfigured pair is present. When exactly one candidate exists, it opens its form immediately. When several exist, it opens a candidate chooser. The new-candidate form also contains `Ignore this controller` as a secondary action, so the fast path does not hide blacklist access. Existing-record reconfiguration never shows Ignore.

Active rows gain inline Rename and Delete, plus Reconfigure and Blacklist when the record carries a registry-supported wizard id. Blacklisted rows show no mapping disclosure or endpoint selectors and offer Rename and Remove from blacklist, plus Configure when their wizard id resolves. Delete and blacklist transitions commit through the same instrument-edit/reconcile path, so deleting an online profile closes its devices and removing an ignored record makes discovery reconsider it. Ignore appears only for new-candidate sessions, never while reconfiguring an existing record.

A recognized pair suppressed because one endpoint is already claimed does not appear as Available and contributes no warning. Its claiming stored controller row is the deliberate affordance for resolving the conflict; this first version adds no second diagnostic row for the same pair.

Only one wizard session can exist. Opening another target replaces no state because the open surface exposes no second launch action. A chooser refresh drops disappeared candidates and shows an empty status when none remain. Submit revalidates the candidate or existing record against the current instrument snapshot; removal, endpoint changes, disposition changes, or a conflicting out-of-band commit refuse submission while retaining the form.

### D9 — Twister maps six typed choices into existing profile primitives

`MfTwisterConfigForm` displays one controller-wide `Encoder Slot` integer control and exactly six message/argument pairs in two columns of three: buttons 0–2 in the first column (channel 3 CCs 8–10) and buttons 3–5 in the second (channel 3 CCs 11–13). Each row always contains a message dropdown and argument control. Every button must carry a message; there is no None/unassigned choice. The supported choices are Toggle/Hold Reset, Toggle/Hold Random, Toggle/Hold Random Mod, Toggle/Hold Gesture Select, Bank Select, Next Bank, Previous Bank, Start, Continue, Stop, Clock, and Scene Select. The argument is enabled for gesture selection (gesture index), Bank Select (bank index), and Scene Select (scene index); it is disabled for all other choices. Next/Previous Bank always use the controller-wide encoder slot.

The initial values are:

1. Hold Reset
2. Hold Random
3. Hold Random Mod
4. Next Bank
5. Start (transport)
6. Previous Bank

The form's encoder slot defaults to 0 and names the same parameter-slot index called `Slot` in the low-level mapping editor. It is deliberately not bounded by the currently running patch's slot count: any non-negative base-10 integer representable by `std::size_t` is accepted so a saved controller profile can target slots supplied by another patch; empty, negative, nonnumeric, and overflow text is invalid. Enabled per-button arguments use the same numeric domain. The hold choices generate `SetReset/SetRandom/SetRandomMod(true)` on press and the corresponding `false` release. Bank Select uses the button argument as `bankIx` and the controller-wide slot as `slotIx`; Next/Previous Bank also use the controller-wide slot and no bank-index argument. Start has no argument. This wizard-specific enablement table deliberately does not use the generic `UISystemMessageHasArg` result for Next/Previous Bank because their slot is supplied by the form-wide field. The generator reuses `MfTwisterDefaultProfileConfig`, passes the selected slot as `slotIx`, supplies exactly six side-button associations, and relies on that factory to enforce sixteen encoder positions' turn, push, and output defaults, zero-based channel 3 CCs 8–13, and input-only side-button behavior.

The dropdown derives the enumerated supported subset from the existing UI system-message catalog and reuses its message construction semantics rather than inventing wizard-only action enums. Invalid numeric text or any non-enumerated message id refuses submission with a field-level error.

### D10 — Persist disposition with backward-compatible instrument loading

Increment the MIDI instrument schema. New wizard-created active records write `disposition: "active"`, their stable `wizardId`, and their profile. Manual active records omit `wizardId`. Blacklisted records require a non-empty opaque `wizardId`, write `disposition: "blacklisted"`, and may omit the profile only when created by Ignore; Active-to-Blacklisted records write the retained dormant profile. The reader accepts the prior schema by treating every old controller as Active with no wizard id and requiring its existing profile exactly as before.

Runtime configuration schema need not gain a second blacklist section: it already delegates the nested instrument document and saves atomically. Malformed or empty wizard-id values, unknown disposition values, active records without profiles, blacklisted records without a wizard id or valid endpoint pair, and duplicate names reject the scratch load without mutating live state. An unknown but well-formed wizard id loads losslessly and merely disables registry-dependent lifecycle actions.

Rollback consists of removing blacklisted records or converting them to active profiles before writing an older schema. Code rollback can still read pre-change instrument documents; it is not expected to read documents already written with the newer nested schema.

### D11 — Test browser-first behavior, then backend parity and core contracts

Implementation starts with a Playwright acceptance test using test-controlled Web MIDI ports. It opens Controllers, activates Configuration Wizard, observes the six defaults, submits, and verifies a persisted active Twister record with both endpoint identities in exactly three clicks. Additional browser cases cover multiple candidates, Ignore, warning clearance/return, validation refusal, rename, delete, and reconfigure.

JUCE-free tests pin typed wizard/form pairing, candidate matching/claiming, deterministic ordering, Twister generation, JSON migration, blacklist reconciliation, no-op processor construction, and portable action state. JUCE simulation/backend tests then drive the same node ids/actions and verify the form and lifecycle controls render and dispatch without backend policy. Browser and JUCE assertions share portable-tree helper expectations wherever possible.

## Risks / Trade-offs

- [Separate input/output APIs cannot perfectly pair multiple identical physical units] → Pair deterministically, display endpoint identities in the chooser, and keep pairing policy descriptor-local so a stronger platform key can replace it later.
- [A device disappears after the form opens] → Revalidate new candidates on Submit and keep entered data while reporting that both endpoints must reconnect.
- [Form/generator concrete types are mismatched internally] → Centralize the checked cast in `TypedControllerWizard`, assert impossible mismatches, and return an explicit error without mutation.
- [Blacklist and delete can shift controller slot indices used by runtime routing] → Use the existing whole-instrument rebuild/resize path and add multi-controller regression tests around trailing and middle removal.
- [Schema migration makes new files unreadable by old binaries] → Continue reading the old schema, scope the change to the nested instrument schema, and document rollback before downgrade.
- [The Controllers surface accumulates workflow state] → Keep discovery pure, form state inside one wizard-session object, and controller/profile editing in the existing view model rather than embedding policy in tree construction.
- [Browser mocks pass while real Web MIDI names differ] → Put known aliases in registry data and add a small diagnostic that shows unmatched present endpoint names for future descriptor updates.
- [Blacklisting the active external-clock source removes its realtime terminal] → Let the existing smc-6 source timeout release the lock; blacklisting does not synthesize transport or clock messages.

## Migration Plan

1. Add failing JUCE-free tests for instrument disposition, schema migration, inert reconciliation, wizard matching, and Twister generation.
2. Introduce the record/disposition model and migrate engine, reconciliation, serialization, and existing view-model callers while preserving old-schema reads.
3. Add the typed wizard/form abstraction, registry, pure discovery/classification, and MF Twister wizard.
4. Extend portable runtime services, sidebar warning state, Controllers-page workflow state, and lifecycle actions.
5. Implement the Playwright three-click flow and remaining browser lifecycle cases.
6. Add JUCE simulation/backend parity tests against the same portable actions.
7. Run focused controller/browser/JUCE suites, then the full synth test matrix.

## Open Questions

No product decisions remain. Implementation will capture the exact MIDI Fighter Twister names observed through JUCE and Web MIDI as descriptor-local aliases and cover them with registry tests.
