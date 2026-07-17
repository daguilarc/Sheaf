#include "ControllersPageHarness.hpp"
#include "PortableJuceBackend.hpp"

#include <juce_gui_extra/juce_gui_extra.h>

#include <memory>
#include <string>
#include <utility>

namespace {

class HarnessComponent final : public juce::Component
{
public:
    HarnessComponent()
        : surface_(fixture_.MakeSurface())
        , renderer_(surface_)
    {
        resetButton_.setButtonText("Reset");
        resetButton_.onClick = [this] {
            ResetScenario();
            lastAction_ = "reset";
            RefreshAll();
        };
        addAndMakeVisible(resetButton_);

        addButton_.setButtonText("Add Generic");
        addButton_.onClick = [this] {
            const std::string name = "generic_" + std::to_string(nextControllerIx_++);
            surface_.SetAddControllerDraft(name, "generic");
            surface_.DispatchAction(synth::ui::Action::Named(synth::runtime_ui::Actions::kAddController));
            lastAction_ = "add " + name;
            RefreshAll();
        };
        addAndMakeVisible(addButton_);

        expandButton_.setButtonText("Expand WRLD");
        expandButton_.onClick = [this] {
            surface_.DispatchAction(
                synth::ui::Action::WithValue(synth::runtime_ui::Actions::kToggleConfig, "0"));
            surface_.DispatchAction(synth::ui::Action::WithValue(
                synth::runtime_ui::Actions::kToggleSection,
                "0:" + synth::runtime_ui::ControllersLayout::SectionToken(synth::MidiConfigSection::Encoders)));
            lastAction_ = "expand wrld encoders";
            RefreshAll();
        };
        addAndMakeVisible(expandButton_);

        status_.setColour(juce::Label::textColourId, juce::Colours::white);
        status_.setJustificationType(juce::Justification::centredLeft);
        addAndMakeVisible(status_);

        addAndMakeVisible(renderer_);
        RefreshAll();
    }

    void resized() override
    {
        auto area = getLocalBounds().reduced(8);
        auto toolbar = area.removeFromTop(34);
        resetButton_.setBounds(toolbar.removeFromLeft(82));
        toolbar.removeFromLeft(6);
        addButton_.setBounds(toolbar.removeFromLeft(112));
        toolbar.removeFromLeft(6);
        expandButton_.setBounds(toolbar.removeFromLeft(116));
        toolbar.removeFromLeft(10);
        status_.setBounds(toolbar);

        area.removeFromTop(6);
        renderer_.setBounds(area);
        surface_.SetContentBounds(synth_juce::JuceToUiBounds(area.toFloat()));
        renderer_.RefreshFromSurface();
        UpdateStatus();
    }

private:
    void ResetScenario()
    {
        fixture_ = synth_runtime::test::ControllersHarnessFixture{};
        surface_.SetEnumerateDevices(fixture_.state.devices);
        surface_.MarkDirty();
        surface_.RefreshOnTick();
        nextControllerIx_ = 1;
    }

    void RefreshAll()
    {
        surface_.SetEnumerateDevices(fixture_.state.devices);
        surface_.RefreshOnTick();
        renderer_.RefreshFromSurface();
        resized();
        repaint();
    }

    void UpdateStatus()
    {
        const synth::ui::NodeTree tree = surface_.BuildTree();
        status_.setText("controllers=" + juce::String(static_cast<int>(fixture_.state.instrument.controllers.size())) +
                            " nodes=" + juce::String(static_cast<int>(tree.nodes.size())) +
                            " commits=" + juce::String(fixture_.state.commits) +
                            " last=" + juce::String(lastAction_),
                        juce::dontSendNotification);
    }

    synth_runtime::test::ControllersHarnessFixture fixture_;
    synth::runtime_ui::ControllersPageSurface surface_;
    synth_juce::PortableComponent renderer_;
    juce::TextButton resetButton_;
    juce::TextButton addButton_;
    juce::TextButton expandButton_;
    juce::Label status_;
    int nextControllerIx_ = 1;
    std::string lastAction_ = "initial";
};

class HarnessApplication final : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "ControllersHarness"; }
    const juce::String getApplicationVersion() override { return "0.1"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise(const juce::String&) override
    {
        mainWindow_ = std::make_unique<MainWindow>(getApplicationName());
    }

    void shutdown() override
    {
        mainWindow_.reset();
    }

    void systemRequestedQuit() override
    {
        quit();
    }

    void anotherInstanceStarted(const juce::String&) override {}

private:
    class MainWindow final : public juce::DocumentWindow
    {
    public:
        explicit MainWindow(juce::String name)
            : DocumentWindow(std::move(name), juce::Colours::black, DocumentWindow::allButtons)
        {
            setUsingNativeTitleBar(true);
            setContentOwned(new HarnessComponent(), true);
            centreWithSize(1180, 760);
            setVisible(true);
            toFront(true);
        }

        void closeButtonPressed() override
        {
            juce::JUCEApplication::getInstance()->systemRequestedQuit();
        }
    };

    std::unique_ptr<MainWindow> mainWindow_;
};

}  // namespace

START_JUCE_APPLICATION(HarnessApplication)
