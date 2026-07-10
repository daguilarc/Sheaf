#include "synth/browser/BrowserAudioDevices.hpp"
#include "synth/browser/BrowserMidiBridge.hpp"
#include "synth/browser/BrowserRuntimeMainServices.hpp"

#include <filesystem>
#include <stdexcept>
#include <string>
#include <utility>

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

void TestBrowserRejectsNamedOutputSelection()
{
    bool rejected = false;
    try
    {
        (void)synth_browser::BrowserOutputDeviceName("named-output");
    }
    catch (const std::invalid_argument&)
    {
        rejected = true;
    }
    Require(rejected, "browser rejects named output selection");
}

class ServiceSurface final : public synth::ui::Surface
{
public:
    synth::ui::NodeTree BuildTree() override
    {
        synth::ui::Node root;
        root.id = "service.contract.root";
        root.kind = synth::ui::NodeKind::Root;
        root.bounds = {0.0f, 0.0f, 320.0f, 240.0f};
        return synth::ui::NodeTree{{std::move(root)}};
    }

    void SetActionHandler(ActionHandler handler) override
    {
        handler_ = std::move(handler);
    }

    void DispatchAction(const synth::ui::Action& action) override
    {
        if (handler_)
        {
            handler_(action);
        }
    }

private:
    ActionHandler handler_;
};

class ServiceApp
{
public:
    static synth::RuntimeConfig Config()
    {
        return synth::RuntimeConfig{
            .appName = "BrowserServicesContract",
            .uiWidth = 320,
            .uiHeight = 240,
        };
    }

    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
    synth::ui::Surface& PortableSurface() { return surface_; }

private:
    ServiceSurface surface_;
};

void TestBrowserServicesExposeNegotiatedDefaultAudio()
{
    synth::Engine<ServiceApp> engine([] { return std::uint64_t{0}; });
    synth_browser::BrowserMidiBridge<synth::Engine<ServiceApp>> midiBridge(engine);
    synth_browser::BrowserRuntimeMainServices<ServiceApp> services(engine, midiBridge);

    synth::AudioDeviceState persisted;
    persisted.outputDeviceName = "previous-device";
    engine.SetAudioDeviceFromHost(persisted);

    synth::runtime_ui::AudioPageSnapshot snapshot;
    services.RefreshAudio(snapshot);
    Require(snapshot.deviceLineText == "No audio device",
            "browser reports no negotiated audio before prepare");

    services.RecordAudioNegotiation(48000.0, 128);
    services.RefreshAudio(snapshot);
    Require(snapshot.outputOptions.size() == 1, "services retain one output choice");
    Require(snapshot.selectedOutputId == "system_default", "services select system default");
    Require(snapshot.deviceLineText == "System Default: 48000 Hz, 128 frames",
            "services report negotiated browser audio");
    Require(services.DeadlineSamplePercent() == 0.0f,
            "browser deadline sample remains explicitly unavailable");

    services.DispatchAudio(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kAudioOutputSelect,
        "system_default"));
    Require(engine.AudioDeviceSnapshot().outputDeviceName.empty(),
            "services persist system default as empty output name");
}

}  // namespace

int main()
{
    TestBrowserExposesOnlySystemDefaultOutput();
    TestBrowserDefaultSelectionPersistsAsEmptyName();
    TestBrowserRejectsNamedOutputSelection();
    TestBrowserServicesExposeNegotiatedDefaultAudio();
    return 0;
}
