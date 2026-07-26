#include "synth/ControllerWizard.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "controller wizard contracts must not see JUCE headers"
#endif

#include <iostream>
#include <initializer_list>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace {

struct TestCase {
    const char* name;
    void (*fn)();
};

std::vector<TestCase>& Registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Register {
    Register(const char* name, void (*fn)()) {
        Registry().push_back({name, fn});
    }
};

#define TEST_CASE(name) \
    void name(); \
    Register reg_##name(#name, &name); \
    void name()

#define REQUIRE_TRUE(expr) \
    do { \
        if (!(expr)) { \
            throw std::runtime_error(std::string("requirement failed: ") + #expr); \
        } \
    } while (false)

class FirstForm final : public synth::ControllerConfigForm {
public:
    ~FirstForm() override {
        ++destroyedCount;
    }

    std::string_view WizardId() const override { return "test.first"; }

    bool Validate(std::string& error) const override {
        if (name_.empty()) {
            error = "name is required";
            return false;
        }
        error.clear();
        return true;
    }

    synth::ui::NodeTree BuildTree() override { return {}; }

    void SetActionHandler(ActionHandler handler) override {
        actionHandler_ = std::move(handler);
    }

    void DispatchAction(const synth::ui::Action& action) override {
        if (action.name == "set-name") {
            name_ = action.value;
        }
        if (actionHandler_) {
            actionHandler_(action);
        }
    }

    std::string_view Name() const { return name_; }

    static int destroyedCount;

private:
    std::string name_;
    ActionHandler actionHandler_;
};

int FirstForm::destroyedCount = 0;

class SecondForm final : public synth::ControllerConfigForm {
public:
    std::string_view WizardId() const override { return "test.second"; }

    bool Validate(std::string& error) const override {
        error.clear();
        return true;
    }

    synth::ui::NodeTree BuildTree() override { return {}; }
    void SetActionHandler(ActionHandler) override {}
    void DispatchAction(const synth::ui::Action&) override {}
};

class FirstWizard final : public synth::TypedControllerWizard<FirstForm> {
public:
    std::string_view Id() const override { return "test.first"; }

    std::unique_ptr<synth::ControllerConfigForm>
    ConfigForm(const std::optional<synth::MidiControllerSlot>&) const override {
        return std::make_unique<FirstForm>();
    }

protected:
    synth::WizardGenerationResult GenerateTypedProfile(
        const FirstForm& form, const synth::WizardGenerationContext& context) const override {
        ++generationCount;
        synth::MidiControllerSlot slot;
        slot.name = std::string(form.Name());
        slot.input = context.input;
        slot.output = context.output;
        return {.controller = std::move(slot)};
    }

public:
    mutable int generationCount = 0;
};

class SecondWizard final : public synth::TypedControllerWizard<SecondForm> {
public:
    std::string_view Id() const override { return "test.second"; }

    std::unique_ptr<synth::ControllerConfigForm>
    ConfigForm(const std::optional<synth::MidiControllerSlot>&) const override {
        return std::make_unique<SecondForm>();
    }

protected:
    synth::WizardGenerationResult GenerateTypedProfile(
        const SecondForm&, const synth::WizardGenerationContext&) const override {
        ++generationCount;
        return {};
    }

public:
    mutable int generationCount = 0;
};

synth::WizardGenerationContext Context() {
    return {.name = "ignored-by-form", .input = {.identifier = "in-id", .name = "Input"},
            .output = {.identifier = "out-id", .name = "Output"}};
}

synth::MidiDeviceInfoRef Device(std::string identifier, std::string name) {
    return {.identifier = std::move(identifier), .name = std::move(name)};
}

synth::MidiEndpointRef Endpoint(std::string identifier, std::string name) {
    return {.identifier = std::move(identifier), .name = std::move(name)};
}

synth::MidiDeviceList Devices(std::initializer_list<synth::MidiDeviceInfoRef> inputs,
                              std::initializer_list<synth::MidiDeviceInfoRef> outputs) {
    return {.inputs = inputs, .outputs = outputs};
}

synth::ControllerWizardDescriptor Descriptor(
    std::string id, std::string displayName, synth::MidiProfileKind kind,
    std::initializer_list<std::string> inputAliases,
    std::initializer_list<std::string> outputAliases) {
    return {.id = std::move(id),
            .displayName = std::move(displayName),
            .kind = kind,
            .inputAliases = inputAliases,
            .outputAliases = outputAliases,
            .factory = [] { return std::unique_ptr<synth::ControllerWizard>{}; }};
}

std::vector<synth::ControllerWizardDescriptor> TestTwisterRegistry() {
    return {Descriptor("com.sheaf.midi-fighter-twister", "MIDI Fighter Twister",
                       synth::MidiProfileKind::MfTwister, {"Midi Fighter Twister"},
                       {"Midi Fighter Twister"})};
}

synth::MidiControllerSlot StoredController(std::string name,
                                           synth::MidiEndpointRef input,
                                           synth::MidiEndpointRef output) {
    synth::MidiControllerSlot slot;
    slot.name = std::move(name);
    slot.input = std::move(input);
    slot.output = std::move(output);
    return slot;
}

void RequireCandidate(const synth::WizardCandidate& candidate,
                      std::string_view wizardId,
                      std::string_view displayName,
                      synth::MidiProfileKind kind,
                      std::string_view inputId,
                      std::string_view outputId) {
    REQUIRE_TRUE(candidate.wizardId == wizardId);
    REQUIRE_TRUE(candidate.displayName == displayName);
    REQUIRE_TRUE(candidate.kind == kind);
    REQUIRE_TRUE(candidate.input.identifier == inputId);
    REQUIRE_TRUE(candidate.output.identifier == outputId);
}

void RequireDeviceIds(const std::vector<synth::MidiDeviceInfoRef>& devices,
                      std::initializer_list<std::string_view> ids) {
    REQUIRE_TRUE(devices.size() == ids.size());
    std::size_t ix = 0;
    for (std::string_view id : ids) {
        REQUIRE_TRUE(devices[ix].identifier == id);
        ++ix;
    }
}

TEST_CASE(ConfigFormOwnsStateAndDispatchActionMutatesIt) {
    FirstForm::destroyedCount = 0;
    FirstWizard wizard;
    {
        std::unique_ptr<synth::ControllerConfigForm> form = wizard.ConfigForm(std::nullopt);
        REQUIRE_TRUE(form != nullptr);
        REQUIRE_TRUE(dynamic_cast<FirstForm*>(form.get()) != nullptr);
        REQUIRE_TRUE(dynamic_cast<FirstForm*>(form.get())->Name().empty());

        form->DispatchAction(synth::ui::Action::WithValue("set-name", "Controller One"));
        REQUIRE_TRUE(dynamic_cast<FirstForm*>(form.get())->Name() == "Controller One");
    }
    REQUIRE_TRUE(FirstForm::destroyedCount == 1);
}

TEST_CASE(TypedWizardRejectsInvalidFormBeforeGeneration) {
    FirstWizard wizard;
    std::unique_ptr<synth::ControllerConfigForm> form = wizard.ConfigForm(std::nullopt);
    const synth::ControllerWizard& baseWizard = wizard;

    const synth::WizardGenerationResult result = baseWizard.GenerateProfile(*form, Context());

    REQUIRE_TRUE(!result);
    REQUIRE_TRUE(!result.error.empty());
    REQUIRE_TRUE(wizard.generationCount == 0);
}

TEST_CASE(TypedWizardGeneratesProfileFromItsConcreteForm) {
    FirstWizard wizard;
    std::unique_ptr<synth::ControllerConfigForm> form = wizard.ConfigForm(std::nullopt);
    form->DispatchAction(synth::ui::Action::WithValue("set-name", "Controller One"));
    const synth::ControllerWizard& baseWizard = wizard;

    const synth::WizardGenerationResult result = baseWizard.GenerateProfile(*form, Context());

    REQUIRE_TRUE(result);
    REQUIRE_TRUE(result.controller->name == "Controller One");
    REQUIRE_TRUE(result.controller->input.identifier == "in-id");
    REQUIRE_TRUE(result.controller->output.identifier == "out-id");
    REQUIRE_TRUE(wizard.generationCount == 1);
}

TEST_CASE(TypedWizardRejectsDifferentConcreteFormWithoutGeneration) {
    FirstWizard first;
    SecondWizard second;
    std::unique_ptr<synth::ControllerConfigForm> secondForm = second.ConfigForm(std::nullopt);
    const synth::ControllerWizard& firstBase = first;

    const synth::WizardGenerationResult result = firstBase.GenerateProfile(*secondForm, Context());

    REQUIRE_TRUE(!result);
    REQUIRE_TRUE(!result.error.empty());
    REQUIRE_TRUE(first.generationCount == 0);
    REQUIRE_TRUE(second.generationCount == 0);
}

TEST_CASE(ControllerWizardRegistryExposesStableMfTwisterDescriptor) {
    const std::vector<synth::ControllerWizardDescriptor>& registry =
        synth::ControllerWizardRegistry();

    REQUIRE_TRUE(!registry.empty());
    REQUIRE_TRUE(registry.front().id == "com.sheaf.midi-fighter-twister");
    REQUIRE_TRUE(registry.front().displayName == "MIDI Fighter Twister");
    REQUIRE_TRUE(registry.front().kind == synth::MidiProfileKind::MfTwister);
    REQUIRE_TRUE(registry.front().inputAliases.size() == 1);
    REQUIRE_TRUE(registry.front().inputAliases[0] == "Midi Fighter Twister");
    REQUIRE_TRUE(registry.front().outputAliases.size() == 1);
    REQUIRE_TRUE(registry.front().outputAliases[0] == "Midi Fighter Twister");
    REQUIRE_TRUE(synth::MakeControllerWizard("missing.wizard") == nullptr);
    REQUIRE_TRUE(synth::MakeControllerWizard("com.sheaf.midi-fighter-twister") == nullptr);
}

TEST_CASE(DiscoveryMatchesMidiFighterTwisterByCaseInsensitiveExactAlias) {
    const synth::MidiDeviceList devices = Devices(
        {Device("in-1", "mIDI fIGHTER tWISTER")},
        {Device("out-1", "MIDI FIGHTER TWISTER")});

    const synth::WizardDiscovery discovery =
        synth::DiscoverControllerWizards(devices, synth::MidiInstrumentConfig{},
                                         TestTwisterRegistry());

    REQUIRE_TRUE(discovery.available.size() == 1);
    RequireCandidate(discovery.available[0], "com.sheaf.midi-fighter-twister",
                     "MIDI Fighter Twister", synth::MidiProfileKind::MfTwister, "in-1", "out-1");
    REQUIRE_TRUE(discovery.unmatchedInputs.empty());
    REQUIRE_TRUE(discovery.unmatchedOutputs.empty());
}

TEST_CASE(DiscoveryRejectsPrefixSuffixAndImplicitNumberVariants) {
    const synth::MidiDeviceList devices = Devices(
        {Device("prefix-in", "USB Midi Fighter Twister"),
         Device("suffix-in", "Midi Fighter Twister Port 1"),
         Device("number-in", "Midi Fighter Twister 2")},
        {Device("prefix-out", "USB Midi Fighter Twister"),
         Device("suffix-out", "Midi Fighter Twister Port 1"),
         Device("number-out", "Midi Fighter Twister 2")});

    const synth::WizardDiscovery discovery =
        synth::DiscoverControllerWizards(devices, synth::MidiInstrumentConfig{},
                                         TestTwisterRegistry());

    REQUIRE_TRUE(discovery.available.empty());
    RequireDeviceIds(discovery.unmatchedInputs, {"prefix-in", "suffix-in", "number-in"});
    RequireDeviceIds(discovery.unmatchedOutputs, {"prefix-out", "suffix-out", "number-out"});
}

TEST_CASE(DiscoveryReportsUnmatchedNamesAndHalfPairs) {
    const synth::MidiDeviceList devices = Devices(
        {Device("twister-in", "Midi Fighter Twister"),
         Device("keyboard-in", "Keyboard")},
        {Device("drum-out", "Drum Rack")});

    const synth::WizardDiscovery discovery =
        synth::DiscoverControllerWizards(devices, synth::MidiInstrumentConfig{},
                                         TestTwisterRegistry());

    REQUIRE_TRUE(discovery.available.empty());
    RequireDeviceIds(discovery.unmatchedInputs, {"twister-in", "keyboard-in"});
    RequireDeviceIds(discovery.unmatchedOutputs, {"drum-out"});
}

TEST_CASE(DiscoveryReturnsCandidatesInRegistryOrderAndUsesEndpointOnce) {
    const std::vector<synth::ControllerWizardDescriptor> registry = {
        Descriptor("wizard.alpha", "Alpha", synth::MidiProfileKind::Generic, {"Alpha"},
                   {"Alpha"}),
        Descriptor("wizard.beta", "Beta", synth::MidiProfileKind::Launchpad, {"Beta"},
                   {"Beta"}),
        Descriptor("wizard.alpha-shadow", "Alpha Shadow", synth::MidiProfileKind::WrldBldr,
                   {"Alpha"}, {"Alpha"})};
    const synth::MidiDeviceList devices = Devices(
        {Device("beta-in", "Beta"), Device("alpha-in", "Alpha")},
        {Device("beta-out", "Beta"), Device("alpha-out", "Alpha")});

    const synth::WizardDiscovery discovery =
        synth::DiscoverControllerWizards(devices, synth::MidiInstrumentConfig{}, registry);

    REQUIRE_TRUE(discovery.available.size() == 2);
    RequireCandidate(discovery.available[0], "wizard.alpha", "Alpha",
                     synth::MidiProfileKind::Generic, "alpha-in", "alpha-out");
    RequireCandidate(discovery.available[1], "wizard.beta", "Beta",
                     synth::MidiProfileKind::Launchpad, "beta-in", "beta-out");
    REQUIRE_TRUE(discovery.unmatchedInputs.empty());
    REQUIRE_TRUE(discovery.unmatchedOutputs.empty());
}

TEST_CASE(DiscoveryPairsDuplicateDevicesByEnumerationOrder) {
    const synth::MidiDeviceList devices = Devices(
        {Device("in-1", "Midi Fighter Twister"), Device("in-2", "Midi Fighter Twister")},
        {Device("out-1", "Midi Fighter Twister"), Device("out-2", "Midi Fighter Twister")});

    const synth::WizardDiscovery discovery =
        synth::DiscoverControllerWizards(devices, synth::MidiInstrumentConfig{},
                                         TestTwisterRegistry());

    REQUIRE_TRUE(discovery.available.size() == 2);
    RequireCandidate(discovery.available[0], "com.sheaf.midi-fighter-twister",
                     "MIDI Fighter Twister", synth::MidiProfileKind::MfTwister, "in-1", "out-1");
    RequireCandidate(discovery.available[1], "com.sheaf.midi-fighter-twister",
                     "MIDI Fighter Twister", synth::MidiProfileKind::MfTwister, "in-2", "out-2");
}

TEST_CASE(DiscoveryClaimsStoredEndpointsByExactIdBeforeNameFallback) {
    const synth::MidiDeviceList devices = Devices(
        {Device("in-name-only", "Midi Fighter Twister"),
         Device("in-exact", "Midi Fighter Twister")},
        {Device("out-name-fallback", "Midi Fighter Twister"),
         Device("out-free", "Midi Fighter Twister")});
    synth::MidiInstrumentConfig instrument;
    instrument.controllers.push_back(StoredController(
        "claimed", Endpoint("in-exact", "Midi Fighter Twister"),
        Endpoint("missing-output-id", "Midi Fighter Twister")));

    const synth::WizardDiscovery discovery =
        synth::DiscoverControllerWizards(devices, instrument, TestTwisterRegistry());

    REQUIRE_TRUE(discovery.available.size() == 1);
    RequireCandidate(discovery.available[0], "com.sheaf.midi-fighter-twister",
                     "MIDI Fighter Twister", synth::MidiProfileKind::MfTwister,
                     "in-name-only", "out-free");
}

TEST_CASE(DiscoveryDoesNotFallbackByNameWhenExactIdLostContention) {
    const synth::MidiDeviceList devices = Devices(
        {Device("in-1", "Midi Fighter Twister"), Device("in-2", "Midi Fighter Twister")},
        {Device("out-1", "Midi Fighter Twister"), Device("out-2", "Midi Fighter Twister")});
    synth::MidiInstrumentConfig instrument;
    instrument.controllers.push_back(StoredController(
        "first", Endpoint("missing-input-id", "Midi Fighter Twister"),
        Endpoint("missing-output-id", "Midi Fighter Twister")));
    instrument.controllers.push_back(StoredController(
        "second", Endpoint("in-1", "Midi Fighter Twister"),
        Endpoint("out-1", "Midi Fighter Twister")));

    const synth::WizardDiscovery discovery =
        synth::DiscoverControllerWizards(devices, instrument, TestTwisterRegistry());

    REQUIRE_TRUE(discovery.available.size() == 1);
    RequireCandidate(discovery.available[0], "com.sheaf.midi-fighter-twister",
                     "MIDI Fighter Twister", synth::MidiProfileKind::MfTwister,
                     "in-2", "out-2");
}

TEST_CASE(DiscoveryTreatsHalfConfiguredStoredRefsAsEndpointClaims) {
    const synth::MidiDeviceList devices = Devices(
        {Device("in-claimed", "Midi Fighter Twister"),
         Device("in-free", "Midi Fighter Twister")},
        {Device("out-free-a", "Midi Fighter Twister"),
         Device("out-free-b", "Midi Fighter Twister")});
    synth::MidiInstrumentConfig instrument;
    instrument.controllers.push_back(
        StoredController("input-only", Endpoint("in-claimed", "Midi Fighter Twister"), {}));

    const synth::WizardDiscovery discovery =
        synth::DiscoverControllerWizards(devices, instrument, TestTwisterRegistry());

    REQUIRE_TRUE(discovery.available.size() == 1);
    RequireCandidate(discovery.available[0], "com.sheaf.midi-fighter-twister",
                     "MIDI Fighter Twister", synth::MidiProfileKind::MfTwister,
                     "in-free", "out-free-a");
    RequireDeviceIds(discovery.unmatchedOutputs, {"out-free-b"});
}

TEST_CASE(DiscoverySuppressesPairsClaimedByActiveAndBlacklistedRecords) {
    const synth::MidiDeviceList devices = Devices(
        {Device("active-in", "Midi Fighter Twister"),
         Device("blacklisted-in", "Midi Fighter Twister"),
         Device("free-in", "Midi Fighter Twister")},
        {Device("active-out", "Midi Fighter Twister"),
         Device("blacklisted-out", "Midi Fighter Twister"),
         Device("free-out", "Midi Fighter Twister")});
    synth::MidiInstrumentConfig instrument;
    instrument.controllers.push_back(
        StoredController("active", Endpoint("active-in", "Midi Fighter Twister"),
                         Endpoint("active-out", "Midi Fighter Twister")));
    synth::MidiControllerSlot blacklisted =
        StoredController("blacklisted", Endpoint("blacklisted-in", "Midi Fighter Twister"),
                         Endpoint("blacklisted-out", "Midi Fighter Twister"));
    blacklisted.disposition = synth::MidiControllerDisposition::Blacklisted;
    blacklisted.wizardId = "future.vendor/unknown";
    instrument.controllers.push_back(std::move(blacklisted));

    const synth::WizardDiscovery discovery =
        synth::DiscoverControllerWizards(devices, instrument, TestTwisterRegistry());

    REQUIRE_TRUE(discovery.available.size() == 1);
    RequireCandidate(discovery.available[0], "com.sheaf.midi-fighter-twister",
                     "MIDI Fighter Twister", synth::MidiProfileKind::MfTwister, "free-in", "free-out");
    REQUIRE_TRUE(discovery.unmatchedInputs.empty());
    REQUIRE_TRUE(discovery.unmatchedOutputs.empty());
}

TEST_CASE(DiscoveryResultsAreStableAndInputsRemainUnchanged) {
    const synth::MidiDeviceList devices = Devices(
        {Device("in-1", "Midi Fighter Twister"), Device("in-2", "Keyboard")},
        {Device("out-1", "Midi Fighter Twister"), Device("out-2", "Drum Rack")});
    synth::MidiInstrumentConfig instrument;
    instrument.controllers.push_back(StoredController(
        "manual", Endpoint("missing", "Missing Device"), Endpoint("", "")));

    const synth::WizardDiscovery first =
        synth::DiscoverControllerWizards(devices, instrument, TestTwisterRegistry());
    const synth::WizardDiscovery second =
        synth::DiscoverControllerWizards(devices, instrument, TestTwisterRegistry());

    REQUIRE_TRUE(first.available.size() == second.available.size());
    REQUIRE_TRUE(first.unmatchedInputs == second.unmatchedInputs);
    REQUIRE_TRUE(first.unmatchedOutputs == second.unmatchedOutputs);
    REQUIRE_TRUE(first.available.size() == 1);
    RequireCandidate(first.available[0], second.available[0].wizardId,
                     second.available[0].displayName, second.available[0].kind,
                     second.available[0].input.identifier, second.available[0].output.identifier);
    REQUIRE_TRUE(devices.inputs[0].identifier == "in-1");
    REQUIRE_TRUE(instrument.controllers[0].input.identifier == "missing");
}

int Main() {
    int failed = 0;
    for (const TestCase& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& error) {
            ++failed;
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << "\n";
        }
    }
    return failed == 0 ? 0 : 1;
}

}  // namespace

int main() {
    return Main();
}
