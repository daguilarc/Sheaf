#pragma once

#include "synth/PatchPersistence.hpp"
#include "synth/RuntimePages.hpp"

#include <stdexcept>

namespace synth_browser {

inline synth::runtime_ui::AudioPageSnapshot BuildBrowserAudioSnapshot(const synth::AudioDeviceState&)
{
    synth::runtime_ui::AudioPageSnapshot snapshot;
    snapshot.outputOptions = {{synth::runtime_ui::kSystemDefaultOptionId,
                               synth::runtime_ui::kSystemDefaultOptionLabel}};
    snapshot.selectedOutputId = synth::runtime_ui::kSystemDefaultOptionId;
    snapshot.showInputCombo = false;
    snapshot.inputOptions.clear();
    return snapshot;
}

inline std::string BrowserOutputDeviceName(const std::string& optionId)
{
    if (optionId != synth::runtime_ui::kSystemDefaultOptionId)
    {
        throw std::invalid_argument("browser audio supports only system_default output");
    }
    return {};
}

}  // namespace synth_browser
