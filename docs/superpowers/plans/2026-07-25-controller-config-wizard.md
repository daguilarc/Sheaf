# Controller Config Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize an attached MIDI Fighter Twister input/output pair, warn when it is unconfigured, and provide a portable three-click Controllers → Configuration Wizard → Submit flow that installs and persists a complete profile, with blacklist and stored-profile lifecycle controls in both browser and JUCE hosts.

**Architecture:** Add controller disposition to the existing ordered instrument records, keeping an active profile in `config` and optional blacklisted seed data in `dormantConfig`; make reconciliation and processor construction explicitly inert for blacklisted records. Add a JUCE-free controller-wizard module with polymorphic portable forms, a checked typed adapter, baked pair discovery, and the single MF Twister implementation. `ControllersPageSurface` owns discovery and wizard-session state, while `RuntimeMainComponent` owns the background warning snapshot. Browser and JUCE remain generic renderers of the same portable tree.

**Tech Stack:** C++20, the existing portable `synth::ui::Surface` contract, existing JSON arena helpers, TypeScript/Web MIDI, Playwright 1.60, JUCE, GNU Make.

**OpenSpec change:** `openspec/changes/add-controller-config-wizard`

## Global Constraints

- The MF Twister wizard has **exactly six buttons total**, arranged as two columns of three. Buttons 0–2 are the left column and buttons 3–5 are the right column. Do not render, persist, or generate any seventh button.
- The six defaults, in button order, are Hold Reset; Hold Random; Hold Random Mod; Next Bank with slot argument 0; Start; Previous Bank with slot argument 0.
- A generated Twister profile has exactly six side-button associations on zero-based MIDI channel 3, CCs 8–13, with output feedback disabled; it retains the existing sixteen encoder defaults.
- The unique-candidate happy path is exactly three user activations: Controllers, Configuration Wizard, Submit. No candidate chooser or confirmation is inserted.
- Core model, discovery, form, generation, and portable page policy remain JUCE-free. Browser TypeScript and JUCE renderer code contain no MF Twister, blacklist, generation, matching, or validation branches.
- Availability is pure and deterministic. Both endpoints must be present and recognized; an endpoint claimed by any active or blacklisted record suppresses the pair. Compare stored refs by exact identifier first and stored name fallback second.
- A blacklisted record retains its name, kind, input, output, and list position. It never opens either endpoint, never registers an output sink, and receives an explicit drop input processor that emits no ordinary or realtime message.
- `MidiProfileKind` remains a hardware/profile kind. Do not add a `Blacklist` profile kind.
- Successful Submit or Ignore performs one instrument commit and then requests an immediate runtime-configuration save. Validation, type mismatch, disappearance, contention, or duplicate-name refusal must not commit or save and must retain the form state.
- Previous instrument schema documents load all records as Active. New malformed documents are parsed into scratch state and cannot partially mutate the live target.
- Existing manual add and low-level profile editing remain available for active records.
- Use test-driven development in every implementation task: add or tighten the named test first, observe the expected failure, implement the smallest coherent production change, then run the focused regression set.
- Do not mark an OpenSpec checkbox complete until the corresponding implementation has passed its focused tests and task review.
- One commit per task, after tests and self-review. Do not bundle unrelated cleanup.

---

### Task 1: Pin the browser-first acceptance contract

**OpenSpec tasks:** 1.1, 1.2, 1.3

**Files:**

- Modify: `projects/synth/browser/tests/fake-app.e2e.spec.ts`

**Stable portable ids/actions the acceptance test must use:**

```text
runtime.sidebar.controllers
runtime.controllers.wizard.open
runtime.controllers.available
runtime.controllers.available.<candidate>.configure
runtime.controllers.available.<candidate>.ignore
runtime.controllers.wizard.chooser
runtime.controllers.wizard.form
runtime.controllers.wizard.button.<0..5>.message
runtime.controllers.wizard.button.<0..5>.argument
runtime.controllers.wizard.submit
runtime.controllers.wizard.ignore
runtime.controllers.record.<ix>.rename
runtime.controllers.record.<ix>.reconfigure
runtime.controllers.record.<ix>.blacklist
runtime.controllers.record.<ix>.delete
runtime.controllers.record.<ix>.configure
runtime.controllers.record.<ix>.remove_blacklist
```

**Steps:**

- [ ] Extend the existing real fake-app Web MIDI mock with helpers that create/remove recognized pairs using the exact test names `Midi Fighter Twister` for both directions and stable distinct ids such as `twister-in-1` / `twister-out-1`. The helpers must support two same-name pairs and must drive the existing `onstatechange`/poll path rather than reaching into C++ state.
- [ ] Add one Playwright test whose click statements are visibly only:

```ts
await page.locator('[data-synth-node-id="runtime.sidebar.controllers"]').click();
await page.locator('[data-synth-node-id="runtime.controllers.wizard.open"]').click();
await page.locator('[data-synth-node-id="runtime.controllers.wizard.submit"]').click();
```

  Before Submit, assert exactly six message controls and exactly six argument controls, the two-column geometry, and the six specified defaults. After Submit, assert an Active Twister row, both endpoint labels, cleared sidebar warning, and a persistence/save observation that survives a runtime reload.
- [ ] Add browser cases for: two candidates and chooser selection; Ignore from an available row; Ignore from the unique form; warning return after Remove from blacklist; disconnected Submit refusal retaining edited controls; duplicate/invalid rename refusal; delete; active reconfigure; blacklisted configure. Count the form controls in every relevant case so a twelve-button regression cannot pass.
- [ ] Run:

```bash
cd projects/synth/browser
npx playwright test tests/fake-app.e2e.spec.ts --grep "controller wizard"
```

  Expected at this stage: Playwright builds and launches the fixture, then fails on the first missing warning/wizard selector. TypeScript compilation and fixture startup must pass; a setup or infrastructure error is not an acceptable red.
- [ ] Commit: `test(synth-browser): pin controller wizard acceptance flow`

---

### Task 2: Add Active/Blacklisted instrument records and schema migration

**OpenSpec tasks:** 2.1, 2.2, 2.3, 2.4

**Files:**

- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/tests/instrument_tests.cpp`

**Model contract:**

```cpp
enum class MidiControllerDisposition { Active, Blacklisted };

struct MidiControllerSlot {
    std::string name;
    MidiProfileKind kind = MidiProfileKind::Generic;
    MidiControllerDisposition disposition = MidiControllerDisposition::Active;
    MidiControllerProfileConfig config;  // runtime-active only when disposition == Active
    std::optional<MidiControllerProfileConfig> dormantConfig; // optional wizard seed for blacklist
    MidiEndpointRef input;
    MidiEndpointRef output;
};

bool IsActive(const MidiControllerSlot& slot);
bool SlotValidForKind(const MidiControllerSlot& slot, std::string* reason = nullptr);
```

This representation deliberately avoids making every existing active-profile caller unwrap an optional. For Blacklisted records, `config` must be reset/ignored and only `dormantConfig` may be serialized as a dormant `profile`.

**Steps:**

- [ ] Add failing `instrument_tests.cpp` coverage for valid Active records, valid new Blacklisted records with no dormant profile, Blacklisted records requiring both endpoint refs, dormant Twister profile validation, unique names across dispositions, mixed ordered add/rename/replace/remove, middle removal, and trailing removal.
- [ ] Add failing JSON tests for schema version increment, Active/Blacklisted round trips, dormant profile round trip, previous version loading as Active, and atomic rejection of unknown disposition, Active without profile, Blacklisted without both endpoint refs, malformed endpoint refs, duplicate names, and kind-incompatible dormant profile.
- [ ] Implement disposition naming/parsing and branch `SlotValidForKind`: Active validates `config` with the existing per-kind rules; Blacklisted requires both endpoints, rejects runtime-active config data, and validates `dormantConfig` against the retained kind when present.
- [ ] Update controller JSON entry writers/readers so new Active entries write `disposition: "active"` and `profile: config`; new Blacklisted entries write `disposition: "blacklisted"` and omit `profile` unless `dormantConfig` exists. Accept exactly the preceding instrument schema by parsing its required profiles as Active.
- [ ] Run:

```bash
make -C projects/synth build/instrument_tests
projects/synth/build/instrument_tests
make -C projects/synth build/viewmodel_tests build/controllers_page_ui_tests
projects/synth/build/viewmodel_tests
projects/synth/build/controllers_page_ui_tests
```

  Expected: all pass with no compiler warnings.
- [ ] Commit: `feat(synth): persist active and blacklisted controller records`

---

### Task 3: Make blacklisted records inert in reconciliation and processor construction

**OpenSpec tasks:** 2.5, 2.6, 2.7, 2.8

**Files:**

- Modify: `projects/synth/include/synth/MidiController.hpp`
- Modify: `projects/synth/src/MidiController.cpp`
- Modify: `projects/synth/include/synth/MidiReconcile.hpp`
- Modify: `projects/synth/src/MidiReconcile.cpp`
- Modify: `projects/synth/include/synth/Engine.hpp`
- Modify if executor assertions need extension: `projects/synth/runtime/MidiConnectionManager.hpp`
- Modify if browser binding assertions need extension: `projects/synth/include/synth/browser/BrowserMidiBridge.hpp`
- Modify: `projects/synth/tests/reconcile_tests.cpp`
- Modify: `projects/synth/tests/reconcile_executor_tests.cpp`
- Modify: `projects/synth/tests/engine_tests.cpp`
- Modify: `projects/synth/tests/browser_midi_bridge_tests.cpp`

**Processor contract:**

```cpp
class DropMidiInProcessor final : public MidiInProcessor {
public:
    DropMidiInProcessor() : MidiInProcessor(nullptr) {}
    void Process(const BasicMidi&) override {}
};

MidiControllerProfileResult CreateBlacklistedMidiControllerProfile();
```

`CreateBlacklistedMidiControllerProfile()` returns one `DropMidiInProcessor`, an empty thru vector, and an empty output vector. `Engine::RebuildMidiProcessors()` chooses it solely from disposition and never reads blacklisted `config`/`dormantConfig`.

**Steps:**

- [ ] Add reconciliation tests proving a present Blacklisted pair produces no open/update/resync actions; Blacklisted records claim no device away from Active records; already inert state converges; and Active→Blacklisted produces CloseInput/CloseOutput plus inert state transitions without reopening.
- [ ] Add explicit `MarkInputUnconfigured` and `MarkOutputUnconfigured` reconcile actions. In `PlanEndpointPass`, branch on disposition before matching; for a Blacklisted slot, emit Close for an Online endpoint followed by MarkUnconfigured, and emit MarkUnconfigured for an Offline endpoint. Teach the executor and both host bindings those generic actions. Never overload Offline to mean blacklisted/inert.
- [ ] Add engine tests invoking the rebuilt Blacklisted input with ordinary CC, Start/Clock realtime, and SysEx messages and asserting the bus receives nothing. Assert outputs/thru are empty, no sender sink is installed, Blacklisted→Active rebuilds normal processors, and deletion still resizes stable route slots.
- [ ] Update the JUCE and browser connection bindings only enough to execute the new generic inert action. They must not contain wizard or Twister policy.
- [ ] Run:

```bash
make -C projects/synth build/reconcile_tests build/reconcile_executor_tests build/engine_tests build/browser_midi_bridge_tests
projects/synth/build/reconcile_tests
projects/synth/build/reconcile_executor_tests
projects/synth/build/engine_tests
projects/synth/build/browser_midi_bridge_tests
```

  Expected: all pass.
- [ ] Commit: `feat(synth): keep blacklisted MIDI routes inert`

---

### Task 4: Implement typed wizard contracts, baked registry, and pure discovery

**OpenSpec tasks:** 3.1, 3.2, 3.3, 3.4

**Files:**

- Create: `projects/synth/include/synth/ControllerWizard.hpp`
- Create: `projects/synth/src/ControllerWizard.cpp`
- Create: `projects/synth/tests/controller_wizard_tests.cpp`
- Modify: `projects/synth/Makefile`
- Modify: `projects/synth/browser/src/build-browser-apps.mjs`
- Modify: `projects/synth/runtime/juce_build.mk`

**Core interfaces:**

```cpp
namespace synth {

struct WizardCandidate {
    std::string wizardId;
    std::string displayName;
    MidiProfileKind kind;
    MidiDeviceInfoRef input;
    MidiDeviceInfoRef output;
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

class ControllerConfigForm : public ui::Surface {
public:
    ~ControllerConfigForm() override = default;
    virtual std::string WizardId() const = 0;
    virtual bool Validate(std::string& error) const = 0;
};

class ControllerWizard {
public:
    virtual ~ControllerWizard() = default;
    virtual std::string_view Id() const = 0;
    virtual std::unique_ptr<ControllerConfigForm>
        ConfigForm(const std::optional<MidiControllerSlot>& seed = std::nullopt) const = 0;
    virtual WizardGenerationResult
        GenerateProfile(const ControllerConfigForm&, const WizardGenerationContext&) const = 0;
};

template <class Form>
class TypedControllerWizard : public ControllerWizard {
public:
    std::unique_ptr<ControllerConfigForm>
        ConfigForm(const std::optional<MidiControllerSlot>& seed) const final;
    WizardGenerationResult
        GenerateProfile(const ControllerConfigForm& form,
                        const WizardGenerationContext& context) const final;
protected:
    virtual std::unique_ptr<Form>
        CreateTypedForm(const std::optional<MidiControllerSlot>& seed) const = 0;
    virtual WizardGenerationResult
        GenerateTypedProfile(const Form&, const WizardGenerationContext&) const = 0;
};

struct ControllerWizardDescriptor {
    std::string id;
    std::string displayName;
    MidiProfileKind kind;
    std::function<bool(std::string_view)> matchesInputName;
    std::function<bool(std::string_view)> matchesOutputName;
    std::function<std::unique_ptr<ControllerWizard>()> factory;
};

struct WizardDiscovery {
    std::vector<WizardCandidate> available;
    std::vector<MidiDeviceInfoRef> unmatchedInputs;
    std::vector<MidiDeviceInfoRef> unmatchedOutputs;
    bool HasAvailable() const { return !available.empty(); }
};

const std::vector<ControllerWizardDescriptor>& ControllerWizardRegistry();
WizardDiscovery DiscoverControllerWizards(
    const MidiDeviceList&, const MidiInstrumentConfig&,
    const std::vector<ControllerWizardDescriptor>& registry = ControllerWizardRegistry());
std::unique_ptr<ControllerWizard> MakeControllerWizard(std::string_view wizardId);
}
```

Use `dynamic_cast<const Form*>` in the typed adapter, assert in debug, and return an explicit type-mismatch error in production without mutation. Do not store a raw owning pointer. Compile `controller_wizard_tests` with `-DNDEBUG` so its wrong-form case verifies the recoverable production contract; normal synth/JUCE/browser builds retain the debug assertion.

**Steps:**

- [ ] Add typed-adapter tests with two dummy forms/wizards: concrete creation, explicit `unique_ptr` ownership, correct generation, wrong-form refusal, validation error, and preservation of edited form memory.
- [ ] Add pure discovery tests for registry order, recognized Twister pair, input-only/output-only absence, endpoint exclusivity, two duplicate same-name pairs paired by enumeration order, exact-id and name-fallback claims, half-configured claim suppression, Active claim, Blacklisted claim, stable results, and unmatched diagnostics.
- [ ] Implement the generic module and a single baked descriptor accepting the known name aliases `Midi Fighter Twister` and `Midi Fighter Twister MIDI 1` in each direction. Keep aliases descriptor-local and exact/case-sensitive.
- [ ] Add the new source/object/test target to native, browser, and JUCE source lists. The new test binary is `build/controller_wizard_tests`.
- [ ] Run:

```bash
make -C projects/synth build/controller_wizard_tests
projects/synth/build/controller_wizard_tests
make -C projects/synth check-ui-boundary
```

  Expected: all pass and the UI-boundary scan reports no JUCE leakage.
- [ ] Commit: `feat(synth): add typed controller wizard discovery core`

---

### Task 5: Implement the exact six-button MF Twister form and generator

**OpenSpec tasks:** 3.5, 3.6, 3.7, 3.8

**Files:**

- Modify: `projects/synth/include/synth/ControllerWizard.hpp`
- Modify: `projects/synth/src/ControllerWizard.cpp`
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/tests/controller_wizard_tests.cpp`
- Modify: `projects/synth/tests/instrument_tests.cpp`

**Reusable system-message helpers to expose from the view-model module:**

```cpp
bool UISystemMessageHasArgument(UISystemMessage);
std::optional<std::size_t> UISystemMessageCatalogIndex(UISystemMessage);
bool BuildUISystemMessageAssociation(UISystemMessage message,
                                     std::size_t argument,
                                     MidiControllerSystemMessageAssociation& out,
                                     std::string* reason = nullptr);
```

Move/reuse the existing `PressForUISystemMessage`, release, and argument semantics behind these helpers; do not create a wizard-only message enum.

**Twister form shape:**

```cpp
struct MfTwisterButtonConfig {
    UISystemMessage message;
    std::size_t argument = 0;
};

class MfTwisterConfigForm final : public ControllerConfigForm {
public:
    static constexpr std::size_t kButtonCount = 6;
    const std::array<MfTwisterButtonConfig, kButtonCount>& Buttons() const;
    ui::NodeTree BuildTree() override;
    void DispatchAction(const ui::Action&) override;
    bool Validate(std::string& error) const override;
};

class MfTwisterControllerWizard final
    : public TypedControllerWizard<MfTwisterConfigForm> { /* typed hooks */ };
```

**Steps:**

- [ ] Add form tests asserting `kButtonCount == 6`, exactly six row nodes, six dropdowns, six argument fields, two columns with rows 0–2 left and 3–5 right, the exact defaults, disabled arguments for Hold/Start, enabled argument 0 for Next/Previous, stable ids, catalog options, edits through `DispatchAction`, invalid text/range errors, and retained state.
- [ ] Seed reconfiguration from exactly six valid dormant/active Twister side associations when possible; otherwise use the six defaults. Never infer extra buttons from arbitrary system-message rows.
- [ ] Add generation tests proving sixteen encoder turns/pushes/outputs remain, systemMessages has size exactly 6, controls are channel 3 CC 8–13, output feedback is false, hold actions carry matching false releases, bank actions use `slotIx`, Start ignores the disabled numeric value, endpoints/name/kind/disposition are assigned, and invalid generation is atomic.
- [ ] Implement `BuildTree()` as a form-owned Root with two column Sections or Rows. The backend sees ordinary ComboBox/TextField/Button nodes only. Set `enabled = false` on no-argument fields.
- [ ] Generate via `MfTwisterDefaultProfileOptions::sideButtons` and `MfTwisterDefaultProfileConfig`; do not duplicate the encoder or hardware-address factory.
- [ ] Run:

```bash
make -C projects/synth build/controller_wizard_tests build/instrument_tests
projects/synth/build/controller_wizard_tests
projects/synth/build/instrument_tests
```

  Expected: all pass.
- [ ] Commit: `feat(synth): generate exact six-button twister profiles`

---

### Task 6: Add portable discovery, warning, wizard session, and controller lifecycle UI

**OpenSpec tasks:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6

**Files:**

- Modify: `projects/synth/include/synth/RuntimePages.hpp`
- Modify: `projects/synth/include/synth/RuntimeMainComponent.hpp`
- Modify: `projects/synth/include/synth/ControllersPageUI.hpp`
- Modify: `projects/synth/include/synth/MidiConfigViewModel.hpp`
- Modify: `projects/synth/src/MidiConfigViewModel.cpp`
- Modify: `projects/synth/runtime/JuceRuntimeMainServices.hpp`
- Modify: `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`
- Modify: `projects/synth/tests/runtime_main_component_tests.cpp`
- Modify: `projects/synth/tests/controllers_page_ui_tests.cpp`
- Modify: `projects/synth/tests/viewmodel_tests.cpp`
- Modify: `projects/synth/tests/portable_ui_tests.cpp`

**Host callback additions:**

```cpp
struct ControllersPageCallbacks {
    std::function<MidiInstrumentConfig()> instrumentSnapshot;
    std::function<MidiConnectionState()> connectionState;
    std::function<MidiDeviceList()> enumerateDevices;
    std::function<void(MidiInstrumentConfig)> commitInstrument;
    std::function<bool()> saveRuntimeConfiguration;
    std::function<void(std::string)> setStatus;
    std::function<void()> onBack;
};

// RuntimeMainComponent::Refresh computes this even while another page is open:
WizardDiscovery discovery = DiscoverControllerWizards(
    services_.EnumerateMidiDevices(), services_.SnapshotMidiInstrument());
sidebarSurface_.SetControllersWarning(discovery.HasAvailable());
controllersSurface_.SetDiscovery(std::move(discovery));
```

Add `EnumerateMidiDevices()` and `SnapshotMidiInstrument()` to the `RuntimeMainServices` concept and both production services. `RuntimeMainComponent::Refresh()` computes discovery from those two snapshots before page-specific refresh, so the sidebar updates while Controllers is closed. `RefreshControllers()` continues to provide connection state and dirty/focus handling.

**Lifecycle view-model APIs:**

```cpp
bool RenameController(std::size_t, std::string, MidiInstrumentConfig&, std::string*);
bool DeleteController(std::size_t, MidiInstrumentConfig&);
bool BlacklistController(std::size_t, MidiInstrumentConfig&, std::string*);
bool RemoveFromBlacklist(std::size_t, MidiInstrumentConfig&);
```

Blacklisting moves the active config into `dormantConfig`, resets `config`, and changes disposition. Wizard Configure/Reconfigure is owned by `ControllersPageSurface` because it requires registry/form state.

**Steps:**

- [ ] Add runtime-main tests that a recognized unclaimed pair labels the sidebar button `Controllers ⚠️` while the app/Audio/File page is open, and that Active or Blacklisted claims clear it on refresh.
- [ ] Add portable page tests for available rows, unique direct open, multi-candidate chooser, exact six-button form embedding, field dispatch, Submit, Ignore from row/form, candidate disappearance refusal with retained state, duplicate-name handling, unique default naming, and save callback only after successful commits.
- [ ] Add view-model/page tests for rename across dispositions, active Reconfigure/Blacklist/Delete, blacklisted Rename/Configure/Remove, hidden mapping disclosure and endpoint selectors on blacklisted rows, offline reconfigure, and preservation of stored name/endpoints/order on reconfigure.
- [ ] Implement a `WizardSession` owned by `ControllersPageSurface` with target variant `NewCandidate` or `ExistingRecord`, wizard and form `unique_ptr`s, and inline status. Revalidate new candidates from fresh devices/instrument on Submit/Ignore; existing offline records use stored refs.
- [ ] Make `BuildTree()` route between normal list, chooser, and active form. When one candidate exists, `Configuration Wizard` calls `OpenCandidate(0)` directly. Use the stable ids from Task 1.
- [ ] Preserve manual Add and low-level editing for Active rows. Blacklisted rows render their badge and stored endpoint labels but no live selectors, disclosure, or mapping tree.
- [ ] Run:

```bash
make -C projects/synth build/viewmodel_tests build/controllers_page_ui_tests build/runtime_main_component_tests build/portable_ui_tests
projects/synth/build/viewmodel_tests
projects/synth/build/controllers_page_ui_tests
projects/synth/build/runtime_main_component_tests
projects/synth/build/portable_ui_tests
```

  Expected: all pass.
- [ ] Commit: `feat(synth): add portable controller wizard workflow`

---

### Task 7: Wire immediate saving and runtime host refresh behavior

**OpenSpec tasks:** 4.7

**Files:**

- Modify: `projects/synth/runtime/JuceRuntimeMainServices.hpp`
- Modify: `projects/synth/include/synth/browser/BrowserRuntimeMainServices.hpp`
- Modify: `projects/synth/include/synth/browser/BrowserRuntime.hpp`
- Modify: `projects/synth/include/synth/browser/BrowserMidiBridge.hpp`
- Modify: `projects/synth/tests/browser_runtime_contract_tests.cpp`
- Modify: `projects/synth/tests/browser_audio_device_tests.cpp`
- Modify or create focused runtime-config cases in: `projects/synth/tests/engine_tests.cpp`

**Steps:**

- [ ] Add tests whose fake services count commits and saves separately: valid Submit and Ignore each produce one commit followed by one save; invalid/disconnected/type-mismatch actions produce neither; rename/delete/blacklist/remove/reconfigure produce a save only after their commit succeeds.
- [ ] Wire `ControllersPageCallbacks::saveRuntimeConfiguration` in JUCE to `Runtime::SaveRuntimeConfiguration()` and in browser to `Engine::SaveRuntimeConfiguration()` plus the existing persistence-dirty notification. Return success/failure so a failed save can be reported without undoing an already committed instrument.
- [ ] Ensure browser and JUCE refresh snapshots use the latest device list on every refresh and mark the controller surface dirty after engine rebuild. Do not enumerate/open devices from the form.
- [ ] Add a runtime-config round trip with one Active generated Twister and one Blacklisted pair, then load into a new engine and verify dispositions, profiles, endpoints, and order. Assert refused wizard actions leave the prior serialized document byte-equivalent.
- [ ] Run:

```bash
make -C projects/synth build/browser_runtime_contract_tests build/browser_audio_device_tests build/engine_tests
projects/synth/build/browser_runtime_contract_tests
projects/synth/build/browser_audio_device_tests
projects/synth/build/engine_tests
```

  Expected: all pass.
- [ ] Commit: `feat(synth-runtime): save controller wizard lifecycle commits`

---

### Task 8: Make the browser backend acceptance suite pass

**OpenSpec tasks:** 5.1, 5.2, 5.3

**Files:**

- Modify: `projects/synth/browser/tests/ui-backend.spec.ts`
- Modify: `projects/synth/browser/tests/fake-app.e2e.spec.ts`
- Modify: `projects/synth/browser/tests/midi-flow.spec.ts`
- Modify: `projects/synth/tests/browser_command_buffer_tests.cpp`

**Steps:**

- [ ] Add regression tests for the existing generic enabled-state path: command-buffer round trip preserves `Node::enabled`, and a disabled ComboBox/TextField/Button receives the HTML `disabled` state, preserves selected options and labels, and cannot dispatch. Do not add controller-specific browser rendering code.
- [ ] Make the Task 1 Playwright acceptance cases pass through the production fake-app WASM runtime. Use Web MIDI port changes to drive discovery, and production portable actions to configure/ignore/reconfigure; do not add test-only controller state mutation exports.
- [ ] Verify persistence by destroying/recreating the runtime using the existing browser persistence mechanism and observing the Active/Blacklisted rows after reload.
- [ ] Run focused browser checks:

```bash
make -C projects/synth browser-command-buffer-test browser-midi-bridge-test browser-fixture-app
cd projects/synth/browser
npm run build
npm run check:generic-runtime
node --test dist/tests/*.test.mjs
npx playwright test tests/ui-backend.spec.ts tests/fake-app.e2e.spec.ts tests/midi-flow.spec.ts
```

  Expected: all pass, including every “controller wizard” case.
- [ ] Run the complete browser suite:

```bash
cd projects/synth/browser
npm test
```

  Expected: all pass with no skipped wizard cases.
- [ ] Commit: `test(synth-browser): complete controller wizard flow`

---

### Task 9: Prove JUCE renderer parity for the same portable tree

**OpenSpec tasks:** 6.1, 6.2, 6.3, 6.4

**Files:**

- Modify: `projects/synth/juce/PortableJuceBackendTests.cpp`
- Modify: `projects/synth/juce/ControllersPageSimulationTests.cpp`
- Modify: `projects/synth/juce/RuntimePagesJuceTests.cpp`
- Modify if harness fixtures need recognized ports: `projects/synth/juce/ControllersPageHarness.hpp`

**Steps:**

- [ ] Add generic JUCE backend assertions for disabled ComboBox/TextField/Button controls and for stable selected options/action values. No test or production renderer branch may inspect Twister ids.
- [ ] Extend Controllers simulation fixtures with one and two recognized Twister pairs. Dispatch the same portable actions/ids as Task 1 and assert warning, unique/chooser flow, exactly six form rows, defaults, edit, Submit, Ignore, rename, delete, blacklist removal, and reconfigure.
- [ ] Compare a built `MfTwisterConfigForm` tree against browser/portable expectations: ids, labels, option ids/labels, selected ids, enabled state, bounds establishing two columns of three, and action results.
- [ ] Build and run:

```bash
make -C projects/synth/apps/miniapp \
  build/portable_juce_backend_tests \
  build/runtime_pages_juce_tests \
  build/controllers_page_simulation_tests
projects/synth/apps/miniapp/build/portable_juce_backend_tests
projects/synth/apps/miniapp/build/runtime_pages_juce_tests
projects/synth/apps/miniapp/build/controllers_page_simulation_tests
```

  Expected: all pass; the simulation reports its normal deterministic seed.
- [ ] Build the JUCE application/harness:

```bash
make -C projects/synth/apps/miniapp
make -C projects/synth/apps/controllers_harness
```

  Expected: both link successfully with no warnings.
- [ ] Commit: `test(synth-juce): cover controller wizard parity`

---

### Task 10: Documentation, full verification, and OpenSpec completion

**OpenSpec tasks:** 7.1, 7.2, 7.3

**Files:**

- Modify: `projects/synth/README.md`
- Modify: `projects/synth/docs/coverage.md`
- Modify: `openspec/changes/add-controller-config-wizard/tasks.md`

**Steps:**

- [ ] Document how to add another baked wizard descriptor and typed form, the known Twister aliases, the exact six-button layout/defaults, Active/Blacklisted persistence, inert runtime behavior, lifecycle actions, and the browser/JUCE acceptance locations.
- [ ] Update `projects/synth/docs/coverage.md` for requirements `scw-1` through `scw-4`, modified `smi-1`, `smi-2`, `smi-3`, `smi-6`, `smi-8`, modified `sru-2`, `sru-4`, and added `sru-32`, `sru-33`.
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

  Expected: every command succeeds, with no skipped wizard/blacklist tests.
- [ ] Check every OpenSpec task only after its mapped implementation task has passed review. Confirm:

```bash
openspec instructions apply --change add-controller-config-wizard --json
```

  Expected: `state` is complete and progress is `36/36`.
- [ ] Commit: `docs(synth): document controller wizard workflow`

---

## Task-to-OpenSpec completion map

| Plan task | OpenSpec checkboxes |
|---|---|
| 1 | 1.1–1.3 |
| 2 | 2.1–2.4 |
| 3 | 2.5–2.8 |
| 4 | 3.1–3.4 |
| 5 | 3.5–3.8 |
| 6 | 4.1–4.6 |
| 7 | 4.7 |
| 8 | 5.1–5.3 |
| 9 | 6.1–6.4 |
| 10 | 7.1–7.3 |
