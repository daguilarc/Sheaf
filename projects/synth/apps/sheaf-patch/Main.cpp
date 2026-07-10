#include "Launcher.hpp"
#include "HostDataPaths.hpp"
#include "MiniAppRegistration.hpp"
#include "Shell.hpp"
#include "synth/ThreadId.hpp"

#include <juce_gui_extra/juce_gui_extra.h>

#include <exception>
#include <filesystem>
#include <memory>
#include <vector>

namespace synth_sheaf_patch {

class SheafPatchApplication final : public juce::JUCEApplication {
public:
    const juce::String getApplicationName() override { return "Sheaf Patch"; }
    const juce::String getApplicationVersion() override { return "0.1"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise(const juce::String&) override {
        synth::SetCurrentThreadId(synth::ThreadId::Message);

        try {
            dataRoot_ = synth_runtime::SheafUserApplicationDataRoot();

            window_ = std::make_unique<MainWindow>("Sheaf Patch");

            std::vector<synth::SynthAppRegistration> apps;
            apps.push_back(synth_miniapp::MakeMiniAppRegistration([this](synth::RuntimeDataPaths paths) {
                LaunchRegisteredApp<synth_miniapp::MiniApp>(std::move(paths));
            }));

            launcher_ = std::make_unique<LauncherComponent>(std::move(apps), dataRoot_);
            window_->ShowContent(*launcher_, 720, 420);
        } catch (const std::exception& e) {
            INFO("SheafPatchApplication::initialise failed: %s", e.what());
            setApplicationReturnValue(1);
            quit();
        }
    }

    void shutdown() override {
        window_.reset();
        activeSession_.reset();
        launcher_.reset();
    }

    void systemRequestedQuit() override { quit(); }
    void anotherInstanceStarted(const juce::String&) override {}

private:
    class MainWindow final : public juce::DocumentWindow {
    public:
        explicit MainWindow(juce::String name)
            : DocumentWindow(std::move(name), juce::Colours::black, DocumentWindow::allButtons) {
            setUsingNativeTitleBar(true);
            setResizable(true, true);
            setVisible(true);
        }

        void ShowContent(juce::Component& component, int width, int height) {
            setContentNonOwned(&component, false);
            setSize(width, height);
            centreWithSize(width, height);
            setVisible(true);
        }

        void closeButtonPressed() override { juce::JUCEApplication::getInstance()->systemRequestedQuit(); }
    };

    template <synth::SynthApplication App>
    void LaunchRegisteredApp(synth::RuntimeDataPaths paths) {
        try {
            auto session = synth_runtime::MakeRuntimeSessionOwner<App>(std::move(paths));
            const synth::RuntimeConfig config = App::Config();

            window_->setName(juce::String(config.appName));
            window_->ShowContent(session->Component(), config.uiWidth, config.uiHeight);
            activeSession_ = std::move(session);
        } catch (const std::exception& e) {
            INFO("SheafPatchApplication::LaunchRegisteredApp failed: %s", e.what());
        }
    }

    std::filesystem::path dataRoot_;
    std::unique_ptr<MainWindow> window_;
    std::unique_ptr<LauncherComponent> launcher_;
    std::unique_ptr<synth_runtime::RuntimeSessionOwner> activeSession_;
};

}  // namespace synth_sheaf_patch

START_JUCE_APPLICATION(synth_sheaf_patch::SheafPatchApplication)
