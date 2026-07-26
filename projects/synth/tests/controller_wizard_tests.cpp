#include "synth/ControllerWizard.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "controller wizard contracts must not see JUCE headers"
#endif

#include <iostream>
#include <initializer_list>
#include <limits>
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

const synth::ui::Node* FindNodeById(const synth::ui::NodeTree& tree, std::string_view id) {
    for (const synth::ui::Node& node : tree.nodes) {
        if (node.id.value == id) {
            return &node;
        }
    }
    return nullptr;
}

std::vector<const synth::ui::Node*> NodesOfKind(const synth::ui::NodeTree& tree,
                                                synth::ui::NodeKind kind) {
    std::vector<const synth::ui::Node*> result;
    for (const synth::ui::Node& node : tree.nodes) {
        if (node.kind == kind) {
            result.push_back(&node);
        }
    }
    return result;
}

TEST_CASE(MfTwisterConfigFormBuildsClosedSixButtonSurfaceAndRoutesPortableActions) {
    synth::MfTwisterConfigForm form;
    const synth::ui::NodeTree initialTree = form.BuildTree();

    const synth::ui::Node* slot =
        FindNodeById(initialTree, "controller-wizard.twister.encoder-slot");
    REQUIRE_TRUE(slot != nullptr);
    REQUIRE_TRUE(slot->kind == synth::ui::NodeKind::TextField);
    REQUIRE_TRUE(slot->text == "0");

    const std::vector<const synth::ui::Node*> combos =
        NodesOfKind(initialTree, synth::ui::NodeKind::ComboBox);
    const std::vector<const synth::ui::Node*> arguments =
        NodesOfKind(initialTree, synth::ui::NodeKind::TextField);
    REQUIRE_TRUE(combos.size() == synth::MfTwisterConfigForm::kButtonCount);
    REQUIRE_TRUE(arguments.size() == synth::MfTwisterConfigForm::kButtonCount + 1);
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.button.0.message") != nullptr);
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.button.5.message") != nullptr);
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.button.0.argument") != nullptr);
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.button.5.argument") != nullptr);
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.column.0")->label ==
                 "Left (CC 8-10)");
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.column.1")->label ==
                 "Right (CC 11-13)");
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.column.0")->children.size() == 3);
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.column.1")->children.size() == 3);
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.column.0")->children[0].value ==
                 "controller-wizard.twister.button.0");
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.column.0")->children[2].value ==
                 "controller-wizard.twister.button.2");
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.column.1")->children[0].value ==
                 "controller-wizard.twister.button.3");
    REQUIRE_TRUE(FindNodeById(initialTree, "controller-wizard.twister.column.1")->children[2].value ==
                 "controller-wizard.twister.button.5");

    const std::vector<std::string> expectedLabels = {
        "Toggle Reset", "Hold Reset", "Toggle Random", "Hold Random",
        "Toggle Random Mod", "Hold Random Mod", "Toggle Gesture Select",
        "Hold Gesture Select", "Bank Select", "Next Bank", "Previous Bank",
        "Start", "Continue", "Stop", "Clock", "Scene Select"};
    REQUIRE_TRUE(combos.front()->options.size() == expectedLabels.size());
    for (std::size_t ix = 0; ix < expectedLabels.size(); ++ix) {
        REQUIRE_TRUE(combos.front()->options[ix].label == expectedLabels[ix]);
    }
    REQUIRE_TRUE(combos.front()->selectedOption == "hold-reset");
    REQUIRE_TRUE(combos[1]->selectedOption == "hold-random");
    REQUIRE_TRUE(combos[2]->selectedOption == "hold-random-mod");
    REQUIRE_TRUE(combos[3]->selectedOption == "next-bank");
    REQUIRE_TRUE(combos[4]->selectedOption == "start");
    REQUIRE_TRUE(combos[5]->selectedOption == "previous-bank");
    REQUIRE_TRUE(!FindNodeById(initialTree, "controller-wizard.twister.button.3.argument")->enabled);

    form.DispatchAction(synth::ui::Action::WithValue(
        "controller-wizard.twister.encoder-slot", "17"));
    form.DispatchAction(synth::ui::Action::WithValue(
        "controller-wizard.twister.button.3.message", "scene-select"));
    form.DispatchAction(synth::ui::Action::WithValue(
        "controller-wizard.twister.button.3.argument", "6"));
    const synth::ui::NodeTree editedTree = form.BuildTree();
    REQUIRE_TRUE(FindNodeById(editedTree, "controller-wizard.twister.encoder-slot")->text == "17");
    REQUIRE_TRUE(FindNodeById(editedTree, "controller-wizard.twister.button.3.message")->selectedOption ==
                 "scene-select");
    REQUIRE_TRUE(FindNodeById(editedTree, "controller-wizard.twister.button.3.argument")->enabled);
    REQUIRE_TRUE(FindNodeById(editedTree, "controller-wizard.twister.button.3.argument")->text == "6");

    const std::vector<std::pair<std::string, bool>> argumentEnabled = {
        {"toggle-reset", false}, {"hold-reset", false},
        {"toggle-random", false}, {"hold-random", false},
        {"toggle-random-mod", false}, {"hold-random-mod", false},
        {"toggle-gesture-select", true}, {"hold-gesture-select", true},
        {"bank-select", true}, {"next-bank", false}, {"previous-bank", false},
        {"start", false}, {"continue", false}, {"stop", false},
        {"clock", false}, {"scene-select", true}};
    for (const auto& [messageId, enabled] : argumentEnabled) {
        form.DispatchAction(synth::ui::Action::WithValue(
            "controller-wizard.twister.button.0.message", messageId));
        REQUIRE_TRUE(FindNodeById(form.BuildTree(), "controller-wizard.twister.button.0.argument")->enabled ==
                     enabled);
    }
}

TEST_CASE(MfTwisterConfigFormValidatesExactSizeTIntegerTextAndIgnoresDisabledArguments) {
    synth::MfTwisterConfigForm form;
    std::string error;

    form.encoderSlotText = "0";
    REQUIRE_TRUE(form.Validate(error));
    form.encoderSlotText = std::to_string(std::numeric_limits<std::size_t>::max());
    REQUIRE_TRUE(form.Validate(error));

    for (const std::string& invalid : std::vector<std::string>{
             {}, "-1", "1x", "   ", "184467440737095516160"}) {
        form.encoderSlotText = invalid;
        REQUIRE_TRUE(!form.Validate(error));
        REQUIRE_TRUE(!error.empty());
    }

    form.encoderSlotText = "0";
    form.buttons[0].message = synth::UISystemMessage::Start;
    form.buttons[0].argumentText = "not-a-number";
    REQUIRE_TRUE(form.Validate(error));
    form.buttons[0].message = synth::UISystemMessage::SceneSelect;
    REQUIRE_TRUE(!form.Validate(error));
    form.buttons[0].argumentText = std::to_string(std::numeric_limits<std::size_t>::max());
    REQUIRE_TRUE(form.Validate(error));
    for (const std::string& invalid : std::vector<std::string>{
             {}, "-1", "1x", "   ", "184467440737095516160"}) {
        form.buttons[0].argumentText = invalid;
        REQUIRE_TRUE(!form.Validate(error));
        REQUIRE_TRUE(!error.empty());
    }
    form.buttons[0].argumentText = "1x";
    const synth::ui::NodeTree invalidTree = form.BuildTree();
    REQUIRE_TRUE(FindNodeById(invalidTree, "controller-wizard.twister.button.0.argument.error") != nullptr);
    form.buttons[0].message = synth::UISystemMessage::NextParamBank;
    REQUIRE_TRUE(form.Validate(error));
    const synth::ui::NodeTree disabledTree = form.BuildTree();
    REQUIRE_TRUE(FindNodeById(disabledTree, "controller-wizard.twister.button.0.argument.error") == nullptr);

    form.buttons[0].message = synth::UISystemMessage::ParamIncDec;
    REQUIRE_TRUE(!form.Validate(error));
    REQUIRE_TRUE(!error.empty());
}

TEST_CASE(UISystemMessageHelpersExposeCatalogLabelsAndPreserveBankSlotArguments) {
    const synth::UISystemMessageChoice* holdReset =
        synth::FindUISystemMessageChoice(synth::UISystemMessage::HoldReset);
    REQUIRE_TRUE(holdReset != nullptr);
    REQUIRE_TRUE(holdReset->label == "Hold Reset");
    REQUIRE_TRUE(synth::FindUISystemMessageChoice(synth::UISystemMessage::SceneSelect) != nullptr);

    const synth::MidiControllerSystemMessageAssociation next =
        synth::MakeUISystemMessageAssociation(synth::UISystemMessage::NextParamBank, 23);
    REQUIRE_TRUE(next.press.type == synth::MessageIn::Type::NextParamBank);
    REQUIRE_TRUE(next.press.slotIx == 23);
    REQUIRE_TRUE(next.feedback.type == synth::MessageIn::Type::NextParamBank);
    REQUIRE_TRUE(next.feedback.slotIx == 23);
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
