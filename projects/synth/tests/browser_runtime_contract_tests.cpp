#include "synth/AppConcepts.hpp"
#include "synth/AppContext.hpp"
#include "synth/Engine.hpp"
#include "synth/PortableUI.hpp"
#include "synth/PortableUIBuilders.hpp"
#include "synth/browser/BrowserAppEntry.hpp"
#include "synth/browser/BrowserCommandBuffer.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "browser runtime contract tests must not see JUCE"
#endif

#include <filesystem>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

extern "C" synth_browser::RuntimeAbi* synth_browser_create_runtime()
{
    return nullptr;
}

namespace {

void Require(bool condition, const char* label)
{
    if (!condition)
    {
        throw std::runtime_error(label);
    }
}

const synth_browser::DecodedNode* FindNode(
    const synth_browser::DecodedCommandBuffer& frame,
    const char* id)
{
    for (const synth_browser::DecodedNode& node : frame.nodes)
    {
        if (node.id == id)
        {
            return &node;
        }
    }
    return nullptr;
}

bool HasOption(const synth_browser::DecodedNode& node, const char* id, const char* label)
{
    for (const synth_browser::DecodedOption& option : node.options)
    {
        if (option.id == id && option.label == label)
        {
            return true;
        }
    }
    return false;
}

std::size_t JsonFileCount(const std::filesystem::path& directory)
{
    std::error_code ec;
    if (!std::filesystem::is_directory(directory, ec) || ec)
    {
        return 0;
    }

    std::size_t count = 0;
    for (const std::filesystem::directory_entry& entry :
         std::filesystem::directory_iterator(directory))
    {
        if (entry.is_regular_file() && entry.path().extension() == ".json")
        {
            ++count;
        }
    }
    return count;
}

class ContractSurface final : public synth::ui::Surface
{
public:
    synth::ui::NodeTree BuildTree() override
    {
        synth::ui::Builder builder;
        builder.Root("contract.app.root", {0.0f, 0.0f, 640.0f, 480.0f})
            .Button("contract.app.button",
                    "Apply",
                    synth::ui::Action::Named("contract.app.apply"));
        return builder.Build();
    }

    void SetActionHandler(ActionHandler handler) override
    {
        handler_ = std::move(handler);
    }

    void DispatchAction(const synth::ui::Action& action) override
    {
        ++dispatchCount;
        lastAction = action.name;
        lastValue = action.value;
        if (handler_)
        {
            handler_(action);
        }
    }

    int dispatchCount = 0;
    std::string lastAction;
    std::string lastValue;

private:
    ActionHandler handler_;
};

class ValidApp
{
public:
    static synth::RuntimeConfig Config()
    {
        return synth::RuntimeConfig{
            .appName = "BrowserContractApp",
            .uiWidth = 640,
            .uiHeight = 480,
        };
    }

    void Init(synth::AppContext* context)
    {
        auto& group = context->parameterManager->CreateGroup({
            .numVoices = 1,
            .numModulators = 0,
            .numScenes = 1,
            .maxParameters = 1,
            .processLiteAlpha = 1.0f,
        });
        probeId = context->parameterManager
                      ->CreateParameter(group, {.name = "Probe", .defaultValue = 0.25f})
                      .Id();

        context->instrument->controllers = {
            synth::MidiControllerSlot{
                .name = "Controller A",
                .kind = synth::MidiProfileKind::Generic,
                .input = {.identifier = "in-a", .name = "Input A"},
                .output = {.identifier = "out-a", .name = "Output A"},
            },
            synth::MidiControllerSlot{
                .name = "Controller B",
                .kind = synth::MidiProfileKind::Generic,
                .input = {.identifier = "in-b", .name = "Input B"},
                .output = {.identifier = "out-b", .name = "Output B"},
            },
        };
    }
    void ProcessBlock(synth::AudioBlock&) {}
    void PrepareToPlay(double sampleRate, int blockSize)
    {
        preparedSampleRate = sampleRate;
        preparedBlockSize = blockSize;
    }
    synth::ui::Surface& PortableSurface() { return surface; }

    ContractSurface surface;
    synth::ParameterId probeId = 0;
    double preparedSampleRate = 0.0;
    int preparedBlockSize = 0;
};

class MissingSurface
{
public:
    static synth::RuntimeConfig Config() { return {}; }
    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
};

class RuntimeFixture
{
public:
    RuntimeFixture()
    {
        std::filesystem::remove_all(dataRoot_);
        std::filesystem::create_directories(paths_.patchesRoot);
        std::filesystem::create_directories(paths_.logsRoot);
        runtime.SetRuntimeDataPaths(paths_);
        runtime.Start();
        runtime.MessageTick(1);
    }

    ~RuntimeFixture()
    {
        runtime.Stop();
        std::filesystem::remove_all(dataRoot_);
    }

    synth_browser::DecodedCommandBuffer Frame()
    {
        const synth_browser::CommandBuffer buffer = runtime.BuildUiFrame();
        return synth_browser::DecodeCommandBuffer(buffer.bytes);
    }

    void Prepare(double sampleRate = 48000.0, std::size_t blockSize = 128)
    {
        runtime.Prepare(sampleRate, blockSize);
    }

    void PumpOnce()
    {
        runtime.Process(nullptr, 0, 64, nextTimestamp_++);
        runtime.MessageTick(nextTimestamp_++);
    }

    void PumpUntilJsonCount(const std::filesystem::path& patchDirectory,
                            std::size_t expectedCount)
    {
        for (int iteration = 0; iteration < 16 && JsonFileCount(patchDirectory) < expectedCount;
             ++iteration)
        {
            PumpOnce();
        }
        Require(JsonFileCount(patchDirectory) == expectedCount,
                "browser patch command reaches expected version count");
    }

    float ProbeCenter()
    {
        return runtime.Engine().Manager()
            .ParameterById(runtime.Engine().Application().probeId)
            .SceneCenter(0);
    }

    void SetProbeCenter(float value)
    {
        runtime.Engine().Manager()
            .ParameterById(runtime.Engine().Application().probeId)
            .SceneCenter(0) = value;
    }

    const synth::RuntimeDataPaths& Paths() const { return paths_; }

    synth_browser::Runtime<ValidApp> runtime;

private:
    const std::filesystem::path dataRoot_ =
        std::filesystem::temp_directory_path() / "sheaf-browser-runtime-contract";
    const synth::RuntimeDataPaths paths_ = synth::RuntimeDataPaths::FromDataRoot(dataRoot_);
    std::uint64_t nextTimestamp_ = 2;
};

void TestBrowserRuntimeUsesSharedFrameAndActionRouting()
{
    RuntimeFixture fixture;

    synth_browser::DecodedCommandBuffer frame = fixture.Frame();
    Require(FindNode(frame, "runtime.main.root") != nullptr,
            "browser frame contains shared runtime root");
    Require(FindNode(frame, "contract.app.root") != nullptr,
            "browser frame contains application root");
    Require(FindNode(frame, "contract.app.button") != nullptr,
            "browser frame contains application content");
    Require(FindNode(frame, "runtime.sidebar.root") != nullptr,
            "browser frame contains runtime sidebar");
    Require(FindNode(frame, "runtime.sidebar.audio") != nullptr,
            "browser frame contains audio navigation");

    fixture.runtime.DispatchAction("runtime.sidebar.audio", "");
    frame = fixture.Frame();
    Require(FindNode(frame, "runtime.audio.root") != nullptr,
            "audio action displays shared audio page");
    Require(FindNode(frame, "contract.app.root") == nullptr,
            "audio page replaces application content");
    Require(FindNode(frame, "runtime.sidebar.root") != nullptr,
            "sidebar remains visible beside audio page");

    fixture.runtime.DispatchAction("runtime.audio.back", "");
    frame = fixture.Frame();
    Require(FindNode(frame, "contract.app.root") != nullptr,
            "audio back restores application content");
    Require(FindNode(frame, "runtime.audio.root") == nullptr,
            "audio page is removed after back");

    fixture.runtime.DispatchAction("contract.app.apply", "17");
    const ContractSurface& surface = fixture.runtime.Engine().Application().surface;
    Require(surface.dispatchCount == 1, "application action dispatches exactly once");
    Require(surface.lastAction == "contract.app.apply", "application receives action name");
    Require(surface.lastValue == "17", "application receives action value");
}

void TestBrowserPrepareFeedsNegotiatedAudioPageAndRejectsOversizedBlocks()
{
    RuntimeFixture fixture;

    bool rejected = false;
    try
    {
        fixture.runtime.Prepare(
            48000.0,
            static_cast<std::size_t>(std::numeric_limits<int>::max()) + std::size_t{1});
    }
    catch (const std::out_of_range&)
    {
        rejected = true;
    }
    Require(rejected, "runtime rejects a browser block size outside the engine range");

    fixture.Prepare(48000.0, 128);
    fixture.runtime.MessageTick(2);
    const ValidApp& app = fixture.runtime.Engine().Application();
    Require(app.preparedSampleRate == 48000.0, "prepare reaches the generic application");
    Require(app.preparedBlockSize == 128, "prepare preserves the negotiated block size");

    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kSidebarAudio, "");
    const synth_browser::DecodedCommandBuffer frame = fixture.Frame();
    const synth_browser::DecodedNode* deviceLine =
        FindNode(frame, synth::runtime_ui::NodeIds::kAudioDeviceLine);
    Require(deviceLine != nullptr, "audio page exposes negotiated device line");
    Require(deviceLine->text == "System Default: 48000 Hz, 128 frames",
            "audio page reports the negotiated default output");
}

void TestNativeBuildRejectsBrowserAudioWorkletStart()
{
    RuntimeFixture fixture;
    Require(!fixture.runtime.StartAudioWorklet(),
            "native browser runtime cannot start a WebAudio worklet");
}

void TestSharedBrowserNavigationReplacesAndRestoresEveryRuntimePage()
{
    RuntimeFixture fixture;

    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kSidebarControllers, "");
    synth_browser::DecodedCommandBuffer frame = fixture.Frame();
    Require(FindNode(frame, synth::runtime_ui::NodeIds::kRoot) != nullptr,
            "controllers navigation displays shared controllers page");
    Require(FindNode(frame, "contract.app.root") == nullptr,
            "controllers page replaces application content");

    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kBack, "");
    frame = fixture.Frame();
    Require(FindNode(frame, "contract.app.root") != nullptr,
            "controllers Back restores application content");
    Require(FindNode(frame, synth::runtime_ui::NodeIds::kRoot) == nullptr,
            "controllers page is removed after Back");

    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kSidebarFile, "");
    frame = fixture.Frame();
    Require(FindNode(frame, synth::runtime_ui::NodeIds::kFileRoot) != nullptr,
            "file navigation displays shared file page");
    Require(FindNode(frame, "contract.app.root") == nullptr,
            "file page replaces application content");

    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kFileBack, "");
    frame = fixture.Frame();
    Require(FindNode(frame, "contract.app.root") != nullptr,
            "file Back restores application content");
    Require(FindNode(frame, synth::runtime_ui::NodeIds::kFileRoot) == nullptr,
            "file page is removed after Back");
}

void TestControllersUseLatestBridgeSnapshotCommitEditsAndSaveOnBack()
{
    RuntimeFixture fixture;
    using Bridge = synth_browser::BrowserMidiBridge<synth::Engine<ValidApp>>;
    fixture.runtime.SubmitMidiEndpoints({
        {.identifier = "in-a", .name = "Input A", .kind = Bridge::EndpointKind::Input},
        {.identifier = "out-a", .name = "Output A", .kind = Bridge::EndpointKind::Output},
        {.identifier = "in-b", .name = "Input B", .kind = Bridge::EndpointKind::Input},
        {.identifier = "out-b", .name = "Output B", .kind = Bridge::EndpointKind::Output},
    });
    fixture.runtime.MessageTick(2);
    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kSidebarControllers, "");

    synth_browser::DecodedCommandBuffer frame = fixture.Frame();
    const synth_browser::DecodedNode* inputA = FindNode(
        frame, synth::runtime_ui::NodeIds::ControllerInput(0).c_str());
    const synth_browser::DecodedNode* outputB = FindNode(
        frame, synth::runtime_ui::NodeIds::ControllerOutput(1).c_str());
    Require(inputA != nullptr && outputB != nullptr,
            "controllers snapshot contains both configured controller rows");
    Require(HasOption(*inputA, "in-a", "Input A") &&
                HasOption(*inputA, "in-b", "Input B"),
            "controller input uses latest multi-device enumeration");
    Require(HasOption(*outputB, "out-a", "Output A") &&
                HasOption(*outputB, "out-b", "Output B"),
            "controller output uses latest multi-device enumeration");
    Require(inputA->selectedOption == "in-a" && outputB->selectedOption == "out-b",
            "online connection snapshot selects each configured endpoint");

    fixture.runtime.DispatchAction(
        synth::runtime_ui::Actions::kEndpointSelect, "0:input:in-b");
    fixture.runtime.MessageTick(3);
    frame = fixture.Frame();
    inputA = FindNode(frame, synth::runtime_ui::NodeIds::ControllerInput(0).c_str());
    Require(inputA != nullptr && inputA->selectedOption == "in-b",
            "controller commit is visible after services dirty refresh");
    Require(fixture.runtime.Engine().InstrumentSnapshot().controllers[0].input.identifier ==
                "in-b",
            "controller edit commits through the browser services callback");

    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kBack, "");
    Require(fixture.runtime.ConsumePersistenceDirty(),
            "controllers Back marks browser persistence dirty after saving runtime configuration");
    synth::MidiInstrumentConfig loadedInstrument;
    synth::AudioDeviceState loadedAudio;
    synth::SyncConfig loadedSync;
    Require(synth::LoadRuntimeConfigFile(
                fixture.Paths().configFile, loadedInstrument, loadedAudio, loadedSync) ==
                synth::RuntimeConfigFileStatus::Ok,
            "controllers Back persists runtime configuration");
    Require(loadedInstrument.controllers.size() == 2,
            "saved browser configuration retains every controller");
    Require(loadedInstrument.controllers[0].input.identifier == "in-b",
            "saved browser configuration contains the committed endpoint edit");
}

void TestFilePageDispatchesPatchLifecycleThroughBrowserRuntime()
{
    RuntimeFixture fixture;
    fixture.Prepare();
    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kSidebarFile, "");

    const std::filesystem::path patchA = fixture.Paths().patchesRoot / "Patch A";
    const std::filesystem::path patchB = fixture.Paths().patchesRoot / "Patch B";

    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kFileSave, "");
    fixture.PumpOnce();
    Require(!fixture.runtime.Engine().Patches().CurrentPatchDirectory().has_value(),
            "Save without a current patch preserves Save As requirement");
    Require(JsonFileCount(patchA) == 0, "Save without a current patch writes nothing");

    fixture.SetProbeCenter(0.4f);
    fixture.runtime.DispatchAction(
        synth::runtime_ui::Actions::kFileConfirmedSaveAs, patchA.string());
    fixture.PumpUntilJsonCount(patchA, 1);
    Require(fixture.runtime.ConsumePersistenceDirty(),
            "completed browser Save As marks persistence dirty for host sync");
    Require(fixture.runtime.Engine().Patches().CurrentPatchDirectory() == patchA,
            "Save As selects the new patch directory");

    fixture.SetProbeCenter(0.5f);
    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kFileSave, "");
    fixture.PumpUntilJsonCount(patchA, 2);
    Require(fixture.runtime.ConsumePersistenceDirty(),
            "completed browser Save marks persistence dirty for host sync");

    fixture.runtime.DispatchAction(
        synth::runtime_ui::Actions::kFileConfirmedSaveAs, patchA.string());
    fixture.PumpOnce();
    Require(JsonFileCount(patchA) == 2,
            "non-overwrite Save As does not replace an existing patch");

    std::filesystem::create_directories(patchB);
    fixture.SetProbeCenter(0.6f);
    fixture.runtime.DispatchAction(
        synth::runtime_ui::Actions::kFileConfirmedOverwriteSaveAs, patchB.string());
    fixture.PumpUntilJsonCount(patchB, 1);
    Require(fixture.runtime.Engine().Patches().CurrentPatchDirectory() == patchB,
            "overwrite Save As selects the existing patch directory");

    fixture.SetProbeCenter(0.9f);
    fixture.runtime.DispatchAction(
        synth::runtime_ui::Actions::kFileConfirmedLoad, patchA.string());
    fixture.PumpOnce();
    Require(fixture.runtime.Engine().Patches().CurrentPatchDirectory() == patchA,
            "Load selects the requested patch directory");
    Require(fixture.ProbeCenter() == 0.5f, "Load applies the latest saved patch state");

    fixture.SetProbeCenter(0.8f);
    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kFileRevert, "");
    fixture.PumpOnce();
    Require(fixture.ProbeCenter() == 0.5f, "Revert restores the current patch state");

    fixture.SetProbeCenter(0.7f);
    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kFileNew, "");
    fixture.PumpOnce();
    Require(!fixture.runtime.Engine().Patches().CurrentPatchDirectory().has_value(),
            "New clears the current patch directory");
    Require(fixture.ProbeCenter() == 0.25f, "New restores the generic app defaults");

    fixture.runtime.MessageTick(100);
    const synth_browser::DecodedCommandBuffer frame = fixture.Frame();
    const synth_browser::DecodedNode* patchName =
        FindNode(frame, synth::runtime_ui::NodeIds::kFilePatchName);
    Require(patchName != nullptr && patchName->text == "(no patch)",
            "file refresh reports the New patch state through the portable tree");
}

void TestPersistenceDirtyConsumesRuntimeAndServicesSourcesTogether()
{
    RuntimeFixture fixture;
    fixture.Prepare();

    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kSidebarFile, "");
    const std::filesystem::path patchA = fixture.Paths().patchesRoot / "Patch A";
    fixture.SetProbeCenter(0.4f);
    fixture.runtime.DispatchAction(
        synth::runtime_ui::Actions::kFileConfirmedSaveAs, patchA.string());
    fixture.PumpUntilJsonCount(patchA, 1);

    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kSidebarControllers, "");
    fixture.runtime.DispatchAction(synth::runtime_ui::Actions::kBack, "");

    Require(fixture.runtime.ConsumePersistenceDirty(),
            "combined patch and config persistence dirties are reported once");
    Require(!fixture.runtime.ConsumePersistenceDirty(),
            "combined patch and config persistence dirties are consumed together");
}

void TestAudioWorkletDeadlineMeterAveragesQuantizedTimerSamples()
{
    synth_browser::AudioWorkletDeadlineMeter meter;
    for (int block = 0; block < 38; ++block)
    {
        meter.RecordCallbackMicros(block == 0 ? 1'000 : 0, 2'667);
    }

    const float percent = meter.SamplePercent();
    Require(percent > 0.8f && percent < 1.2f,
            "quantized callback timing is averaged over a window");
}

void TestBrowserContractVersionsAreReadableBeforeRuntimeCreation()
{
    Require(synth_browser_abi_version() == 2,
            "browser ABI version is available before runtime creation");
    Require(synth_browser_ui_protocol_version() == 1,
            "browser UI protocol version is available before runtime creation");
    Require(synth_browser_runtime_config_version() == 1,
            "browser runtime-config version is available before runtime creation");
}

class AudioContextHandleCapture final : public synth_browser::RuntimeAbi
{
public:
    std::size_t AudioOutputChannels() const override { return 0; }
    int Initialize(const char*, const char*, std::uint32_t) override { return 0; }
    int Prepare(double, std::size_t) override { return 0; }
    int Process(float**, std::size_t, std::size_t, std::uint64_t) override { return 0; }
    int StartAudioWorklet(std::uint32_t audioContextHandle) override
    {
        observedHandles.push_back(audioContextHandle);
        return 0;
    }
    std::uint32_t AudioWorkletBlockCount() const override { return 0; }
    std::uint32_t AudioWorkletPeakMicrounits() const override { return 0; }
    std::uint32_t AudioWorkletDeadlineMicrounits() const override { return 0; }
    int MessageTick(std::uint64_t) override { return 0; }
    const std::uint8_t* BuildUiFrame(std::size_t*) override { return nullptr; }
    int DispatchAction(const char*, const char*) override { return 0; }
    bool ConsumePersistenceDirty() override { return false; }
    int SubmitMidiEndpoints(const synth_browser::MidiEndpointDescriptor*, std::uint32_t) override { return 0; }
    int DequeueMidiAction(synth_browser::MidiActionDescriptor*) override { return 0; }
    int DeliverMidi(std::uint32_t, const std::uint8_t*, std::uint32_t, std::uint64_t) override { return 0; }
    const std::uint8_t* DequeueMidiOutput(std::uint32_t*, std::uint32_t*) override { return nullptr; }
    void Destroy() override {}

    std::vector<std::uint32_t> observedHandles;
};

void TestBrowserAbiPreservesSuppliedAudioContextHandleAndDirectZero()
{
    AudioContextHandleCapture capture;
    auto* runtime = reinterpret_cast<synth_browser_runtime*>(&capture);
    Require(synth_browser_start_audio_worklet(runtime, 0) == 0,
            "direct audio startup reaches the ABI");
    Require(synth_browser_start_audio_worklet(runtime, 73) == 0,
            "supplied-context audio startup reaches the ABI");
    Require(capture.observedHandles == std::vector<std::uint32_t>{0, 73},
            "browser ABI preserves direct zero and the supplied context handle");
}

void TestNativeAudioCallbackRemainsTheSoleProcessImplementation()
{
    const std::filesystem::path candidates[] = {
        "projects/synth/include/synth/browser/BrowserRuntime.hpp",
        "include/synth/browser/BrowserRuntime.hpp",
    };
    std::string source;
    for (const auto& candidate : candidates)
    {
        std::ifstream input(candidate);
        if (input)
        {
            source.assign(std::istreambuf_iterator<char>(input),
                          std::istreambuf_iterator<char>());
            break;
        }
    }
    Require(!source.empty(), "browser runtime source is available to the contract test");
    const std::string callback = "static bool ProcessAudioWorklet";
    const auto first = source.find(callback);
    Require(first != std::string::npos && source.find(callback, first + callback.size()) == std::string::npos,
            "ProcessAudioWorklet remains the sole native callback implementation");
    Require(source.find("runtime->Process(channelPointers.data()", first) != std::string::npos,
            "ProcessAudioWorklet still delegates DSP to Runtime::Process");
}

void TestBrowserRuntimeAdapterRejectsIncompatibleRuntimeConfigVersion()
{
    synth_browser::RuntimeAbiAdapter<ValidApp> runtime;
    Require(runtime.Initialize("sheaf", "miniapp", 2) == -1,
            "browser runtime adapter rejects incompatible runtime-config versions");
}

void TestBrowserPersistenceIdentityDerivesSharedAndIsolatedRoots()
{
    const synth::RuntimeDataPaths first =
        synth_browser::BrowserPersistentDataPaths("sheaf", "miniapp", 1);
    const synth::RuntimeDataPaths updated =
        synth_browser::BrowserPersistentDataPaths("sheaf", "miniapp", 1);
    const synth::RuntimeDataPaths otherPublisher =
        synth_browser::BrowserPersistentDataPaths("friend", "miniapp", 1);

    Require(first.dataRoot == "/data", "browser persistence mounts the shared /data root");
    Require(first.configFile == "/data/config.json", "browser runtime config is shared");
    Require(first.logsRoot == "/data/logs", "browser logs root is shared");
    Require(first.patchesRoot == "/data/patches/sheaf/miniapp",
            "browser patches use publisher and app identity");
    Require(updated.patchesRoot == first.patchesRoot,
            "browser patch root is stable across builds because build identity is absent");
    Require(otherPublisher.patchesRoot == "/data/patches/friend/miniapp",
            "publishers with the same app id have distinct patch roots");
    Require(otherPublisher.configFile == first.configFile,
            "compatible applications share browser runtime config");

    bool rejectedTraversal = false;
    try
    {
        (void)synth_browser::BrowserPersistentDataPaths("../sheaf", "miniapp", 1);
    }
    catch (const std::invalid_argument&)
    {
        rejectedTraversal = true;
    }
    Require(rejectedTraversal, "browser persistence rejects invalid publisher path components");

    bool rejectedVersion = false;
    try
    {
        (void)synth_browser::BrowserPersistentDataPaths("sheaf", "miniapp", 2);
    }
    catch (const std::invalid_argument&)
    {
        rejectedVersion = true;
    }
    Require(rejectedVersion, "browser persistence rejects incompatible runtime-config versions");
}

}  // namespace

int main()
{
    static_assert(synth::SynthApplication<ValidApp>);
    static_assert(synth_browser::BrowserApplication<ValidApp>);
    static_assert(!synth_browser::BrowserApplication<MissingSurface>);
    static_assert(!synth::SynthApplication<MissingSurface>);
    TestBrowserContractVersionsAreReadableBeforeRuntimeCreation();
    TestBrowserAbiPreservesSuppliedAudioContextHandleAndDirectZero();
    TestNativeAudioCallbackRemainsTheSoleProcessImplementation();
    TestBrowserRuntimeAdapterRejectsIncompatibleRuntimeConfigVersion();
    TestBrowserPersistenceIdentityDerivesSharedAndIsolatedRoots();
    TestBrowserRuntimeUsesSharedFrameAndActionRouting();
    TestBrowserPrepareFeedsNegotiatedAudioPageAndRejectsOversizedBlocks();
    TestNativeBuildRejectsBrowserAudioWorkletStart();
    TestSharedBrowserNavigationReplacesAndRestoresEveryRuntimePage();
    TestControllersUseLatestBridgeSnapshotCommitEditsAndSaveOnBack();
    TestFilePageDispatchesPatchLifecycleThroughBrowserRuntime();
    TestPersistenceDirtyConsumesRuntimeAndServicesSourcesTogether();
    TestAudioWorkletDeadlineMeterAveragesQuantizedTimerSamples();
    return 0;
}
