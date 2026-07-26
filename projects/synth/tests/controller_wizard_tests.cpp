#include "synth/ControllerWizard.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "controller wizard contracts must not see JUCE headers"
#endif

#include <iostream>
#include <memory>
#include <stdexcept>
#include <string>
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
