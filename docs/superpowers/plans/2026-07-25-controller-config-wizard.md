# Controller Config Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize an attached MIDI Fighter Twister input/output pair and provide a portable three-click Controllers → Configuration Wizard → Submit flow that installs and persists a complete profile, with warning, blacklist, rename, delete, and reconfigure behavior in both browser and JUCE hosts.

**Architecture:** Extend the ordered MIDI instrument records with Active/Blacklisted disposition, opaque wizard identity, and dormant profile state; branch reconciliation and processor construction before all Active behavior so blacklisted records are inert. Add a JUCE-free wizard module containing typed form/generator contracts, deterministic baked discovery, and the MF Twister form. Keep discovery and wizard-session policy in portable runtime surfaces; Chrome and JUCE remain generic renderers of the same nodes/actions.

**Tech Stack:** C++20, existing `synth::ui::Surface` portable UI, existing JSON arena helpers, TypeScript/Web MIDI, Playwright 1.60, JUCE, GNU Make.

**OpenSpec change:** `openspec/changes/add-controller-config-wizard`

**Assignments:** `docs/superpowers/plans/2026-07-25-controller-config-wizard.assignments.yaml`

## Global Constraints

- Use the OpenSpec proposal, design, and all three delta specs as the normative source. Do not infer wizard association from `MidiProfileKind`.
- `wizardId` is an optional opaque non-empty persisted string. Instrument validity/loading never consults the registry. Registry resolution gates only Reconfigure, Blacklist, and Configure UI actions.
- An Active record requires its existing kind-valid profile. Ignore creates a Blacklisted record without a dormant profile. Active→Blacklisted always retains the complete old profile as dormant seed data.
- Blacklisted disposition is checked before every Active reconciliation rule. A Blacklisted endpoint remains deliberately `Unconfigured` even with populated stored references; it never claims, opens, updates, resyncs, becomes Offline, or registers an output sink.
- A Blacklisted processor slot contains exactly one drop input processor and no realtime terminal, thru processors, output processors, or sender sink.
- MF Twister matching is case-insensitive exact comparison against descriptor-local aliases. Do not use prefix, substring, fuzzy, or implicit numeric-suffix matching.
- The Twister form has one controller-wide `Encoder Slot` and exactly six buttons total, in two columns of three. Left buttons are channel 3 CC 8–10; right buttons are channel 3 CC 11–13.
- All sixteen encoder positions’ turn, push, and output mappings, plus Bank Select and Next/Previous Bank messages, use the one Encoder Slot. Bank Select alone keeps a per-button `bankIx`.
- Defaults are Encoder Slot `0`; Hold Reset; Hold Random; Hold Random Mod; Next Bank; Start; Previous Bank.
- The exact dropdown choices are Toggle/Hold Reset, Toggle/Hold Random, Toggle/Hold Random Mod, Toggle/Hold Gesture Select, Bank Select, Next Bank, Previous Bank, Start, Continue, Stop, Clock, and Scene Select. There is no None/unassigned choice.
- Per-button arguments are enabled only for Toggle/Hold Gesture Select, Bank Select, and Scene Select. Next/Previous Bank arguments are disabled because the form-wide slot supplies `slotIx`; do not use generic `UISystemMessageHasArg` for wizard enablement.
- Encoder Slot and enabled arguments accept every non-negative base-10 integer representable by `std::size_t`; empty, negative, non-base-10, and overflow text is invalid.
- Reconfigure seeds only an exact generated Twister shape: no analog/extra mappings; default 16 turn + 16 push + 16 output mappings; exactly six expressible side associations; one common slot across every encoder and bank message. Any other shape opens defaults with a destructive replacement warning; Submit is confirmation.
- The unique-candidate path is exactly three activations: Controllers, Configuration Wizard, Submit. No chooser or additional confirmation appears.
- Candidate classification is recomputed from cached devices after device-list changes and successful instrument commits. It never forces enumeration or reconciliation for an unchanged list.
- Successful lifecycle actions perform one instrument commit and request save afterward. Refused actions commit and save nothing and retain open form state.
- Core model, discovery, form, generation, and portable page policy remain JUCE-free. Browser TypeScript and JUCE renderer code contain no Twister, wizard, blacklist, generation, matching, or validation policy.
- Use TDD in every task: add the named failing test, run the focused red command, implement the smallest coherent change, rerun focused regressions, self-review, then commit.
- Keep OpenSpec checkboxes unchecked until every plan task mapped to that checkbox has passed its spec and quality reviews.

---

### Task 1: Browser-first acceptance contract

**Assigned model:** `gpt-5.5`, effort `high`
**OpenSpec tasks:** 1.1–1.3

**Files:**

- Modify: `projects/synth/browser/tests/fake-app.e2e.spec.ts`
- Create: `projects/synth/browser/tests/helpers/fake-midi.ts`

**Produces:** Black-box acceptance tests and deterministic Web MIDI helpers consumed by Task 15.

- [ ] Add `installTwisterPair(page, ordinal)` and `removeTwisterPair(page, ordinal)` helpers that expose exact device name `Midi Fighter Twister`, stable ids `twister-in-${ordinal}` / `twister-out-${ordinal}`, duplicate same-name pairs, and the existing Web MIDI state-change route.
- [ ] Add the unique-pair acceptance test with exactly these click statements:

```ts
await page.locator('[data-synth-node-id="runtime.sidebar.controllers"]').click();
await page.locator('[data-synth-node-id="runtime.controllers.wizard.open"]').click();
await page.locator('[data-synth-node-id="runtime.controllers.wizard.submit"]').click();
```

  Before Submit assert one `runtime.controllers.wizard.encoder_slot` with text `0`, exactly six message controls, exactly six argument controls, 3+3 column geometry, and the six defaults. After Submit assert Active state, opaque wizard id, both endpoints, all encoder mappings on slot 0, exactly six side associations, cleared warning, and persistence after runtime reload.
- [ ] Add cases for disabled zero-candidate action; two-candidate chooser; Ignore from the available row and new-candidate form; warning return after Remove from blacklist; disconnected/stale/invalid Submit preserving values; deterministic `MIDI Fighter Twister 2` naming; rename; delete; Active→Blacklisted dormant retention; blacklisted Configure; exact-shape and incompatible destructive Reconfigure; and absence of Ignore during existing-record reconfiguration.
- [ ] Run the red contract:

```bash
cd projects/synth/browser
npx playwright test tests/fake-app.e2e.spec.ts --grep "controller wizard"
```

  Expected: fixture compilation/startup succeeds; the first wizard selector assertion fails because production nodes do not exist yet.
- [ ] Commit:

```bash
git add projects/synth/browser/tests/fake-app.e2e.spec.ts projects/synth/browser/tests/helpers/fake-midi.ts
git commit -m "test(synth-browser): pin controller wizard acceptance"
```

### Task 2: Instrument disposition and wizard identity model

**Assigned model:** `gpt-5.5`, effort `high`
**OpenSpec tasks:** 2.1–2.2

**Files:**

- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/tests/instrument_tests.cpp`

**Produces:**

```cpp
enum class MidiControllerDisposition { Active, Blacklisted };

struct MidiControllerSlot {
    std::string name;
    MidiProfileKind kind = MidiProfileKind::Generic;
    MidiControllerDisposition disposition = MidiControllerDisposition::Active;
    std::optional<std::string> wizardId;
    MidiControllerProfileConfig config;  // runtime-active only for Active
    std::optional<MidiControllerProfileConfig> dormantConfig;
    MidiEndpointRef input;
    MidiEndpointRef output;
};

bool IsActive(const MidiControllerSlot&);
bool SlotValidForKind(const MidiControllerSlot&, std::string* reason = nullptr);
```

- [ ] Add model tests for valid Active/manual/wizard records; opaque unknown wizard ids; ignored Blacklisted records without dormant config; Blacklisted records requiring non-empty wizard id and both endpoint refs; Active→Blacklisted dormant shape; kind validation of dormant profiles; unique names across dispositions; and ordered middle/trailing replace/remove behavior.
- [ ] Run `make -C projects/synth build/instrument_tests && projects/synth/build/instrument_tests`; expect the new tests to fail on missing disposition/wizard/dormant fields.
- [ ] Implement the enum, helpers, and validation. Active validates `config` with all existing per-kind rules. Blacklisted ignores reset `config`, requires both refs plus a non-empty opaque id, and validates `dormantConfig` when present without consulting the registry.
- [ ] Adapt existing model callers to construct Active records explicitly while preserving manual Add and default-profile behavior.
- [ ] Rerun `instrument_tests`, `viewmodel_tests`, and `controllers_page_ui_tests`; expect all pass.
- [ ] Commit `feat(synth): model active and blacklisted controllers`.

### Task 3: Instrument JSON schema and backward-compatible loading

**Assigned model:** `gpt-5.5`, effort `high`
**OpenSpec tasks:** 2.3–2.4

**Files:**

- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/tests/instrument_tests.cpp`

**Consumes:** Task 2 model fields.
**Produces:** New nested instrument schema with disposition/opaque wizard id and previous-schema migration.

- [ ] Add JSON tests for Active/manual omission of `wizardId`; wizard Active; ignored Blacklisted without profile; Blacklisted with dormant profile; unknown well-formed id preservation; mixed wrldbldr/twister/two-launchpad ordered round trip; and preceding-schema entries loading Active with no wizard id.
- [ ] Add atomic rejection tests for unknown kind/disposition, empty or non-string wizard id, duplicate names, Active without profile, incomplete Blacklisted refs/id, and kind-invalid active/dormant profiles. Preserve the existing legacy single-`midiProfile` rejection test.
- [ ] Run the focused test and observe schema/version/reader failures:

```bash
make -C projects/synth build/instrument_tests
projects/synth/build/instrument_tests
```

- [ ] Increment the instrument schema; write `disposition`, optional `wizardId`, Active `profile`, and Blacklisted dormant `profile`; parse entirely into scratch state before assignment. Do not call `ControllerWizardRegistry()` from model or JSON code.
- [ ] Rerun `instrument_tests`; expect all pass and unknown opaque ids to round-trip unchanged.
- [ ] Commit `feat(synth): persist controller disposition and wizard id`.

### Task 4: Disposition-aware reconciliation

**Assigned model:** `gpt-5.6-terra`, effort `high`
**OpenSpec tasks:** 2.5–2.6

**Files:**

- Modify: `projects/synth/include/synth/MidiReconcile.hpp`
- Modify: `projects/synth/src/MidiReconcile.cpp`
- Modify: `projects/synth/runtime/MidiConnectionManager.hpp`
- Modify: `projects/synth/tests/reconcile_tests.cpp`
- Modify: `projects/synth/tests/reconcile_executor_tests.cpp`

**Produces:**

```cpp
enum class ReconcileAction::Type {
    OpenInput, OpenOutput, CloseInput, CloseOutput,
    MarkInputOffline, MarkOutputOffline,
    MarkInputUnconfigured, MarkOutputUnconfigured,
    UpdateInputRef, UpdateOutputRef, Resync
};
```

- [ ] Add planner tests proving Blacklisted is checked first; present and absent populated refs remain Unconfigured; no claim/open/update/resync/Offline action occurs; an Active slot can claim a device named by an earlier Blacklisted slot; Active→Blacklisted closes Online endpoints then marks Unconfigured; and the next plan is empty.
- [ ] Add executor tests proving the two new generic actions update connection state without clearing stored refs and preserve action order.
- [ ] Run `reconcile_tests` and `reconcile_executor_tests`; expect missing action/branch failures.
- [ ] Branch on disposition before the existing `PlanEndpointPass` matching/status rules. Emit Close+MarkUnconfigured for Online Blacklisted endpoints, MarkUnconfigured for Offline endpoints, and nothing for already-Unconfigured endpoints.
- [ ] Bind the new actions in `MidiConnectionManager` without adding controller-specific policy. Run both focused binaries and existing reconnect/resync regressions; expect pass.
- [ ] Commit `feat(synth): reconcile blacklisted endpoints as inert`.

### Task 5: Blacklisted processor construction and rebuild behavior

**Assigned model:** `gpt-5.6-sol`, effort `high`
**OpenSpec tasks:** 2.7–2.8

**Files:**

- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify: `projects/synth/tests/engine_tests.cpp`
- Modify: `projects/synth/tests/browser_midi_bridge_tests.cpp`

**Produces:**

```cpp
class DropMidiInProcessor final : public MidiInProcessor {
public:
    using MidiInProcessor::MidiInProcessor;
    void Process(const BasicMidi&) override {}
};

MidiControllerProfileResult CreateBlacklistedMidiControllerProfile();
```

- [ ] Add tests that a rebuilt Blacklisted slot has a `DropMidiInProcessor`, empty `inputThru`, empty `outputs`, and no sender sink; inject CC, SysEx, F8 Clock, FA Start, FB Continue, and FC Stop and assert no bus message.
- [ ] Add Active→Blacklisted teardown, Blacklisted→Active rebuild, delete/middle slot resize, and stale browser callback drop tests.
- [ ] Run `engine_tests` and `browser_midi_bridge_tests`; expect failures because rebuild still creates Active processors/realtime terminal.
- [ ] Implement the drop profile and make `Engine::RebuildMidiProcessors()` choose it solely by disposition before reading `config` or registering sinks. Preserve one result per ordered controller slot.
- [ ] Run both focused binaries plus `reconcile_executor_tests`; expect all pass with Active realtime routing unchanged.
- [ ] Commit `feat(synth): drop all MIDI for blacklisted controllers`.

### Task 6: Typed controller wizard contracts

**Assigned model:** `gpt-5.6-terra`, effort `high`
**OpenSpec tasks:** 3.1–3.2

**Files:**

- Create: `projects/synth/include/synth/ControllerWizard.hpp`
- Create: `projects/synth/src/ControllerWizard.cpp`
- Create: `projects/synth/tests/controller_wizard_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/browser/src/build-browser-apps.mjs`
- Modify: `projects/synth/runtime/juce_build.mk`

**Produces:**

```cpp
class ControllerConfigForm : public ui::Surface {
public:
    ~ControllerConfigForm() override = default;
    virtual std::string_view WizardId() const = 0;
    virtual bool Validate(std::string& error) const = 0;
};

struct WizardGenerationContext {
    std::string name;
    MidiEndpointRef input;
    MidiEndpointRef output;
};

struct WizardGenerationResult {
    std::optional<MidiControllerSlot> controller;
    std::string error;
    explicit operator bool() const { return controller.has_value(); }
};

class ControllerWizard {
public:
    virtual ~ControllerWizard() = default;
    virtual std::string_view Id() const = 0;
    virtual std::unique_ptr<ControllerConfigForm>
        ConfigForm(const std::optional<MidiControllerSlot>& seed) const = 0;
    virtual WizardGenerationResult GenerateProfile(
        const ControllerConfigForm&, const WizardGenerationContext&) const = 0;
};

template<class Form> class TypedControllerWizard : public ControllerWizard;
```

- [ ] Add two dummy forms/wizards testing unique ownership, form state mutation only through `DispatchAction`, correct typed generation, validation refusal, and wrong-form type mismatch returning an error without mutation in a `-DNDEBUG` test build.
- [ ] Run `make -C projects/synth build/controller_wizard_tests`; expect the target/header to be missing.
- [ ] Implement the bases and checked `TypedControllerWizard<Form>` adapter with one centralized checked cast, debug assertion, and production error result. Forms may not enumerate devices, edit the engine, save, or include JUCE/DOM headers.
- [ ] Add source/test targets to native, browser, and JUCE build lists. Run `controller_wizard_tests` and `make -C projects/synth check-ui-boundary`; expect pass.
- [ ] Commit `feat(synth): add typed controller wizard contracts`.

### Task 7: Baked registry and pure candidate discovery

**Assigned model:** `gpt-5.5`, effort `high`
**OpenSpec tasks:** 3.3–3.4

**Files:**

- Modify: `projects/synth/include/synth/ControllerWizard.hpp`
- Modify: `projects/synth/src/ControllerWizard.cpp`
- Modify: `projects/synth/tests/controller_wizard_tests.cpp`

**Produces:**

```cpp
struct WizardCandidate {
    std::string wizardId;
    std::string displayName;
    MidiProfileKind kind;
    MidiDeviceInfoRef input;
    MidiDeviceInfoRef output;
};

struct WizardDiscovery {
    std::vector<WizardCandidate> available;
    std::vector<MidiDeviceInfoRef> unmatchedInputs;
    std::vector<MidiDeviceInfoRef> unmatchedOutputs;
};

struct ControllerWizardDescriptor {
    std::string id;
    std::string displayName;
    MidiProfileKind kind;
    std::vector<std::string> inputAliases;
    std::vector<std::string> outputAliases;
    std::function<std::unique_ptr<ControllerWizard>()> factory;
};

const std::vector<ControllerWizardDescriptor>& ControllerWizardRegistry();
WizardDiscovery DiscoverControllerWizards(
    const MidiDeviceList&, const MidiInstrumentConfig&,
    const std::vector<ControllerWizardDescriptor>&);
std::unique_ptr<ControllerWizard> MakeControllerWizard(std::string_view id);
```

- [ ] Add pure tests for case-insensitive exact `Midi Fighter Twister`, explicit rejection of prefix/suffix/implicit-number variants, unmatched diagnostics, half pairs, registry order, two duplicate pairs by enumeration order, endpoint exclusivity, exact-id then name-fallback claims, half-configured claims, Active/Blacklisted claims, and stable repeated results.
- [ ] Run `controller_wizard_tests`; expect discovery symbols missing.
- [ ] Implement descriptor-local aliases and deterministic pairing. Claims are computed over every stored record regardless of disposition or wizard-id resolution. Do not mutate devices or instrument.
- [ ] Run `controller_wizard_tests`; expect all pass.
- [ ] Commit `feat(synth): discover baked controller wizard candidates`.

### Task 8: MF Twister form surface

**Assigned model:** `gpt-5.6-terra`, effort `high`
**OpenSpec tasks:** 3.5–3.6

**Files:**

- Modify: `projects/synth/include/synth/ControllerWizard.hpp`
- Modify: `projects/synth/src/ControllerWizard.cpp`
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/tests/controller_wizard_tests.cpp`

**Produces:**

```cpp
struct MfTwisterButtonConfig {
    UISystemMessage message;
    std::string argumentText = "0";
};

class MfTwisterConfigForm final : public ControllerConfigForm {
public:
    static constexpr std::size_t kButtonCount = 6;
    std::string encoderSlotText = "0";
    std::array<MfTwisterButtonConfig, kButtonCount> buttons;
    ui::NodeTree BuildTree() override;
    void DispatchAction(const ui::Action&) override;
    bool Validate(std::string& error) const override;
};
```

- [ ] Expose reusable catalog lookup/association construction helpers from `MidiConfigViewModel` while leaving sru-30 low-level Next/Previous Arg behavior unchanged.
- [ ] Add form tests for one slot field, exactly six dropdown/argument pairs, left CC 8–10/right CC 11–13 bounds, exact closed option set, exact defaults, stable ids, edits through portable actions, and wizard-owned argument enablement.
- [ ] Add numeric tests accepting `0` and `std::numeric_limits<std::size_t>::max()` and rejecting empty, `-1`, `1x`, whitespace-only, and overflowing decimal text; disabled stored argument text must not affect validation/generation.
- [ ] Run `controller_wizard_tests`; expect missing form failures.
- [ ] Implement `BuildTree`, action routing, the explicit message→argument-enabled table, parsing, and inline field errors using ordinary portable ComboBox/TextField nodes only. Run focused tests and `check-ui-boundary`; expect pass.
- [ ] Commit `feat(synth): add six-button twister wizard form`.

### Task 9: MF Twister profile generation

**Assigned model:** `gpt-5.6-terra`, effort `high`
**OpenSpec tasks:** 3.7–3.8

**Files:**

- Modify: `projects/synth/include/synth/ControllerWizard.hpp`
- Modify: `projects/synth/src/ControllerWizard.cpp`
- Modify: `projects/synth/tests/controller_wizard_tests.cpp`
- Modify: `projects/synth/tests/instrument_tests.cpp`

**Produces:** `MfTwisterControllerWizard`, registry factory registration, and complete Active `MidiControllerSlot` generation.

- [ ] Add generation tests for all sixteen turn/push/output positions on selected slot 4; exactly six side associations at channel 3 CC 8–13; no output feedback; Hold releases false; Bank Select `{slotIx=4, bankIx=7}`; Next/Previous `{slotIx=4}` ignoring disabled text; discovered endpoints; stable wizard id; Active disposition; and invalid form atomicity.
- [ ] Run `controller_wizard_tests`; expect missing concrete wizard/generator failures.
- [ ] Implement association construction through shared UI message semantics, but override Next/Previous slot from `encoderSlotText` and Bank Select slot+bank explicitly. Pass exactly six associations and the slot into `MfTwisterDefaultProfileConfig`; do not duplicate encoder/address factory code.
- [ ] Register the concrete factory and verify wrong-form generation remains atomic. Run `controller_wizard_tests` and `instrument_tests`; expect pass.
- [ ] Commit `feat(synth): generate complete twister wizard profiles`.

### Task 10: Cached classification and sidebar warning

**Assigned model:** `gpt-5.6-terra`, effort `high`
**OpenSpec tasks:** 4.1–4.3

**Files:**

- Modify: `projects/synth/include/synth/RuntimeMainComponent.hpp`
- Modify: `projects/synth/include/synth/RuntimePages.hpp`
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/runtime/JuceRuntimeMainServices.hpp`
- Modify: `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`
- Modify: `projects/synth/tests/runtime_main_component_tests.cpp`
- Modify: `projects/synth/tests/controllers_page_ui_tests.cpp`

**Produces:** Runtime-owned cached `MidiDeviceList`, `WizardDiscovery`, sidebar warning, and Controllers-page discovery snapshot.

- [ ] Add tests showing a recognized unclaimed pair warns while Application/Audio/File is open; claimed/blacklisted pairs do not; cached classification itself never triggers enumeration or reconciliation; and configure/ignore/delete/remove successful commits reclassify immediately from cached devices.
- [ ] Run `runtime_main_component_tests` and `controllers_page_ui_tests`; expect missing warning/discovery failures.
- [ ] Extend runtime services with explicit device/instrument snapshots. Update cached devices only on the existing device-list change signal; recompute pure classification after that update and after successful instrument commits.
- [ ] Add `runtime.sidebar.controllers.warning` state to the portable sidebar and `SetDiscovery(WizardDiscovery)` to `ControllersPageSurface`. Render Available rows with Configure/Ignore and unmatched-name diagnostics without renderer policy.
- [ ] Run focused tests plus `make -C projects/synth check-ui-boundary`; expect pass.
- [ ] Commit `feat(synth-runtime): classify controller wizard availability`.

### Task 11: Portable wizard-session and chooser routing

**Assigned model:** `gpt-5.6-terra`, effort `high`
**OpenSpec tasks:** 4.4, routing/session portion

**Files:**

- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/tests/controllers_page_ui_tests.cpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`

**Produces:**

```cpp
struct WizardSession {
    std::variant<WizardCandidate, std::size_t> target;
    std::unique_ptr<ControllerWizard> wizard;
    std::unique_ptr<ControllerConfigForm> form;
    std::string warning;
    std::string status;
};
```

- [ ] Add portable-tree tests for visible disabled zero-candidate button/explanation; unique direct form; multi-candidate chooser labels; one open session; disappeared chooser entries; one Encoder Slot + exactly six rows; two columns; dispatch into form; Back/Cancel preserving instrument; and Ignore absent for existing-record sessions.
- [ ] Run `controllers_page_ui_tests` and `portable_ui_tests`; expect missing nodes/actions.
- [ ] Add stable ids under `runtime.controllers.wizard.*`; route `BuildTree()` among list, chooser, and form; unique candidates call `OpenCandidate(0)` directly. The form remains the sole owner of entered state.
- [ ] Refresh chooser candidates without replacing an open form. Run focused tests; expect pass.
- [ ] Commit `feat(synth-ui): add portable controller wizard session`.

### Task 12: Submit/Ignore commit and candidate revalidation

**Assigned model:** `gpt-5.6-sol`, effort `high`
**OpenSpec tasks:** 4.4, commit portion

**Files:**

- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/tests/controllers_page_ui_tests.cpp`
- Modify: `projects/synth/tests/runtime_main_component_tests.cpp`

**Consumes:** Task 11 `WizardSession`; Task 10 cached discovery.
**Produces:** Atomic new-candidate Submit/Ignore.

- [ ] Add tests for one commit then save; deterministic display name and smallest suffix; endpoint presence/claim revalidation; candidate disappearance/contention refusal; validation/type mismatch refusal; retained form state/status; Ignore creating Blacklisted with opaque id/no dormant profile; and no commit/save on refusal.
- [ ] Run focused UI/runtime tests; expect missing submit/ignore behavior.
- [ ] Extend `ControllersPageCallbacks` with `bool commitInstrument(MidiInstrumentConfig)` and `bool saveRuntimeConfiguration()`. Re-snapshot devices/instrument on Submit/Ignore, rediscover, and compare exact candidate identities before generating or ignoring.
- [ ] Commit one complete instrument edit; only after success request save and refresh cached classification. A save error is reported after the committed state and is not rolled back.
- [ ] Run `controllers_page_ui_tests` and `runtime_main_component_tests`; expect pass.
- [ ] Commit `feat(synth-ui): commit controller wizard submit and ignore`.

### Task 13: Rename, delete, and blacklist lifecycle actions

**Assigned model:** `gpt-5.6-terra`, effort `high`
**OpenSpec tasks:** 4.5–4.6, non-reconfigure portion

**Files:**

- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/tests/viewmodel_tests.cpp`
- Modify: `projects/synth/tests/controllers_page_ui_tests.cpp`

**Produces:**

```cpp
bool RenameController(std::size_t, std::string, MidiInstrumentConfig& out,
                      std::string* reason);
bool DeleteController(std::size_t, MidiInstrumentConfig& out,
                      std::string* reason);
bool BlacklistController(std::size_t, MidiInstrumentConfig& out,
                         std::string* reason);
bool RemoveFromBlacklist(std::size_t, MidiInstrumentConfig& out,
                         std::string* reason);
```

- [ ] Add tests for unique rename across dispositions; Delete for every Active record; Blacklist only when an Active record’s opaque id resolves; mandatory `config`→`dormantConfig`; Blacklisted Rename/Remove; unknown-id recovery actions; hidden Blacklisted mapping/endpoint controls; and endpoint teardown through normal commit/reconcile.
- [ ] Run `viewmodel_tests` and `controllers_page_ui_tests`; expect missing actions.
- [ ] Implement mutation on scratch `MidiInstrumentConfig`, return it explicitly
      through each method's `out` parameter following the existing view-model
      mutation contract, then use the Task 12 commit/save callback. Never stage
      a pending mutation inside the view model and never open/close handlers
      directly.
- [ ] Render Active generic controls unchanged; add Reconfigure/Blacklist only for resolved ids. Render Blacklisted labels/badge, Rename/Remove, and Configure only for resolved ids.
- [ ] Run focused tests plus `reconcile_tests`; expect pass.
- [ ] Commit `feat(synth-ui): add controller profile lifecycle actions`.

### Task 14: Reconfigure compatibility and configuration persistence

**Assigned model:** `gpt-5.6-terra`, effort `high`
**OpenSpec tasks:** 4.5–4.7, reconfigure/save portion

**Files:**

- Modify: `projects/synth/include/synth/ControllerWizard.hpp`
- Modify: `projects/synth/src/ControllerWizard.cpp`
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/runtime/JuceRuntimeMainServices.hpp`
- Modify: `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`
- Modify: `projects/synth/tests/controller_wizard_tests.cpp`
- Modify: `projects/synth/tests/controllers_page_ui_tests.cpp`
- Modify: `projects/synth/tests/browser_runtime_contract_tests.cpp`

**Produces:** Exact-shape Twister seed extraction and complete existing-record replacement.

- [ ] Add compatibility tests requiring no analog/extra mapping, exactly 16 default turns + 16 pushes + 16 outputs, six expressible CC 8–13 associations, and one slot across encoders/Bank Select/Next/Previous. Test each mismatch independently.
- [ ] Add UI tests: compatible slot 4 seeds form; incompatible/extra mapping opens defaults plus destructive warning; Submit preserves name/endpoints/wizard id/order while replacing the whole profile and setting Active; offline stored endpoints are allowed; stale record index/name/endpoints/disposition refuse; existing sessions never show Ignore.
- [ ] Add host tests proving Submit/Ignore/rename/delete/blacklist/remove/reconfigure each save after one successful commit and refused actions never overwrite persisted configuration.
- [ ] Run `controller_wizard_tests`, `controllers_page_ui_tests`, and `browser_runtime_contract_tests`; expect missing compatibility/save failures.
- [ ] Implement one `ExtractMfTwisterWizardSeed` exact-shape function and use it from `ConfigForm(seed)`. Wire production save callbacks to existing runtime configuration APIs and return success/failure.
- [ ] Run focused tests plus `engine_tests`; expect pass.
- [ ] Commit `feat(synth-runtime): reconfigure and persist wizard profiles`.

### Task 15: Chrome backend and Playwright completion

**Assigned model:** `gpt-5.5`, effort `high`
**OpenSpec tasks:** 5.1–5.3

**Files:**

- Modify: `projects/synth/browser/src/ui.ts`
- Modify: `projects/synth/browser/tests/ui-backend.spec.ts`
- Modify: `projects/synth/browser/tests/fake-app.e2e.spec.ts`
- Modify: `projects/synth/browser/tests/midi-flow.spec.ts`
- Modify: `projects/synth/tests/browser_command_buffer_tests.cpp`
- Modify: `projects/synth/tests/browser_midi_bridge_tests.cpp`

- [ ] Add generic enabled-state tests for native Button/ComboBox/TextField and generic semantic elements: disabled DOM state/`aria-disabled`, selected option preservation, and no dispatched action.
- [ ] Run browser command-buffer/UI tests; expect only genuine generic enabled-state gaps to fail.
- [ ] Implement generic action suppression where required. Do not branch on wizard ids, node-id prefixes, Twister labels, or blacklist state.
- [ ] Make every Task 1 case pass through production portable actions and Web MIDI state changes; verify persistence by destroying/recreating the runtime, not by test-only C++ state mutation.
- [ ] Run:

```bash
make -C projects/synth browser-command-buffer-test browser-midi-bridge-test browser-fixture-app
cd projects/synth/browser
npm run build
npm run check:generic-runtime
node --test dist/tests/*.test.mjs
npx playwright test tests/ui-backend.spec.ts tests/fake-app.e2e.spec.ts tests/midi-flow.spec.ts
npm test
```

  Expected: all pass with no skipped controller-wizard cases.
- [ ] Commit `test(synth-browser): complete controller wizard flow`.

### Task 16: JUCE portable backend parity

**Assigned model:** `gpt-5.5`, effort `high`
**OpenSpec tasks:** 6.1–6.4

**Files:**

- Modify: `projects/synth/juce/PortableJuceBackend.hpp`
- Modify: `projects/synth/juce/PortableJuceBackendTests.cpp`
- Modify: `projects/synth/juce/ControllersPageSimulationTests.cpp`
- Modify: `projects/synth/juce/RuntimePagesJuceTests.cpp`
- Modify: `projects/synth/juce/ControllersPageHarness.hpp`

- [ ] Add generic JUCE tests for disabled Button/ComboBox/TextField, action suppression, selected options, and stable values.
- [ ] Add simulation fixtures with zero/one/two recognized Twister pairs and drive the same stable ids as Playwright: warning, disabled state, unique/chooser, Encoder Slot, exactly six rows, Submit/Ignore, rename/delete/blacklist/remove, compatible/incompatible reconfigure.
- [ ] Compare portable/JUCE node ids, labels, option ids/labels, selected values, enabled states, two-column bounds, dispatched actions, and resulting portable state. Renderer tests must not inspect controller-specific ids or text.
- [ ] Update only generic renderer behavior exposed by the tests.
- [ ] Run:

```bash
make -C projects/synth/apps/miniapp \
  build/portable_juce_backend_tests \
  build/runtime_pages_juce_tests \
  build/controllers_page_simulation_tests
projects/synth/apps/miniapp/build/portable_juce_backend_tests
projects/synth/apps/miniapp/build/runtime_pages_juce_tests
projects/synth/apps/miniapp/build/controllers_page_simulation_tests
make -C projects/synth/apps/miniapp
make -C projects/synth/apps/controllers_harness
```

  Expected: every test passes and both apps link.
- [ ] Commit `test(synth-juce): prove controller wizard parity`.

### Task 17: Documentation and full verification

**Assigned model:** `gpt-5.5`, effort `high`
**OpenSpec tasks:** 7.1–7.3

**Files:**

- Modify: `projects/synth/README.md`
- Modify: `projects/synth/docs/coverage.md`
- Modify: `openspec/changes/add-controller-config-wizard/tasks.md`

- [ ] Document registry extension, descriptor-local exact aliases/unmatched diagnostics, opaque wizard ids, Active/Blacklisted schema, inert runtime behavior, one Encoder Slot, exact six-button choice/argument/default contract, destructive reconfigure warning, blacklist entry/removal flows, and browser/JUCE acceptance locations.
- [ ] Map scw-1–4; modified smi-1/2/3/6/8/10; modified sru-2/4/30; and added sru-32/33/34 to concrete tests in `coverage.md`.
- [ ] Run focused C++ verification:

```bash
make -C projects/synth \
  build/instrument_tests \
  build/reconcile_tests \
  build/reconcile_executor_tests \
  build/engine_tests \
  build/viewmodel_tests \
  build/controller_wizard_tests \
  build/controllers_page_ui_tests \
  build/runtime_main_component_tests \
  build/browser_runtime_contract_tests \
  build/browser_command_buffer_tests \
  build/browser_midi_bridge_tests
projects/synth/build/instrument_tests
projects/synth/build/reconcile_tests
projects/synth/build/reconcile_executor_tests
projects/synth/build/engine_tests
projects/synth/build/viewmodel_tests
projects/synth/build/controller_wizard_tests
projects/synth/build/controllers_page_ui_tests
projects/synth/build/runtime_main_component_tests
projects/synth/build/browser_runtime_contract_tests
projects/synth/build/browser_command_buffer_tests
projects/synth/build/browser_midi_bridge_tests
```

- [ ] Run full matrices:

```bash
make -C projects/synth test
cd projects/synth/browser && npm test
make -C projects/synth/apps/miniapp test
make -C projects/synth/apps/miniapp
make -C projects/synth/apps/controllers_harness
openspec validate add-controller-config-wizard --strict
```

  Expected: all commands succeed with no skipped wizard/blacklist cases.
- [ ] Check OpenSpec boxes only according to the map below, then run:

```bash
openspec instructions apply --change add-controller-config-wizard --json
```

  Expected after all task reviews: `state` complete and `36/36`.
- [ ] Commit `docs(synth): document controller wizard workflow`.

## Task-to-OpenSpec Completion Map

| Plan task | OpenSpec checkboxes |
|---|---|
| 1 | 1.1–1.3 |
| 2 | 2.1–2.2 |
| 3 | 2.3–2.4 |
| 4 | 2.5–2.6 |
| 5 | 2.7–2.8 |
| 6 | 3.1–3.2 |
| 7 | 3.3–3.4 |
| 8 | 3.5–3.6 |
| 9 | 3.7–3.8 |
| 10 | 4.1–4.3 |
| 11 | 4.4 routing/session portion |
| 12 | 4.4 commit portion |
| 13 | 4.5–4.6 non-reconfigure portion |
| 14 | 4.5–4.7 reconfigure/save portion |
| 15 | 5.1–5.3 |
| 16 | 6.1–6.4 |
| 17 | 7.1–7.3 |
