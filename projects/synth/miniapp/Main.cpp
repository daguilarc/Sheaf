#include <juce_gui_extra/juce_gui_extra.h>

#include "DemoModulation.hpp"
#include "EncoderComponent.hpp"
#include "MidiHandlers.hpp"
#include "WaveformComponents.hpp"
#include "synth/MidiController.hpp"
#include "synth/Modules.hpp"
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
        auto& group = manager_.CreateGroup({
            .numVoices = 2,
            .numModulators = 3,
            .numScenes = 3,
            .maxParameters = 24,
            .processLiteAlpha = 1.0f,
            .voiceIndicatorColors = {synth::Color::Cyan, synth::Color::Orange},
        });
        group_ = &group;
        manager_.GestureMetadataAt(0).name = "Gesture 1";
        manager_.GestureMetadataAt(0).color = synth::Color::Orange;
        vcoModule_.RegisterParameters(manager_, group);
        vcoModule_.RegisterModulationSources(group, 0, 1);
        std::array<float*, 2> lfoSources{&lfoModulators_[0], &lfoModulators_[1]};
        group.SetModulationSource(2, lfoSources, {
                                                   .name = "Sine LFO",
                                                   .shortName = "LFO",
                                                   .color = synth::Color::Green,
                                                   .connected = true,
                                               });
        tune_ = &manager_.ParameterById(vcoModule_.Parameters().tune);
        shape_ = &manager_.ParameterById(vcoModule_.Parameters().shape);
        phaseParam_ = &manager_.ParameterById(vcoModule_.Parameters().phase);
        volume_ = &manager_.ParameterById(vcoModule_.Parameters().volume);
        lfoSpeed_ = &manager_.CreateParameter(group, {.name = "LFO Speed", .shortName = "Spd", .defaultValue = 0.35f, .color = synth::Color::Green});
        parameters_ = {tune_, phaseParam_, shape_, volume_, lfoSpeed_};
        for (synth::Parameter* parameter : std::array<synth::Parameter*, 5>{tune_, phaseParam_, shape_, volume_, lfoSpeed_}) {
            createModulationDepths(group, *parameter);
        }
        tune_->SetGestureActive(0, 0, true);
        tune_->SetGestureActive(1, 0, true);

        auto& vcoPage = manager_.CreatePage("VCO");
        manager_.AssignParameterToPage(vcoPage.ordinal, *tune_);
        manager_.AssignParameterToPage(vcoPage.ordinal, *phaseParam_);
        manager_.AssignParameterToPage(vcoPage.ordinal, *shape_);
        manager_.AssignParameterToPage(vcoPage.ordinal, *volume_);
        auto& lfoPage = manager_.CreatePage("LFO");
        manager_.AssignParameterToPage(lfoPage.ordinal, *lfoSpeed_);

        vcoBank_ = &manager_.CreateBank();
        vcoBank_->SetColor(synth::Color::Cyan);
        lfoBank_ = &manager_.CreateBank();
        lfoBank_->SetColor(synth::Color::Green);
        lfoBank_->AddMapping(10, *lfoSpeed_);
        slot_ = &manager_.CreateBankSlot();
        for (auto encoder : {10u, 11u, 12u, 13u}) {
            slot_->AddPhysicalEncoder(encoder);
        }
        slot_->SelectBank(vcoBank_);
        vcoModule_.RegisterToBank(*vcoBank_, 0);
        manager_.SetActivePage(0);
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
            encoders_[ix].SetModulatorColors({synth::Color::Cyan, synth::Color::Orange, synth::Color::Green});
            encoders_[ix].SetGestureColors({synth::Color::Orange});
        }

        scopeHolders_[0] = scopeWriter_.ReserveChans(1);
        scopeHolders_[1] = scopeWriter_.ReserveChans(1);
        vcoModule_.SetScopeWriterHolder(0, &scopeHolders_[0]);
        vcoModule_.SetScopeWriterHolder(1, &scopeHolders_[1]);
        vcoModule_.SetColor(0, synth::Color::Cyan);
        vcoModule_.SetColor(1, synth::Color::Orange);
        waveformComponent_.SetUIStates(vcoUiStatePointers_);
        addAndMakeVisible(waveformComponent_);

        addButton(bankAButton_, "VCO", [this] { selectPage(0); });
        addButton(bankBButton_, "LFO", [this] { selectPage(1); });
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

        setSize(900, 560);
        startTimerHz(30);
    }

    ~MainComponent() override {
        stopTimer();
        midiInHandler_.Close();
        midiInHandler_.SetProcessor(nullptr);
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
            encoder.setBounds(encoderRow.removeFromLeft(132).reduced(10));
        }
        waveformComponent_.setBounds(encoderRow.reduced(8));
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
        const int comboWidth = juce::jmax(120, midi.getWidth() / 4);
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

    void selectPage(std::size_t pageIx) {
        manager_.SelectBankForSlot(0, pageIx);
        manager_.SetActivePage(static_cast<synth::PageOrdinal>(pageIx));
    }

    void createModulationDepths(synth::ParameterGroup& group, synth::Parameter& target) {
        for (std::size_t modIx = 0; modIx < group.Config().numModulators; ++modIx) {
            const auto& modulator = group.GetModulators().Metadata(modIx);
            target.EnsureModulationDepth(modIx, {
                .name = target.Name() + " " + modulator.name,
                .shortName = modulator.shortName,
                .defaultValue = 0.0f,
                .range = synth::RangeKind::Bipolar,
                .color = modulator.color,
            });
        }
    }

    void configureMidiControls() {
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
        midiInHandler_.SetProcessor(nullptr);
        synth::WrldBldrDefaultProfileOptions options;
        options.visibleEncoderCount = encoders_.size();
        options.sceneCount = 3;
        options.bankButtonCount = 16;
        options.gestureSelectorCount = 1;
        midiProfile_ =
            synth::CreateWrldBldrDefaultProfile(options, &midiBus_, &midiSender_, uiState_.get(), [] { return 0; });
        midiInHandler_.SetProcessor(std::move(midiProfile_.input));
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
        if (identifier.isNotEmpty() && midiOutputHandler_.Open(identifier)) {
            for (auto& output : midiProfile_.outputs) {
                output->Reset();
            }
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
        const std::uint64_t processTimestamp = nextTimestamp_++;
        bus_.Process(processTimestamp);
        midiBus_.Process(processTimestamp);
        manager_.SetActivePage(slot_->SelectedBank() == lfoBank_ ? 1 : 0);
        for (synth::Parameter* parameter : parameters_) {
            parameter->Compute(manager_.Scene());
        }
        processDspFrame();
        manager_.PopulateUIState(*uiState_);
        if (midiOutputHandler_.IsOpen()) {
            for (auto& output : midiProfile_.outputs) {
                output->Process();
            }
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
        waveformComponent_.repaint();
    }

    void processDspFrame() {
        constexpr std::size_t blockSize = 256;
        for (std::size_t sampleIx = 0; sampleIx < blockSize; ++sampleIx) {
            synth_miniapp::ProcessLiteParameters(parameters_);
            vcoModule_.SetInput(manager_);
            vcoModule_.Process();
            scopeWriter_.AdvanceIndex();
            phase_ += synth_miniapp::LfoPhaseStep(lfoSpeed_->Get(0));
            lfoModulators_[0] = synth_miniapp::UnipolarSineModulator(phase_);
            lfoModulators_[1] =
                synth_miniapp::UnipolarSineModulator(phase_, juce::MathConstants<float>::halfPi);
            manager_.UpdateModValues(*group_);
        }
        scopeWriter_.Publish();

        vcoModule_.PopulateUIState(vcoUiStates_);
    }

    synth::ParameterManager manager_;
    synth::MessageInBus bus_{&manager_};
    synth::MessageInBus midiBus_{&manager_};
    synth::ParameterGroup* group_ = nullptr;
    synth::Parameter* tune_ = nullptr;
    synth::Parameter* phaseParam_ = nullptr;
    synth::Parameter* shape_ = nullptr;
    synth::Parameter* volume_ = nullptr;
    synth::Parameter* lfoSpeed_ = nullptr;
    std::vector<synth::Parameter*> parameters_;
    synth::Bank* vcoBank_ = nullptr;
    synth::Bank* lfoBank_ = nullptr;
    synth::BankSlot* slot_ = nullptr;
    std::unique_ptr<synth::ParameterManager::UIState> uiState_;
    std::array<synth_juce::EncoderComponent, 4> encoders_;
    synth::ScopeWriter scopeWriter_{2, 4096};
    std::array<synth::ScopeWriterHolder, 2> scopeHolders_;
    synth::DualWavetableVcoModule vcoModule_;
    synth::DualWavetableVcoModule::UIState vcoUiStates_;
    std::array<synth::DefaultWavetableVco::UIState*, 2> vcoUiStatePointers_{
        {&vcoUiStates_.vcos[0], &vcoUiStates_.vcos[1]}};
    synth_juce::VcoWaveformComponent waveformComponent_;
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
    synth::MidiControllerProfileResult midiProfile_;
    std::uint64_t nextTimestamp_ = 1;
    float phase_ = 0.0f;
    std::array<float, 2> lfoModulators_{};
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
