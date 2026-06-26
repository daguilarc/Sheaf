#include <juce_gui_extra/juce_gui_extra.h>

#include "DemoModulation.hpp"
#include "EncoderComponent.hpp"
#include "synth/ParameterModulation.hpp"

#include <array>
#include <cmath>
#include <functional>
#include <memory>
#include <vector>

namespace {

class MainComponent final : public juce::Component, private juce::Timer {
public:
    MainComponent() {
        manager_.SetGestureCount(1);
        auto& groupA = manager_.CreateGroup({
            .numVoices = 2,
            .numModulators = 1,
            .numScenes = 3,
            .maxParameters = 8,
            .processLiteAlpha = 1.0f,
            .voiceIndicatorColors = {synth::Color::Cyan, synth::Color::Orange},
        });
        groupA_ = &groupA;
        groupA.GetModulators().Metadata(0).name = "Demo LFO";
        groupA.GetModulators().Metadata(0).color = synth::Color::Cyan;
        groupA.GetModulators().Metadata(0).connected = true;
        auto& groupB = manager_.CreateGroup({
            .numVoices = 3,
            .numModulators = 1,
            .numScenes = 3,
            .maxParameters = 8,
            .processLiteAlpha = 1.0f,
            .voiceIndicatorColors = {synth::Color::Red, synth::Color::Yellow, synth::Color::Green},
        });
        groupB_ = &groupB;
        groupB.GetModulators().Metadata(0).name = "Tri LFO";
        groupB.GetModulators().Metadata(0).color = synth::Color::Red;
        groupB.GetModulators().Metadata(0).connected = true;
        manager_.GestureMetadataAt(0).name = "Gesture 1";
        manager_.GestureMetadataAt(0).color = synth::Color::Orange;
        cutoff_ = &manager_.CreateParameter(groupA, {.name = "Cutoff", .shortName = "Cut", .defaultValue = 0.35f, .color = synth::Color::Green});
        shape_ = &manager_.CreateParameter(groupA, {.name = "Shape", .shortName = "Shp", .defaultValue = 0.0f, .range = synth::RangeKind::Bipolar, .switchValues = 5, .color = synth::Color::Blue});
        level_ = &manager_.CreateParameter(groupA, {.name = "Level", .shortName = "Lvl", .defaultValue = 0.7f, .color = synth::Color::Yellow});
        spread_ = &manager_.CreateParameter(groupB, {.name = "Spread", .shortName = "Spr", .defaultValue = 0.45f, .color = synth::Color::Red});
        fold_ = &manager_.CreateParameter(groupB, {.name = "Fold", .shortName = "Fld", .defaultValue = 0.0f, .range = synth::RangeKind::Bipolar, .switchValues = 7, .color = synth::Color::Indigo});
        tone_ = &manager_.CreateParameter(groupB, {.name = "Tone", .shortName = "Ton", .defaultValue = 0.6f, .color = synth::Color::Cyan});
        parameters_ = {cutoff_, shape_, level_, spread_, fold_, tone_};
        cutoff_->SetGestureActive(0, 0, true);
        cutoff_->SetGestureActive(1, 0, true);
        bankA_ = &manager_.CreateBank();
        bankA_->AddMapping(10, *cutoff_);
        bankA_->AddMapping(11, *shape_);
        bankA_->AddMapping(12, *level_);
        bankB_ = &manager_.CreateBank();
        bankB_->AddMapping(10, *spread_);
        bankB_->AddMapping(11, *fold_);
        bankB_->AddMapping(12, *tone_);
        slot_ = &manager_.CreateBankSlot();
        for (auto encoder : {10u, 11u, 12u}) {
            slot_->AddPhysicalEncoder(encoder);
        }
        slot_->SelectBank(bankA_);
        manager_.SetSceneEndpoints(0, 1);
        uiState_ = manager_.CreateUIState();
        bus_.SetManager(&manager_);

        for (std::size_t ix = 0; ix < encoders_.size(); ++ix) {
            addAndMakeVisible(encoders_[ix]);
            encoders_[ix].BindMessages(&bus_, 0, ix);
            encoders_[ix].SetTimestampProvider([this] { return nextTimestamp_++; });
            encoders_[ix].SetModulatorColors({synth::Color::Cyan});
            encoders_[ix].SetGestureColors({synth::Color::Orange});
        }

        addButton(bankAButton_, "Bank A", [this] { bus_.Push(synth::MessageIn::SelectParamBank(nextTimestamp_++, 0, 0)); });
        addButton(bankBButton_, "Bank B", [this] { bus_.Push(synth::MessageIn::SelectParamBank(nextTimestamp_++, 0, 1)); });
        addButton(gestureButton_, "Gesture", [this] { bus_.Push(synth::MessageIn::ToggleGestureSelect(nextTimestamp_++, 0)); });
        addButton(sceneAButton_, "S1", [this] { bus_.Push(synth::MessageIn::SceneSelect(nextTimestamp_++, 0)); });
        addButton(sceneBButton_, "S2", [this] { bus_.Push(synth::MessageIn::SceneSelect(nextTimestamp_++, 1)); });
        addButton(sceneCButton_, "S3", [this] { bus_.Push(synth::MessageIn::SceneSelect(nextTimestamp_++, 2)); });
        addButton(shiftButton_, "Shift", [this] { bus_.Push(synth::MessageIn::ToggleShift(nextTimestamp_++)); });
        addButton(startButton_, "Start", [this] { bus_.Push(synth::MessageIn::Start(nextTimestamp_++)); });
        addButton(stopButton_, "Stop", [this] { bus_.Push(synth::MessageIn::Stop(nextTimestamp_++)); });

        gestureSlider_.setRange(0.0, 1.0, 0.001);
        gestureSlider_.onValueChange = [this] {
            bus_.Push(synth::MessageIn::SetGestureValue(nextTimestamp_++, 0, static_cast<float>(gestureSlider_.getValue())));
        };
        addAndMakeVisible(gestureSlider_);

        blendSlider_.setRange(0.0, 1.0, 0.001);
        blendSlider_.onValueChange = [this] {
            bus_.Push(synth::MessageIn::SetSceneBlend(nextTimestamp_++, static_cast<float>(blendSlider_.getValue())));
        };
        addAndMakeVisible(blendSlider_);

        setSize(760, 380);
        startTimerHz(30);
    }

    void paint(juce::Graphics& g) override {
        g.fillAll(juce::Colour(24, 26, 28));
        g.setColour(juce::Colours::white);
        g.setFont(16.0f);
        g.drawFittedText("Synth Params", getLocalBounds().removeFromTop(28), juce::Justification::centred, 1);
    }

    void resized() override {
        auto area = getLocalBounds().reduced(16);
        area.removeFromTop(32);
        auto encoderRow = area.removeFromTop(150);
        for (auto& encoder : encoders_) {
            encoder.setBounds(encoderRow.removeFromLeft(150).reduced(12));
        }
        auto controls = area.removeFromTop(52);
        std::array<juce::TextButton*, 9> buttons{
            &bankAButton_, &bankBButton_, &gestureButton_, &shiftButton_, &sceneAButton_,
            &sceneBButton_, &sceneCButton_, &startButton_, &stopButton_,
        };
        const int buttonWidth = controls.getWidth() / static_cast<int>(buttons.size());
        for (auto* button : buttons) {
            button->setBounds(controls.removeFromLeft(buttonWidth).reduced(4));
        }
        auto sliders = area.removeFromTop(80);
        gestureSlider_.setBounds(sliders.removeFromLeft(getWidth() / 2 - 24).reduced(8));
        blendSlider_.setBounds(sliders.reduced(8));
    }

private:
    void addButton(juce::TextButton& button, const juce::String& text, std::function<void()> callback) {
        button.setButtonText(text);
        button.onClick = std::move(callback);
        addAndMakeVisible(button);
    }

    static juce::Colour toJuce(synth::Color color) {
        return juce::Colour(color.r, color.g, color.b, color.a);
    }

    static void setButtonLit(juce::TextButton& button, bool lit, juce::Colour litColour) {
        button.setColour(juce::TextButton::buttonColourId, lit ? litColour : juce::Colour(44, 46, 48));
        button.setColour(juce::TextButton::buttonOnColourId, litColour.brighter(0.1f));
        button.setColour(juce::TextButton::textColourOffId, lit ? juce::Colours::black : juce::Colours::white);
        button.setColour(juce::TextButton::textColourOnId, juce::Colours::black);
    }

    void updateSceneButton(juce::TextButton& button, std::size_t sceneIx, std::size_t leftScene,
                           std::size_t rightScene) {
        const bool isLeft = sceneIx == leftScene;
        const bool isRight = sceneIx == rightScene;
        juce::String label = "S" + juce::String(static_cast<int>(sceneIx + 1));
        if (isLeft) {
            label += " L";
        }
        if (isRight) {
            label += " R";
        }
        button.setButtonText(label);
        if (isLeft && isRight) {
            setButtonLit(button, true, juce::Colour(92, 214, 120));
        } else if (isLeft) {
            setButtonLit(button, true, juce::Colour(98, 172, 255));
        } else if (isRight) {
            setButtonLit(button, true, juce::Colour(255, 180, 86));
        } else {
            setButtonLit(button, false, juce::Colour(44, 46, 48));
        }
    }

    void timerCallback() override {
        phase_ += 0.06f;
        groupA_->GetModulators().Value(0, 0) = synth_miniapp::UnipolarSineModulator(phase_);
        groupA_->GetModulators().Value(1, 0) =
            synth_miniapp::UnipolarSineModulator(phase_, juce::MathConstants<float>::halfPi);
        for (std::size_t voiceIx = 0; voiceIx < 3; ++voiceIx) {
            groupB_->GetModulators().Value(voiceIx, 0) =
                synth_miniapp::UnipolarSineModulator(phase_, synth_miniapp::ThreePhaseVoiceOffset(voiceIx));
        }
        bus_.Process(nextTimestamp_++);
        for (synth::Parameter* parameter : parameters_) {
            parameter->Compute(manager_.Scene());
            parameter->ProcessLite();
        }
        manager_.PopulateUIState(*uiState_);
        const bool gestureSelected = uiState_->gestures.gestureCapacity > 0 &&
                                     uiState_->gestures.selected[0].load(std::memory_order_relaxed);
        const synth::Color gestureColor = uiState_->gestures.gestureCapacity > 0
                                              ? uiState_->gestures.colors[0].Load(std::memory_order_relaxed)
                                              : synth::Color::Orange;
        setButtonLit(gestureButton_, gestureSelected, toJuce(gestureColor));
        setButtonLit(shiftButton_, uiState_->shiftHeld.load(std::memory_order_relaxed), juce::Colour(238, 226, 95));
        const std::size_t leftScene = uiState_->leftScene.load(std::memory_order_relaxed);
        const std::size_t rightScene = uiState_->rightScene.load(std::memory_order_relaxed);
        updateSceneButton(sceneAButton_, 0, leftScene, rightScene);
        updateSceneButton(sceneBButton_, 1, leftScene, rightScene);
        updateSceneButton(sceneCButton_, 2, leftScene, rightScene);
        for (std::size_t ix = 0; ix < encoders_.size(); ++ix) {
            encoders_[ix].Bind(&uiState_->slots[0].cells[ix]);
            encoders_[ix].repaint();
        }
    }

    synth::ParameterManager manager_;
    synth::MessageInBus bus_{&manager_};
    synth::ParameterGroup* groupA_ = nullptr;
    synth::ParameterGroup* groupB_ = nullptr;
    synth::Parameter* cutoff_ = nullptr;
    synth::Parameter* shape_ = nullptr;
    synth::Parameter* level_ = nullptr;
    synth::Parameter* spread_ = nullptr;
    synth::Parameter* fold_ = nullptr;
    synth::Parameter* tone_ = nullptr;
    std::vector<synth::Parameter*> parameters_;
    synth::Bank* bankA_ = nullptr;
    synth::Bank* bankB_ = nullptr;
    synth::BankSlot* slot_ = nullptr;
    std::unique_ptr<synth::ParameterManager::UIState> uiState_;
    std::array<synth_juce::EncoderComponent, 3> encoders_;
    juce::TextButton bankAButton_;
    juce::TextButton bankBButton_;
    juce::TextButton gestureButton_;
    juce::TextButton sceneAButton_;
    juce::TextButton sceneBButton_;
    juce::TextButton sceneCButton_;
    juce::TextButton shiftButton_;
    juce::TextButton startButton_;
    juce::TextButton stopButton_;
    juce::Slider gestureSlider_;
    juce::Slider blendSlider_;
    std::uint64_t nextTimestamp_ = 1;
    float phase_ = 0.0f;
};

class SynthMiniappApplication final : public juce::JUCEApplication {
public:
    const juce::String getApplicationName() override { return "SynthMiniapp"; }
    const juce::String getApplicationVersion() override { return "0.1"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise(const juce::String&) override {
        window_ = std::make_unique<MainWindow>(getApplicationName());
    }

    void shutdown() override { window_.reset(); }
    void systemRequestedQuit() override { quit(); }
    void anotherInstanceStarted(const juce::String&) override {}

private:
    class MainWindow final : public juce::DocumentWindow {
    public:
        explicit MainWindow(juce::String name)
            : DocumentWindow(std::move(name), juce::Colours::black, DocumentWindow::allButtons) {
            setUsingNativeTitleBar(true);
            setContentOwned(new MainComponent(), true);
            centreWithSize(getWidth(), getHeight());
            setVisible(true);
        }

        void closeButtonPressed() override { juce::JUCEApplication::getInstance()->systemRequestedQuit(); }
    };

    std::unique_ptr<MainWindow> window_;
};

} // namespace

START_JUCE_APPLICATION(SynthMiniappApplication)
