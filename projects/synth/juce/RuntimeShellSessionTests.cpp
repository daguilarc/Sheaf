#include "MiniApp.hpp"
#include "MiniAppUiModel.hpp"
#include "HostDataPaths.hpp"
#include "Shell.hpp"

#include "synth/AppContext.hpp"
#include "synth/ControllersPageUI.hpp"
#include "synth/MidiConfigViewModel.hpp"
#include "synth/PortableUIBuilders.hpp"
#include "synth/RuntimePages.hpp"
#include "synth/ThreadId.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <filesystem>
#include <memory>
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

juce::Rectangle<int> SurfaceBoundsOf(const juce::Component& surface,
                                     const juce::Component& child) {
    return surface.getLocalArea(&child, child.getLocalBounds());
}

juce::Viewport* FindViewport(juce::Component& parent) {
    for (int index = 0; index < parent.getNumChildComponents(); ++index) {
        juce::Component* child = parent.getChildComponent(index);
        if (auto* viewport = dynamic_cast<juce::Viewport*>(child); viewport != nullptr) {
            return viewport;
        }
        if (juce::Viewport* viewport = FindViewport(*child); viewport != nullptr) {
            return viewport;
        }
    }
    return nullptr;
}

bool IsEnabledEditableControl(juce::Component& component) {
    if (!component.isEnabled()) {
        return false;
    }
    if (auto* editor = dynamic_cast<juce::TextEditor*>(&component); editor != nullptr) {
        return !editor->isReadOnly();
    }
    return dynamic_cast<juce::ComboBox*>(&component) != nullptr
           || dynamic_cast<juce::ToggleButton*>(&component) != nullptr;
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
    Require(renderer.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(0)) == nullptr,
            "audio click synchronously replaces app controls in the shared renderer");
    auto* backButton = dynamic_cast<juce::TextButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAudioBack));
    Require(backButton != nullptr, "audio page back control is rendered");
    backButton->onClick();
    Require(renderer.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(0)) != nullptr,
            "back synchronously restores app controls in the shared renderer");
    Require(&session.GetRuntime().AppSurface() == appSurface,
            "the app surface and its state survive runtime-page navigation");

    auto* syncButton = dynamic_cast<juce::TextButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSidebarSync));
    Require(syncButton != nullptr, "Sync sidebar control is a button");
    syncButton->onClick();
    auto* syncShell = dynamic_cast<synth_runtime::ShellComponent<synth_miniapp::MiniApp>*>(
        &session.Component());
    Require(syncShell != nullptr &&
                syncShell->GetMainPane().CurrentPage() ==
                    synth_runtime::MainPane<synth_miniapp::MiniApp>::Page::Sync,
            "JUCE host reports the portable Sync page as current");
    auto* sendClockToggle = dynamic_cast<juce::ToggleButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSyncSendClock));
    auto* syncPpqnEditor = dynamic_cast<juce::TextEditor*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSyncPpqn));
    Require(sendClockToggle != nullptr && !sendClockToggle->getToggleState(),
            "JUCE Sync session opens with the Engine snapshot");
    Require(syncPpqnEditor != nullptr && syncPpqnEditor->getText() == "24",
            "JUCE Sync session opens with default PPQN");
    sendClockToggle->setToggleState(true, juce::dontSendNotification);
    sendClockToggle->onClick();
    syncPpqnEditor = dynamic_cast<juce::TextEditor*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSyncPpqn));
    Require(syncPpqnEditor != nullptr, "JUCE Sync PPQN remains rendered after toggle edit");
    syncPpqnEditor->setText("96");
    syncPpqnEditor->onReturnKey();
    Require(session.GetRuntime().GetEngine().SyncConfigurationSnapshot() == synth::SyncConfig{},
            "JUCE Sync edits stay staged before Back");

    auto* syncBackButton = dynamic_cast<juce::TextButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSyncBack));
    Require(syncBackButton != nullptr, "JUCE Sync Back is rendered");
    syncBackButton->onClick();
    const synth::SyncConfig committedSync{
        .sendClock = true,
        .receiveClock = false,
        .sendTransport = false,
        .receiveTransport = false,
        .ppqn = 96,
    };
    Require(session.GetRuntime().GetEngine().SyncConfigurationSnapshot() == committedSync,
            "JUCE Sync Back commits one complete configuration");
    synth::MidiInstrumentConfig savedInstrument;
    synth::AudioDeviceState savedAudio;
    synth::SyncConfig savedSync;
    Require(synth::LoadRuntimeConfigFile(
                paths.configFile, savedInstrument, savedAudio, savedSync) ==
                synth::RuntimeConfigFileStatus::Ok &&
                savedSync == committedSync,
            "JUCE Sync Back persists the requested configuration");

    syncButton = dynamic_cast<juce::TextButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSidebarSync));
    Require(syncButton != nullptr, "Sync sidebar returns after Back");
    syncButton->onClick();
    sendClockToggle = dynamic_cast<juce::ToggleButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSyncSendClock));
    syncPpqnEditor = dynamic_cast<juce::TextEditor*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSyncPpqn));
    Require(sendClockToggle != nullptr && sendClockToggle->getToggleState(),
            "JUCE Sync reopen uses committed toggle state");
    Require(syncPpqnEditor != nullptr && syncPpqnEditor->getText() == "96",
            "JUCE Sync reopen uses committed PPQN");
    syncBackButton = dynamic_cast<juce::TextButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSyncBack));
    Require(syncBackButton != nullptr, "JUCE Sync Back remains available after reopen");
    syncBackButton->onClick();

    session.GetRuntime().GetEngine().EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        instrument.AddController(synth::WrldBldrDefaultControllerSlot("second"));
    });
    auto* shell = dynamic_cast<synth_runtime::ShellComponent<synth_miniapp::MiniApp>*>(
        &session.Component());
    Require(shell != nullptr, "runtime session exposes its typed shell for refresh");
    shell->RepaintAll();
    auto* controllersButton = dynamic_cast<juce::TextButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kSidebarControllers));
    Require(controllersButton != nullptr, "controllers sidebar control is a button");
    controllersButton->onClick();

    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kBack) != nullptr,
            "controllers back renders through the shared renderer");
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerRow(0)) != nullptr
                && renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerRow(1)) != nullptr,
            "controller rows render through the shared renderer");
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kAddRow) != nullptr,
            "controllers add row renders through the shared renderer");
    Require(renderer.FindByNodeId(synth::runtime_ui::NodeIds::kStatus) != nullptr,
            "controllers status renders through the shared renderer");
    juce::Component* controllersScroll =
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kScroll);
    Require(controllersScroll != nullptr,
            "controllers scroll renders through the shared renderer");

    const juce::Rectangle<int> controllersBackBounds =
        renderer.SurfaceBoundsForNode(synth::runtime_ui::NodeIds::kBack);
    const juce::Rectangle<int> controllersScrollBounds =
        renderer.SurfaceBoundsForNode(synth::runtime_ui::NodeIds::kScroll);
    const juce::Rectangle<int> firstControllerBounds =
        renderer.SurfaceBoundsForNode(synth::runtime_ui::NodeIds::ControllerRow(0));
    const juce::Rectangle<int> secondControllerBounds =
        renderer.SurfaceBoundsForNode(synth::runtime_ui::NodeIds::ControllerRow(1));
    Require(controllersBackBounds.getBottom() <= controllersScrollBounds.getY(),
            "controllers header controls end above the scroll viewport");
    Require(firstControllerBounds.getY() != secondControllerBounds.getY(),
            "controller rows resolve to distinct surface positions");

    auto* disclosure = dynamic_cast<juce::TextButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::ControllerDisclosure(0)));
    Require(disclosure != nullptr, "first controller disclosure renders");
    disclosure->onClick();
    auto* systemSection = dynamic_cast<juce::TextButton*>(renderer.FindByNodeId(
        synth::runtime_ui::NodeIds::SectionToggle(0, synth::MidiConfigSection::SystemMessages)));
    Require(systemSection != nullptr, "system messages section renders after disclosure");
    systemSection->onClick();

    controllersScroll = renderer.FindByNodeId(synth::runtime_ui::NodeIds::kScroll);
    Require(controllersScroll != nullptr, "controllers scroll survives section expansion");
    juce::Viewport* viewport = FindViewport(*controllersScroll);
    Require(viewport != nullptr && viewport->getViewedComponent() != nullptr,
            "generic controllers scroll owns a JUCE viewport and content component");
    Require(viewport->getViewedComponent()->getHeight() > viewport->getHeight(),
            "expanded controllers content is taller than its viewport");

    synth::MidiConfigViewModel controllersModel;
    controllersModel.Rebuild(session.GetRuntime().GetEngine().InstrumentSnapshot(),
                             session.GetRuntime().MidiConnections().State());
    const std::vector<synth::MidiMappingRowVM> systemRows =
        controllersModel.SectionRows(0, synth::MidiConfigSection::SystemMessages);
    Require(!systemRows.empty() && !systemRows.back().editableFields.empty(),
            "runtime controller has editable system-message mappings");
    const std::size_t finalRowIndex = systemRows.size() - 1;
    const synth::MidiMappingRowVM::Field finalField = systemRows.back().editableFields.back();
    const std::string finalMappingId = synth::runtime_ui::NodeIds::MappingField(
        0, synth::MidiConfigSection::SystemMessages, finalRowIndex, finalField);
    juce::Component* finalMappingControl = renderer.FindByNodeId(finalMappingId);
    Require(finalMappingControl != nullptr, "final system-message mapping control renders");

    viewport->setViewPosition(viewport->getViewPositionX(),
                              viewport->getViewedComponent()->getHeight() - viewport->getHeight());
    Require(SurfaceBoundsOf(renderer, *viewport).intersects(
                SurfaceBoundsOf(renderer, *finalMappingControl)),
            "final mapping control is reachable at the maximum vertical scroll position");
    Require(IsEnabledEditableControl(*finalMappingControl),
            "final mapping control remains enabled and editable after scrolling");

    auto* controllersBackButton = dynamic_cast<juce::TextButton*>(
        renderer.FindByNodeId(synth::runtime_ui::NodeIds::kBack));
    Require(controllersBackButton != nullptr, "controllers back control remains available");
    controllersBackButton->onClick();
    Require(renderer.FindByNodeId(synth_miniapp::MiniAppNodeIds::Encoder(0)) != nullptr,
            "controllers back restores the app before later session checks");

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

    {
        auto owner = synth_runtime::MakeRuntimeSessionOwner<synth_miniapp::MiniApp>(paths);
        Require(owner != nullptr, "type-erased runtime session owner is constructed");

        juce::Component parent;
        parent.addAndMakeVisible(owner->Component());

        Require(owner->Component().getParentComponent() == &parent,
                "type-erased runtime session owner exposes a displayable component");
        Require(dynamic_cast<synth_runtime::ShellComponent<synth_miniapp::MiniApp>*>(&owner->Component()) != nullptr,
                "type-erased runtime session owner exposes the contained typed shell component");

        parent.removeChildComponent(&owner->Component());
        owner.reset();
    }

    return 0;
}
