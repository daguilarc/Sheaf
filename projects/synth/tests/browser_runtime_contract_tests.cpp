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
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>

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

    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
    synth::ui::Surface& PortableSurface() { return surface; }

    ContractSurface surface;
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
        runtime.SetRuntimeDataPaths(synth::RuntimeDataPaths::FromDataRoot(dataRoot_));
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

    synth_browser::Runtime<ValidApp> runtime;

private:
    const std::filesystem::path dataRoot_ =
        std::filesystem::temp_directory_path() / "sheaf-browser-runtime-contract";
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

}  // namespace

int main()
{
    static_assert(synth::SynthApplication<ValidApp>);
    static_assert(synth_browser::BrowserApplication<ValidApp>);
    static_assert(!synth_browser::BrowserApplication<MissingSurface>);
    static_assert(!synth::SynthApplication<MissingSurface>);
    TestBrowserRuntimeUsesSharedFrameAndActionRouting();
    return 0;
}
