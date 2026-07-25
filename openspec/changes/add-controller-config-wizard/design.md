## Context

The synth already has the pieces needed to host this workflow without adding backend-specific UI: `MidiDeviceList` provides portable endpoint identity, `MidiInstrumentConfig` persists ordered controller slots, `MidiConfigViewModel` and `ControllersPageSurface` own JUCE-free Controllers-page state, and both JUCE and Chrome render the same portable `ui::NodeTree`. Controller edits already commit through `Engine::EditInstrument`, rebuild MIDI processors, reconcile endpoints, and save through the runtime configuration document.

What is missing is the layer between raw device discovery and a complete profile. The current page asks the user to add a kind, choose endpoints independently, and edit mappings. It also has no way to remember that a recognized physical pair was intentionally ignored. The design must preserve the existing generic/manual editor while providing a three-click path for known hardware.

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

The first descriptor recognizes the known MIDI Fighter Twister input/output names. Compatibility aliases remain data in that descriptor rather than global fuzzy matching.

### D4 — Availability is a pure classification over devices, records, and the registry

Provide a JUCE-free discovery function that returns deterministic `WizardCandidate` values and a derived `hasUnconfiguredWizardCandidate` flag. A candidate is available only when:

- both endpoints are currently present;
- one registry entry recognizes the pair;
- neither endpoint is claimed by any active or blacklisted controller record; and
- the pair has not already been emitted in the current discovery pass.

Claim comparison follows reconciliation identity semantics: exact identifier first, then stored name fallback. A half-configured existing record claims its configured endpoint, preventing the wizard from offering a pair that would contend with it.

The runtime refresh path snapshots this classification alongside the existing controller/device state even while the Controllers page is closed. The sidebar warning is therefore a view of current model state, not state maintained by the renderer.

### D5 — Wizard submission uses the existing atomic edit path

For a new candidate, Submit rechecks that the candidate is still present and unclaimed, validates the form, asks the wizard to generate a complete profile, assigns both discovered endpoint references, chooses a unique default name, and commits one new active record through the existing instrument-edit callback.

For reconfiguration, the wizard is selected from the record's retained hardware kind/wizard id and the form is seeded from the existing profile when it is compatible. Submit replaces only the record's profile/disposition while preserving its name, endpoints, and ordered position. Reconfiguring an offline existing record is allowed because its stored endpoint references are sufficient; a new candidate that disappears while its form is open is refused with a reconnect message.

An accepted Submit or Ignore commit triggers the existing processor rebuild, endpoint reconciliation, Controllers-page refresh, and an immediate runtime-configuration save request. Validation or generation failure leaves the instrument, persisted configuration, and open wizard session unchanged.

### D6 — Blacklist is a record disposition with no profile, not a profile kind

Extend the controller record with `Active` and `Blacklisted` dispositions. Active records require a profile config. A newly ignored Blacklisted record has no profile, while a record converted from Active may retain its previous config only as dormant wizard seed data; runtime construction and validation never treat a Blacklisted config as active. Both dispositions retain unique name, hardware kind/wizard identity, input reference, output reference, and ordered-list position. This keeps `MidiProfileKind` about hardware/profile behavior and lets a blacklisted Twister still select the Twister wizard later.

Ignoring an available candidate creates a blacklisted record with the concrete endpoint identities and no profile. It appears in the normal ordered Controllers list with a `Blacklisted` badge. It can be renamed, configured (which runs its wizard and atomically changes it to Active), or removed from the blacklist. Removing it deletes the inert record, so if the pair remains attached it becomes an available candidate and restores the sidebar warning.

Active records offer Rename, Reconfigure, Blacklist, and Delete. Blacklisting an active record retains its profile as reconfiguration seed data only if the representation can do so without making it runtime-active; the serialized active profile is otherwise optional for blacklisted records. Re-enabling always passes through Configure/Reconfigure rather than silently opening hardware with an unreviewed profile.

A `Blacklist` value in `MidiProfileKind` was rejected because every kind switch would gain a non-hardware case and the original kind needed for later reconfiguration would be lost. A separate top-level blacklist file was rejected because it would introduce another persistence lifecycle and atomicity boundary.

### D7 — Blacklisted records are inert at both processor and endpoint boundaries

Processor rebuild installs an explicit no-op/drop input processor and no output processors for a blacklisted slot, preserving controller-slot indexing without routing ordinary or realtime MIDI. Reconciliation never opens either stored endpoint for a blacklisted record. If a record is changed from Active to Blacklisted while endpoints are online, the plan closes both and returns their connection state to an inert/unconfigured state.

These are independent defenses: not opening devices is the primary behavior, while the drop processor prevents accidental message flow if a stale host callback reaches the slot during the rebuild window. No sender sink is registered for the blacklisted output.

### D8 — The Controllers page exposes discovery and lifecycle actions without obscuring manual configuration

The Controllers page adds a top-level `Configuration Wizard` button and an `Available controllers` area. Available rows show the recognized controller and its paired endpoint labels with `Configure` and `Ignore` actions.

When exactly one candidate exists, `Configuration Wizard` opens its form immediately. When several exist, it opens a candidate chooser. The form also contains `Ignore this controller` as a secondary action, so the fast path does not hide blacklist access.

Active rows gain inline Rename, Reconfigure (when a registry wizard supports the record), Blacklist, and Delete actions. Blacklisted rows show no mapping disclosure or endpoint selectors and instead offer Rename, Configure, and Remove from blacklist. Delete and blacklist transitions commit through the same instrument-edit/reconcile path, so deleting an online profile closes its devices and removing an ignored record makes discovery reconsider it.

### D9 — Twister maps six typed choices into existing profile primitives

`MfTwisterConfigForm` displays six message/argument pairs in two columns of three: buttons 0–2 in the first column and 3–5 in the second. Each row always contains a message dropdown and argument control; the argument control is disabled for message kinds without an argument.

The initial values are:

1. Hold Reset
2. Hold Random
3. Hold Random Mod
4. Next Bank, slot 0
5. Start Transport
6. Previous Bank, slot 0

The hold choices generate `SetReset/SetRandom/SetRandomMod(true)` on press and the corresponding `false` release. Relative bank messages use their argument as `slotIx`; Start has no argument. The generator reuses `MfTwisterDefaultProfileConfig`, supplies exactly six side-button associations, and relies on that factory to enforce zero-based channel 3 CCs 8–13 and input-only side-button behavior.

The dropdown uses the existing UI system-message catalog/semantics rather than inventing wizard-only action enums. Invalid argument values or unsupported message kinds refuse submission with a field-level error.

### D10 — Persist disposition with backward-compatible instrument loading

Increment the MIDI instrument schema. New active records write `disposition: "active"` plus their profile. Blacklisted records write `disposition: "blacklisted"` and may omit the profile. The reader accepts the prior schema by treating every old controller as Active and requiring its existing profile exactly as before.

Runtime configuration schema need not gain a second blacklist section: it already delegates the nested instrument document and saves atomically. Unknown disposition values, active records without profiles, blacklisted records with invalid endpoint identity, and duplicate names reject the scratch load without mutating live state.

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
