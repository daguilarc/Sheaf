#include <juce_gui_extra/juce_gui_extra.h>

#include "DemoModulation.hpp"
#include "EncoderComponent.hpp"
#include "MidiHandlers.hpp"
#include "synth/MidiController.hpp"
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
        groupA.GetModulators().Metadata(0).shortName = "LFO";
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
        groupB.GetModulators().Metadata(0).shortName = "Tri";
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
        midiBus_.SetManager(&manager_);
        midiSender_.SetSink(&midiOutputHandler_);
        midiSender_.Start();

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

        configureMidiControls();
        rebuildMidiProcessors();

        setSize(820, 460);
        startTimerHz(30);
    }

    ~MainComponent() override {
        stopTimer();
        midiInHandler_.Close();
        midiOutputHandler_.Close();
        midiSender_.Stop();
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
        auto midi = area.removeFromTop(96).reduced(4);
        const int comboWidth = juce::jmax(120, midi.getWidth() / 5);
        controllerPresetBox_.setBounds(midi.removeFromLeft(comboWidth).reduced(4));
        refreshMidiButton_.setBounds(midi.removeFromLeft(74).reduced(4));
        midiInputBox_.setBounds(midi.removeFromLeft(comboWidth).reduced(4));
        openInputButton_.setBounds(midi.removeFromLeft(82).reduced(4));
        midiOutputBox_.setBounds(midi.removeFromLeft(comboWidth).reduced(4));
        openOutputButton_.setBounds(midi.removeFromLeft(82).reduced(4));
        midiStatusLabel_.setBounds(midi.reduced(4));
    }

private:
    void addButton(juce::TextButton& button, const juce::String& text, std::function<void()> callback) {
        button.setButtonText(text);
        button.onClick = std::move(callback);
        addAndMakeVisible(button);
    }

    enum class ControllerPreset {
        Twister,
        WrldBldr,
    };

    ControllerPreset selectedPreset() const {
        return controllerPresetBox_.getSelectedId() == 2 ? ControllerPreset::WrldBldr : ControllerPreset::Twister;
    }

    void configureMidiControls() {
        controllerPresetBox_.addItem("Twister", 1);
        controllerPresetBox_.addItem("Wrld.Bldr", 2);
        controllerPresetBox_.setSelectedId(1, juce::dontSendNotification);
        controllerPresetBox_.onChange = [this] { rebuildMidiProcessors(); };
        addAndMakeVisible(controllerPresetBox_);

        refreshMidiButton_.setButtonText("Refresh");
        refreshMidiButton_.onClick = [this] { refreshMidiDevices(); };
        addAndMakeVisible(refreshMidiButton_);

        midiInputBox_.setTextWhenNoChoicesAvailable("No inputs");
        midiInputBox_.setTextWhenNothingSelected("MIDI input");
        addAndMakeVisible(midiInputBox_);

        midiOutputBox_.setTextWhenNoChoicesAvailable("No outputs");
        midiOutputBox_.setTextWhenNothingSelected("MIDI output");
        addAndMakeVisible(midiOutputBox_);

        openInputButton_.onClick = [this] { toggleMidiInput(); };
        addAndMakeVisible(openInputButton_);
        openOutputButton_.onClick = [this] { toggleMidiOutput(); };
        addAndMakeVisible(openOutputButton_);

        midiStatusLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
        midiStatusLabel_.setJustificationType(juce::Justification::centredLeft);
        addAndMakeVisible(midiStatusLabel_);

        refreshMidiDevices();
        updateMidiStatus();
    }

    void refreshMidiDevices() {
        midiInputDevices_ = synth_juce::MidiInHandler::AvailableDevices();
        midiOutputDevices_ = synth_juce::MidiOutputHandler::AvailableDevices();

        midiInputBox_.clear(juce::dontSendNotification);
        for (int ix = 0; ix < midiInputDevices_.size(); ++ix) {
            midiInputBox_.addItem(midiInputDevices_[ix].name, ix + 1);
        }
        if (midiInputDevices_.size() > 0 && midiInputBox_.getSelectedId() == 0) {
            midiInputBox_.setSelectedId(1, juce::dontSendNotification);
        }

        midiOutputBox_.clear(juce::dontSendNotification);
        for (int ix = 0; ix < midiOutputDevices_.size(); ++ix) {
            midiOutputBox_.addItem(midiOutputDevices_[ix].name, ix + 1);
        }
        if (midiOutputDevices_.size() > 0 && midiOutputBox_.getSelectedId() == 0) {
            midiOutputBox_.setSelectedId(1, juce::dontSendNotification);
        }

        updateMidiStatus();
    }

    void rebuildMidiProcessors() {
        synth::EncoderMidiInConfig inputConfig = selectedPreset() == ControllerPreset::WrldBldr
                                                     ? synth::EncoderMidiInConfig::WrldBldrDefault(0)
                                                     : synth::EncoderMidiInConfig::TwisterDefault(0);
        inputConfig.KeepFirstPositions(encoders_.size());
        auto inputProcessor = std::make_unique<synth::EncoderMidiInProcessor>(std::move(inputConfig), &midiBus_);
        inputProcessor->SetTimestampProvider([] { return 0; });
        midiInHandler_.SetProcessor(std::move(inputProcessor));

        synth::EncoderMidiOutConfig outputConfig = selectedPreset() == ControllerPreset::WrldBldr
                                                      ? synth::EncoderMidiOutConfig::WrldBldrDefault(0)
                                                      : synth::EncoderMidiOutConfig::TwisterDefault(0);
        outputConfig.KeepFirstPositions(encoders_.size());
        if (selectedPreset() == ControllerPreset::WrldBldr) {
            midiOutProcessor_ =
                std::make_unique<synth::WrldBldrMidiOutProcessor>(std::move(outputConfig), &midiSender_, uiState_.get());
        } else {
            midiOutProcessor_ =
                std::make_unique<synth::TwisterMidiOutProcessor>(std::move(outputConfig), &midiSender_, uiState_.get());
        }
    }

    juce::String selectedInputIdentifier() const {
        const int selectedId = midiInputBox_.getSelectedId();
        const int ix = selectedId - 1;
        return ix >= 0 && ix < midiInputDevices_.size() ? midiInputDevices_[ix].identifier : juce::String();
    }

    juce::String selectedOutputIdentifier() const {
        const int selectedId = midiOutputBox_.getSelectedId();
        const int ix = selectedId - 1;
        return ix >= 0 && ix < midiOutputDevices_.size() ? midiOutputDevices_[ix].identifier : juce::String();
    }

    void toggleMidiInput() {
        if (midiInHandler_.IsOpen()) {
            midiInHandler_.Close();
            updateMidiStatus();
            return;
        }
        rebuildMidiProcessors();
        const juce::String identifier = selectedInputIdentifier();
        if (identifier.isNotEmpty()) {
            midiInHandler_.Open(identifier);
        }
        updateMidiStatus();
    }

    void toggleMidiOutput() {
        if (midiOutputHandler_.IsOpen()) {
            midiOutputHandler_.Close();
            updateMidiStatus();
            return;
        }
        const juce::String identifier = selectedOutputIdentifier();
        if (identifier.isNotEmpty() && midiOutputHandler_.Open(identifier) && midiOutProcessor_ != nullptr) {
            midiOutProcessor_->Reset();
        }
        updateMidiStatus();
    }

    void updateMidiStatus() {
        openInputButton_.setButtonText(midiInHandler_.IsOpen() ? "Close In" : "Open In");
        openOutputButton_.setButtonText(midiOutputHandler_.IsOpen() ? "Close Out" : "Open Out");
        juce::String status = midiInHandler_.IsOpen() ? "In " + midiInHandler_.DeviceName() : "In closed";
        status += " / ";
        status += midiOutputHandler_.IsOpen() ? "Out " + midiOutputHandler_.DeviceName() : "Out closed";
        if (midiInHandler_.LastError().isNotEmpty()) {
            status += " / " + midiInHandler_.LastError();
        }
        if (midiOutputHandler_.LastError().isNotEmpty()) {
            status += " / " + midiOutputHandler_.LastError();
        }
        midiStatusLabel_.setText(status, juce::dontSendNotification);
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
        const std::uint64_t processTimestamp = nextTimestamp_++;
        bus_.Process(processTimestamp);
        midiBus_.Process(processTimestamp);
        for (synth::Parameter* parameter : parameters_) {
            parameter->Compute(manager_.Scene());
            parameter->ProcessLite();
        }
        manager_.PopulateUIState(*uiState_);
        if (midiOutputHandler_.IsOpen() && midiOutProcessor_ != nullptr) {
            midiOutProcessor_->Process();
        }
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
    synth::MessageInBus midiBus_{&manager_};
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
    juce::ComboBox controllerPresetBox_;
    juce::ComboBox midiInputBox_;
    juce::ComboBox midiOutputBox_;
    juce::TextButton refreshMidiButton_;
    juce::TextButton openInputButton_;
    juce::TextButton openOutputButton_;
    juce::Label midiStatusLabel_;
    juce::Array<juce::MidiDeviceInfo> midiInputDevices_;
    juce::Array<juce::MidiDeviceInfo> midiOutputDevices_;
    synth_juce::MidiInHandler midiInHandler_;
    synth_juce::MidiOutputHandler midiOutputHandler_;
    synth::MidiSender midiSender_;
    std::unique_ptr<synth::MidiOutProcessor> midiOutProcessor_;
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
