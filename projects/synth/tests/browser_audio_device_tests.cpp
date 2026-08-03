#include "synth/browser/BrowserAudioDevices.hpp"
#include "synth/browser/BrowserMidiBridge.hpp"
#include "synth/browser/BrowserRuntimeMainServices.hpp"

#include <algorithm>
#include <cstddef>
#include <filesystem>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
    }
}

using synth_browser::BrowserAudioInputState;
using synth_browser::BrowserAudioInputStatus;

BrowserAudioInputState InputState(std::size_t requested,
                                  std::size_t active,
                                  BrowserAudioInputStatus status)
{
    return BrowserAudioInputState{
        .requestedChannels = requested, .activeChannels = active, .status = status};
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
    Require(!snapshot.showInputRetry, "browser hides retry for a zero-input application");
    Require(snapshot.statusLineText.empty(), "a zero-input application claims no input status");
}

void TestInputCapableBrowserExposesOneSystemDefaultInput()
{
    const synth::AudioDeviceState state{.outputDeviceName = {}, .inputDeviceName = "Stale Named Input"};
    const synth::runtime_ui::AudioPageSnapshot snapshot = synth_browser::BuildBrowserAudioSnapshot(
        state, InputState(4, 4, BrowserAudioInputStatus::Online));

    Require(snapshot.showInputCombo, "an input-capable browser application shows the input selector");
    Require(snapshot.inputOptions.size() == 1, "one browser input option");
    Require(snapshot.inputOptions.front().id == "system_default", "system default input id");
    Require(snapshot.inputOptions.front().label == "System Default", "system default input label");
    Require(snapshot.selectedInputId == "system_default",
            "a stale persisted input name still selects System Default");
    Require(snapshot.statusLineText == "Input requested 4 / active 4",
            "online capture reports the requested and active counts alone");
    Require(!snapshot.showInputRetry, "online capture hides Retry Input");
}

void TestBrowserInputDefaultSelectionPersistsAsEmptyName()
{
    Require(synth_browser::BrowserInputDeviceName("system_default").empty(),
            "system default persists as empty input name");
}

void TestBrowserRejectsNamedInputSelection()
{
    bool rejected = false;
    try
    {
        (void)synth_browser::BrowserInputDeviceName("named-input");
    }
    catch (const std::invalid_argument&)
    {
        rejected = true;
    }
    Require(rejected, "browser rejects named input selection");
}

void TestBrowserInputStatesAreDistinctAndRetryableOnlyWhileOffline()
{
    struct Expectation
    {
        BrowserAudioInputState input;
        std::string statusLineText;
        bool showInputRetry;
    };

    const std::vector<Expectation> expectations{
        {InputState(4, 0, BrowserAudioInputStatus::NotRequested),
         "Input requested 4 / active 0 - microphone capture not started",
         true},
        {InputState(4, 0, BrowserAudioInputStatus::Requesting),
         "Input requested 4 / active 0 - requesting microphone access",
         false},
        {InputState(4, 0, BrowserAudioInputStatus::PermissionDenied),
         "Input requested 4 / active 0 - microphone permission denied",
         true},
        {InputState(4, 0, BrowserAudioInputStatus::ApiUnavailable),
         "Input requested 4 / active 0 - microphone capture unavailable",
         true},
        {InputState(4, 0, BrowserAudioInputStatus::PrerequisiteBlocked),
         "Input requested 4 / active 0 - microphone prerequisite unavailable",
         true},
        {InputState(4, 0, BrowserAudioInputStatus::InsecureContext),
         "Input requested 4 / active 0 - microphone requires a secure context",
         true},
        {InputState(4, 0, BrowserAudioInputStatus::PermissionsPolicyBlocked),
         "Input requested 4 / active 0 - microphone blocked by permissions policy",
         true},
        {InputState(4, 0, BrowserAudioInputStatus::AudioContextUnavailable),
         "Input requested 4 / active 0 - microphone requires the launch-owned AudioContext",
         true},
        {InputState(4, 0, BrowserAudioInputStatus::StreamEnded),
         "Input requested 4 / active 0 - microphone stream ended",
         true},
        {InputState(4, 1, BrowserAudioInputStatus::ChannelCountUnreported),
         "Input requested 4 / active 1 - microphone channel count unreported, input channel shortfall",
         false},
        {InputState(4, 4, BrowserAudioInputStatus::ChannelCountUnreported),
         "Input requested 4 / active 4 - microphone channel count unreported",
         false},
        {InputState(4, 2, BrowserAudioInputStatus::Online),
         "Input requested 4 / active 2 - input channel shortfall",
         false},
    };

    std::vector<std::string> seen;
    for (const Expectation& expectation : expectations)
    {
        const synth::runtime_ui::AudioPageSnapshot snapshot =
            synth_browser::BuildBrowserAudioSnapshot({}, expectation.input);
        Require(snapshot.statusLineText == expectation.statusLineText,
                "browser input status text matches the published capture state");
        Require(snapshot.showInputRetry == expectation.showInputRetry,
                "Retry Input is offered exactly while capture is offline");
        Require(snapshot.showInputCombo, "every input-capable state keeps the input selector");
        seen.push_back(snapshot.statusLineText);
    }
    std::sort(seen.begin(), seen.end());
    Require(std::adjacent_find(seen.begin(), seen.end()) == seen.end(),
            "each browser capture state reads differently");
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

// Regression: the services layer composes its own status line, so a zero-input
// application must not pick up the "capture not started" detail that an
// input-capable application in the same state would show.
void TestZeroInputServicesPublishNoInputStatus()
{
    synth::Engine<ServiceApp> engine([] { return std::uint64_t{0}; });
    synth_browser::BrowserMidiBridge<synth::Engine<ServiceApp>> midiBridge(engine);
    synth_browser::BrowserRuntimeMainServices<ServiceApp> services(
        engine, midiBridge, {}, [] { return InputState(0, 0, BrowserAudioInputStatus::NotRequested); });

    synth::runtime_ui::AudioPageSnapshot snapshot;
    services.RefreshAudio(snapshot);
    Require(snapshot.statusLineText.empty(),
            "a zero-input application publishes no input status through services");
    Require(!snapshot.showInputCombo, "services hide the input selector for a zero-input app");
    Require(!snapshot.showInputRetry, "services hide Retry Input for a zero-input app");

    services.DispatchAudio(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kAudioOutputSelect,
        "system_default"));
    services.RefreshAudio(snapshot);
    Require(snapshot.statusLineText == "Using System Default",
            "a zero-input application still shows its output selection acknowledgement");
}

void TestBrowserServicesPublishCaptureStatusAndUserRetry()
{
    synth::Engine<ServiceApp> engine([] { return std::uint64_t{0}; });
    synth_browser::BrowserMidiBridge<synth::Engine<ServiceApp>> midiBridge(engine);
    BrowserAudioInputState published = InputState(4, 4, BrowserAudioInputStatus::Online);
    synth_browser::BrowserRuntimeMainServices<ServiceApp> services(
        engine, midiBridge, {}, [&published] { return published; });

    synth::AudioDeviceState persisted;
    persisted.inputDeviceName = "previous-input";
    engine.SetAudioDeviceFromHost(persisted);

    synth::runtime_ui::AudioPageSnapshot snapshot;
    services.RefreshAudio(snapshot);
    Require(snapshot.showInputCombo, "services expose the input selector for an input-capable app");
    Require(snapshot.statusLineText == "Input requested 4 / active 4",
            "services report the live capture counts");

    services.DispatchAudio(synth::ui::Action::WithValue(
        synth::runtime_ui::Actions::kAudioInputSelect,
        "system_default"));
    Require(engine.AudioDeviceSnapshot().inputDeviceName.empty(),
            "services persist system default as empty input name");
    services.RefreshAudio(snapshot);
    Require(snapshot.statusLineText == "Input requested 4 / active 4 - Using System Default",
            "a selection acknowledgement follows the requested and active counts");

    bool rejected = false;
    try
    {
        services.DispatchAudio(synth::ui::Action::WithValue(
            synth::runtime_ui::Actions::kAudioInputSelect,
            "named-input"));
    }
    catch (const std::invalid_argument&)
    {
        rejected = true;
    }
    Require(rejected, "services reject a named browser input option id");

    published = InputState(4, 0, BrowserAudioInputStatus::PermissionDenied);
    services.RefreshAudio(snapshot);
    Require(snapshot.statusLineText == "Input requested 4 / active 0 - microphone permission denied",
            "a capture diagnostic displaces the stale selection acknowledgement");
    Require(snapshot.showInputRetry, "denied capture offers Retry Input");

    Require(!services.ConsumeAudioInputRetry(), "no retry is pending before the user asks for one");
    services.DispatchAudio(synth::ui::Action::Named(synth::runtime_ui::Actions::kAudioInputRetry));
    Require(services.ConsumeAudioInputRetry(), "the Retry Input action arms exactly one retry");
    Require(!services.ConsumeAudioInputRetry(), "a consumed retry does not repeat itself");
}

}  // namespace

int main()
{
    TestBrowserExposesOnlySystemDefaultOutput();
    TestBrowserDefaultSelectionPersistsAsEmptyName();
    TestBrowserRejectsNamedOutputSelection();
    TestInputCapableBrowserExposesOneSystemDefaultInput();
    TestBrowserInputDefaultSelectionPersistsAsEmptyName();
    TestBrowserRejectsNamedInputSelection();
    TestBrowserInputStatesAreDistinctAndRetryableOnlyWhileOffline();
    TestBrowserServicesExposeNegotiatedDefaultAudio();
    TestZeroInputServicesPublishNoInputStatus();
    TestBrowserServicesPublishCaptureStatusAndUserRetry();
    return 0;
}
