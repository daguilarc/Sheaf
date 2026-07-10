#include "MiniApp.hpp"
#include "MiniAppUiModel.hpp"
#include "HostDataPaths.hpp"
#include "Shell.hpp"

#include "synth/AppContext.hpp"
#include "synth/PortableUIBuilders.hpp"
#include "synth/RuntimePages.hpp"
#include "synth/ThreadId.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <filesystem>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

void Require(bool condition, const char* label) {
    if (!condition) {
        throw std::runtime_error(label);
    }
}

void CollectPortableComponents(juce::Component& parent,
                               std::vector<synth_juce::PortableComponent*>& components) {
    for (int index = 0; index < parent.getNumChildComponents(); ++index) {
        juce::Component* child = parent.getChildComponent(index);
        if (auto* portable = dynamic_cast<synth_juce::PortableComponent*>(child); portable != nullptr) {
            components.push_back(portable);
        }
        CollectPortableComponents(*child, components);
    }
}

struct WideDrawSurface final : synth::ui::Surface {
    synth::ui::NodeTree BuildTree() override {
        synth::ui::Builder builder;
        builder.Root("wide.root", {0.0f, 0.0f, 900.0f, 240.0f})
            .DrawInteractive("wide.draw",
                             {0.0f, 0.0f, 900.0f, 120.0f},
                             {},
                             synth::ui::Action::Named("wide.drag"));
        return builder.Build();
    }

    void SetActionHandler(ActionHandler handler) override { actionHandler = std::move(handler); }
    void DispatchAction(const synth::ui::Action&) override {}

    ActionHandler actionHandler;
};

struct WideDrawApp final {
    static synth::RuntimeConfig Config() {
        synth::RuntimeConfig config;
        config.appName = "WideDrawTest";
        config.numAudioInputs = 0;
        config.numAudioOutputs = 0;
        config.uiWidth = 900;
        config.uiHeight = 240;
        config.uiFrameHz = 30;
        return config;
    }

    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
    synth::ui::Surface& PortableSurface() { return surface; }

    WideDrawSurface surface;
};

}  // namespace

int main() {
    juce::ScopedJuceInitialiser_GUI juce;
    synth::SetCurrentThreadId(synth::ThreadId::Message);

    const std::filesystem::path sheafRoot = synth_runtime::SheafUserApplicationDataRoot();
    Require(sheafRoot.filename() == "Sheaf", "host data root is the shared Sheaf app-support root");

    const synth::RuntimeDataPaths standalonePaths =
        synth_runtime::DefaultDataPathsForApp(synth_miniapp::MiniApp::Config());
    Require(standalonePaths.dataRoot == sheafRoot / "SynthMiniapp",
            "standalone miniapp data root stays under the shared Sheaf app-support root");

    const synth::RuntimeDataPaths sheafPatchPaths = synth_runtime::SheafPatchDataPathsForApp("miniapp");
    Require(sheafPatchPaths.dataRoot == sheafRoot / "synth" / "sheaf-patch",
            "SheafPatch data root uses stable app-support storage");
    Require(sheafPatchPaths.configFile == sheafRoot / "synth" / "sheaf-patch" / "config",
            "SheafPatch config path is stable under app support");
    Require(sheafPatchPaths.patchesRoot == sheafRoot / "synth" / "sheaf-patch" / "patches" / "miniapp",
            "SheafPatch patches path is stable under app support");

    const std::filesystem::path root =
        std::filesystem::temp_directory_path() / "sheaf-runtime-shell-session-test";
    std::filesystem::remove_all(root);
    const synth::RuntimeDataPaths paths = synth::RuntimeDataPaths::FromRoots(
        root,
        root / "patches" / "miniapp",
        root / "logs",
        root / "config");

    synth_runtime::RuntimeShellSession<synth_miniapp::MiniApp> session(paths);
    const synth::RuntimeDataPaths& runtimePaths = session.GetRuntime().DataPaths();

    Require(runtimePaths.dataRoot == paths.dataRoot, "runtime session receives supplied data root");
    Require(runtimePaths.patchesRoot == paths.patchesRoot, "runtime session receives supplied patches root");
    Require(runtimePaths.logsRoot == paths.logsRoot, "runtime session receives supplied logs root");
    Require(runtimePaths.configFile == paths.configFile, "runtime session receives supplied config path");
    Require(std::filesystem::exists(paths.patchesRoot), "runtime session creates supplied patches root");
    Require(std::filesystem::exists(paths.logsRoot), "runtime session creates supplied logs root");

    const synth::RuntimeConfig config = synth_miniapp::MiniApp::Config();
    Require(session.Component().getWidth() == config.uiWidth + 96,
            "runtime shell content width adds the shared sidebar");
    Require(session.Component().getHeight() == config.uiHeight,
            "runtime shell content height preserves the app height");

    std::vector<synth_juce::PortableComponent*> renderers;
    CollectPortableComponents(session.Component(), renderers);
    Require(renderers.size() == 1, "runtime shell owns exactly one portable renderer");
    synth_juce::PortableComponent& renderer = *renderers.front();
    Require(renderer.FindByNodeId("runtime.main.root") == &renderer,
            "composite root is discoverable as the shared renderer");
    Require(renderer.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(0)) != nullptr,
            "app encoder is discoverable through the shared renderer");
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSidebarAudio) != nullptr,
            "audio sidebar control is discoverable through the shared renderer");

    synth::ui::Surface* appSurface = &session.GetRuntime().AppSurface();
    auto* audioButton = dynamic_cast<juce::TextButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSidebarAudio));
    Require(audioButton != nullptr, "audio sidebar control is a button");
    audioButton->onClick();
    static_cast<synth_runtime::ShellComponent<synth_miniapp::MiniApp>&>(session.Component())
        .GetMainPane()
        .RefreshOnTick();
    Require(renderer.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(0)) == nullptr,
            "audio click replaces app controls in the shared renderer");
    auto* backButton = dynamic_cast<juce::TextButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAudioBack));
    Require(backButton != nullptr, "audio page back control is rendered");
    backButton->onClick();
    static_cast<synth_runtime::ShellComponent<synth_miniapp::MiniApp>&>(session.Component())
        .GetMainPane()
        .RefreshOnTick();
    Require(renderer.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(0)) != nullptr,
            "back restores app controls in the shared renderer");
    Require(&session.GetRuntime().AppSurface() == appSurface,
            "the app surface and its state survive runtime-page navigation");

    const std::filesystem::path wideRoot = root / "wide";
    synth_runtime::RuntimeShellSession<WideDrawApp> wideSession(
        synth::RuntimeDataPaths::FromRoots(
            wideRoot, wideRoot / "patches", wideRoot / "logs", wideRoot / "config"));
    std::vector<synth_juce::PortableComponent*> wideRenderers;
    CollectPortableComponents(wideSession.Component(), wideRenderers);
    Require(wideRenderers.size() == 1, "wide-draw shell owns one portable renderer");
    juce::Component* wideDraw = wideRenderers.front()->FindByNodeId("wide.draw");
    Require(wideDraw != nullptr && wideDraw->getBounds().getRight() == 900,
            "full-width app draw reaches x 900 without clipping");

    return 0;
}
