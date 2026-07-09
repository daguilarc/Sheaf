#pragma once

#include "synth/PatchPersistence.hpp"
#include "synth/RuntimePages.hpp"

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
    return synth::runtime_ui::Layout::DeviceNameFromOptionId(optionId);
}

}  // namespace synth_browser
