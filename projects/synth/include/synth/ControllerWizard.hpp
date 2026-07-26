#pragma once

#include "synth/MidiController.hpp"
#include "synth/PortableUI.hpp"

#include <cassert>
#include <concepts>
#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace synth {

// Portable wizard-owned form state. Renderers only render its ui::Surface
// tree and dispatch actions back to it; all configuration policy remains here.
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

template <class Form>
class TypedControllerWizard : public ControllerWizard {
    static_assert(std::derived_from<Form, ControllerConfigForm>);

public:
    WizardGenerationResult GenerateProfile(
        const ControllerConfigForm& form, const WizardGenerationContext& context) const final {
        const auto* typedForm = dynamic_cast<const Form*>(&form);
        assert(typedForm != nullptr);
        if (typedForm == nullptr) {
            return {.error = "controller wizard form type mismatch"};
        }

        std::string error;
        if (!typedForm->Validate(error)) {
            if (error.empty()) {
                error = "controller wizard form is invalid";
            }
            return {.error = std::move(error)};
        }
        return GenerateTypedProfile(*typedForm, context);
    }

protected:
    virtual WizardGenerationResult GenerateTypedProfile(
        const Form&, const WizardGenerationContext&) const = 0;
};

}  // namespace synth
