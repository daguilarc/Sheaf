#include "synth/browser/BrowserAudioDevices.hpp"

#include <stdexcept>

namespace {

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
    }
}

void TestBrowserExposesOnlySystemDefaultOutput()
{
    const synth::AudioDeviceState state{.outputDeviceName = "Named device", .inputDeviceName = "Ignored input"};
    const synth::runtime_ui::AudioPageSnapshot snapshot = synth_browser::BuildBrowserAudioSnapshot(state);

    Require(snapshot.outputOptions.size() == 1, "one browser output option");
    Require(snapshot.outputOptions.front().id == "system_default", "system default output id");
    Require(snapshot.outputOptions.front().label == "System Default", "system default output label");
    Require(snapshot.selectedOutputId == "system_default", "system default selected");
    Require(!snapshot.showInputCombo, "browser hides input selector");
    Require(snapshot.inputOptions.empty(), "browser has no input options");
}

void TestBrowserDefaultSelectionPersistsAsEmptyName()
{
    Require(synth_browser::BrowserOutputDeviceName("system_default").empty(),
            "system default persists as empty output name");
}

}  // namespace

int main()
{
    TestBrowserExposesOnlySystemDefaultOutput();
    TestBrowserDefaultSelectionPersistsAsEmptyName();
    return 0;
}
