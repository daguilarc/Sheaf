#include "synth/ControllerWizard.hpp"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <string_view>
#include <vector>

namespace synth {

// The contract is intentionally header-defined: TypedControllerWizard must be
// instantiated by each concrete portable form type.

namespace {

constexpr std::string_view kMfTwisterWizardId = "com.sheaf.midi-fighter-twister";
constexpr std::string_view kMfTwisterDisplayName = "MIDI Fighter Twister";
constexpr std::string_view kMfTwisterAlias = "Midi Fighter Twister";

bool CaseInsensitiveEquals(std::string_view lhs, std::string_view rhs) {
    if (lhs.size() != rhs.size()) {
        return false;
    }
    for (std::size_t ix = 0; ix < lhs.size(); ++ix) {
        const auto left = static_cast<unsigned char>(lhs[ix]);
        const auto right = static_cast<unsigned char>(rhs[ix]);
        if (std::tolower(left) != std::tolower(right)) {
            return false;
        }
    }
    return true;
}

bool MatchesAnyAlias(std::string_view name, const std::vector<std::string>& aliases) {
    return std::any_of(aliases.begin(), aliases.end(), [name](const std::string& alias) {
        return CaseInsensitiveEquals(name, alias);
    });
}

void ClaimEndpoint(const MidiEndpointRef& ref,
                   const std::vector<MidiDeviceInfoRef>& devices,
                   std::vector<bool>& claimed) {
    if (!ref.IsConfigured()) {
        return;
    }

    if (!ref.identifier.empty()) {
        for (std::size_t ix = 0; ix < devices.size(); ++ix) {
            if (devices[ix].identifier == ref.identifier) {
                if (!claimed[ix]) {
                    claimed[ix] = true;
                }
                return;
            }
        }
    }

    if (!ref.name.empty()) {
        for (std::size_t ix = 0; ix < devices.size(); ++ix) {
            if (!claimed[ix] && devices[ix].name == ref.name) {
                claimed[ix] = true;
                return;
            }
        }
    }
}

std::vector<bool> ClaimedInputs(const MidiDeviceList& devices,
                                const MidiInstrumentConfig& instrument) {
    std::vector<bool> claimed(devices.inputs.size(), false);
    for (const MidiControllerSlot& slot : instrument.controllers) {
        ClaimEndpoint(slot.input, devices.inputs, claimed);
    }
    return claimed;
}

std::vector<bool> ClaimedOutputs(const MidiDeviceList& devices,
                                 const MidiInstrumentConfig& instrument) {
    std::vector<bool> claimed(devices.outputs.size(), false);
    for (const MidiControllerSlot& slot : instrument.controllers) {
        ClaimEndpoint(slot.output, devices.outputs, claimed);
    }
    return claimed;
}

std::vector<std::size_t> MatchingUnclaimedEndpoints(
    const std::vector<MidiDeviceInfoRef>& devices,
    const std::vector<bool>& claimed,
    const std::vector<bool>& assigned,
    const std::vector<std::string>& aliases) {
    std::vector<std::size_t> matches;
    for (std::size_t ix = 0; ix < devices.size(); ++ix) {
        if (!claimed[ix] && !assigned[ix] && MatchesAnyAlias(devices[ix].name, aliases)) {
            matches.push_back(ix);
        }
    }
    return matches;
}

std::vector<MidiDeviceInfoRef> UnmatchedEndpoints(
    const std::vector<MidiDeviceInfoRef>& devices,
    const std::vector<bool>& claimed,
    const std::vector<bool>& assigned) {
    std::vector<MidiDeviceInfoRef> unmatched;
    for (std::size_t ix = 0; ix < devices.size(); ++ix) {
        if (!claimed[ix] && !assigned[ix]) {
            unmatched.push_back(devices[ix]);
        }
    }
    return unmatched;
}

}  // namespace

const std::vector<ControllerWizardDescriptor>& ControllerWizardRegistry() {
    static const std::vector<ControllerWizardDescriptor> registry = {
        ControllerWizardDescriptor{
            .id = std::string(kMfTwisterWizardId),
            .displayName = std::string(kMfTwisterDisplayName),
            .kind = MidiProfileKind::MfTwister,
            .inputAliases = {std::string(kMfTwisterAlias)},
            .outputAliases = {std::string(kMfTwisterAlias)},
            .factory = {}}};
    return registry;
}

WizardDiscovery DiscoverControllerWizards(
    const MidiDeviceList& devices, const MidiInstrumentConfig& instrument,
    const std::vector<ControllerWizardDescriptor>& registry) {
    WizardDiscovery discovery;
    std::vector<bool> claimedInputs = ClaimedInputs(devices, instrument);
    std::vector<bool> claimedOutputs = ClaimedOutputs(devices, instrument);
    std::vector<bool> assignedInputs(devices.inputs.size(), false);
    std::vector<bool> assignedOutputs(devices.outputs.size(), false);

    for (const ControllerWizardDescriptor& descriptor : registry) {
        std::vector<std::size_t> inputMatches = MatchingUnclaimedEndpoints(
            devices.inputs, claimedInputs, assignedInputs, descriptor.inputAliases);
        std::vector<std::size_t> outputMatches = MatchingUnclaimedEndpoints(
            devices.outputs, claimedOutputs, assignedOutputs, descriptor.outputAliases);
        const std::size_t pairCount = std::min(inputMatches.size(), outputMatches.size());

        for (std::size_t pairIx = 0; pairIx < pairCount; ++pairIx) {
            const std::size_t inputIx = inputMatches[pairIx];
            const std::size_t outputIx = outputMatches[pairIx];
            assignedInputs[inputIx] = true;
            assignedOutputs[outputIx] = true;
            discovery.available.push_back({
                .wizardId = descriptor.id,
                .displayName = descriptor.displayName,
                .kind = descriptor.kind,
                .input = devices.inputs[inputIx],
                .output = devices.outputs[outputIx],
            });
        }
    }

    discovery.unmatchedInputs =
        UnmatchedEndpoints(devices.inputs, claimedInputs, assignedInputs);
    discovery.unmatchedOutputs =
        UnmatchedEndpoints(devices.outputs, claimedOutputs, assignedOutputs);
    return discovery;
}

std::unique_ptr<ControllerWizard> MakeControllerWizard(std::string_view id) {
    const std::vector<ControllerWizardDescriptor>& registry = ControllerWizardRegistry();
    for (const ControllerWizardDescriptor& descriptor : registry) {
        if (descriptor.id == id) {
            if (!descriptor.factory) {
                return nullptr;
            }
            return descriptor.factory();
        }
    }
    return nullptr;
}

}  // namespace synth
