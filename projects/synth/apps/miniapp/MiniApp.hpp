#pragma once

// synth_miniapp::MiniApp — the JUCE-facing UI wrapper around MiniAppCore
// (Plan 3 Task 6), satisfying synth::SynthApplication so it can run under
// synth_runtime::Runtime/ShellComponent (runtime/Runtime.hpp,
// runtime/Shell.hpp).
//
// This header ports the OLD MainComponent's (projects/synth/miniapp/Main.cpp,
// pre-swap) bespoke widgets: seven EncoderComponents, the VCO waveform scope,
// page/bank buttons, the gesture select button + value slider, three scene
// buttons + blend slider, reset/random modifier latches, and start/stop
// buttons. What it
// deliberately does NOT port:
//
//   - Patch buttons (New/Save/Save As/Load/Revert) and the patch status
//     label: synth_runtime::ShellComponent already provides these, wired
//     straight to Runtime's patch methods (spm-37 delta).
//   - MIDI device combo boxes / open-close buttons / status label:
//     synth_runtime::MidiPanel already provides these, hosted by
//     ShellComponent alongside this app's UIComponent() (Task 3).
//   - appendPatchLog/patchLogPath/logPatchCommand and any other ofstream
//     patch-log file: the runtime INFO-logs every patch command result
//     itself (Runtime::LogPatchCommand); no app code writes a log file
//     (slog-7). There is no std::ofstream anywhere in this file.
//
// Threading: this component lives entirely on the message thread (it is a
// juce::Component owned by the shell). It never touches
// context->parameterManager directly -- all control lives in MessageIn
// values pushed onto context->uiBus (message-thread producer, audio-thread
// consumer per AppContext.hpp's thread-role comment) and all rendering
// reads context->uiState atomics (populated by the engine's audio-thread
// PopulateUIState, per Engine.hpp's ProcessBlock binding order). The one
// piece of control logic that DOES touch parameterManager directly --
// following the selected bank with SetActivePage -- lives in
// MiniAppCore::ProcessBlock instead, on the audio thread once running (see
// MiniAppCore.hpp's comment on that), not here.
//
// synth::Color -> juce::Colour conversion is confined to this file (and the
// synth_juce:: widget headers it includes), matching the project convention
// that core synth code stays JUCE-free (see projects/synth/README.md's
// "External UI State And Messages" section).

#include "MiniAppCore.hpp"

#include "EncoderComponent.hpp"
#include "WaveformComponents.hpp"

#include "synth/AppContext.hpp"
#include "synth/ParameterModulation.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <array>
#include <cstdint>
#include <functional>

namespace synth_miniapp {

struct EncoderGridLayout {
    static constexpr std::size_t kEncoderCount = 7;
    static constexpr std::size_t kFirstRowCount = 4;
    static constexpr int kColumnWidth = 132;
    static constexpr int kRowHeight = 150;
    static constexpr int kTotalHeight = kRowHeight * 2;
    static constexpr int kInset = 10;

    static juce::Rectangle<int> BoundsForIndex(juce::Rectangle<int> area, std::size_t index) {
        const std::size_t row = index < kFirstRowCount ? 0 : 1;
        const std::size_t column = row == 0 ? index : index - kFirstRowCount;
        return juce::Rectangle<int>(area.getX() + static_cast<int>(column) * kColumnWidth,
                                    area.getY() + static_cast<int>(row) * kRowHeight, kColumnWidth, kRowHeight)
            .reduced(kInset);
    }
};

class MiniApp : public MiniAppCore {
public:
    juce::Component& UIComponent() { return ui_; }

    void Init(synth::AppContext* context) {
        MiniAppCore::Init(context);
        ui_.Attach(context, this);
    }

private:
    // The bespoke widget tree, ported verbatim (layout/behavior) from the
    // old MainComponent, minus patch buttons and MIDI controls (now owned
    // by the runtime shell/MidiPanel).
    class Ui final : public juce::Component {
    public:
        Ui() {
            for (auto& encoder : encoders_) {
                addAndMakeVisible(encoder);
                encoder.SetTimestampProvider([this] { return NowMicros(); });
                encoder.SetModulatorColors({synth::Color::Cyan, synth::Color::Orange, synth::Color::Green});
                encoder.SetGestureColors({synth::Color::Orange});
            }

            addAndMakeVisible(waveformComponent_);
            addAndMakeVisible(lfoWaveformComponent_);

            AddButton(bankAButton_, "VCO", [this] { SelectPage(0); });
            AddButton(bankBButton_, "LFO", [this] { SelectPage(1); });
            AddButton(gestureButton_, "Gesture", [this] {
                PushMessage(synth::MessageIn::ToggleGestureSelect(NowMicros(), 0));
            });
            AddButton(sceneAButton_, "S1", [this] { PushMessage(synth::MessageIn::SceneSelect(NowMicros(), 0)); });
            AddButton(sceneBButton_, "S2", [this] { PushMessage(synth::MessageIn::SceneSelect(NowMicros(), 1)); });
            AddButton(sceneCButton_, "S3", [this] { PushMessage(synth::MessageIn::SceneSelect(NowMicros(), 2)); });
            AddButton(resetButton_, "Reset", [this] { PushMessage(synth::MessageIn::ToggleReset(NowMicros())); });
            AddButton(randomButton_, "Random", [this] { PushMessage(synth::MessageIn::ToggleRandom(NowMicros())); });
            AddButton(randomModButton_, "Random Mod", [this] {
                PushMessage(synth::MessageIn::ToggleRandomMod(NowMicros()));
            });
            AddButton(startButton_, "Start", [this] { PushMessage(synth::MessageIn::Start(NowMicros())); });
            AddButton(stopButton_, "Stop", [this] { PushMessage(synth::MessageIn::Stop(NowMicros())); });

            gestureSlider_.setRange(0.0, 1.0, 0.001);
            gestureSlider_.onValueChange = [this] {
                PushMessage(synth::MessageIn::SetGestureValue(NowMicros(), 0,
                                                               static_cast<float>(gestureSlider_.getValue())));
            };
            addAndMakeVisible(gestureSlider_);

            blendSlider_.setRange(0.0, 1.0, 0.001);
            blendSlider_.onValueChange = [this] {
                PushMessage(synth::MessageIn::SetSceneBlend(NowMicros(), static_cast<float>(blendSlider_.getValue())));
            };
            addAndMakeVisible(blendSlider_);
        }

        // Called once from MiniApp::Init(), after MiniAppCore::Init() has
        // built the parameter/bank/scope topology, so context->uiState,
        // the encoder bindings, and the waveform component's UI-state
        // pointers can all be wired up.
        void Attach(synth::AppContext* context, MiniAppCore* core) {
            context_ = context;

            for (std::size_t ix = 0; ix < encoders_.size(); ++ix) {
                encoders_[ix].BindMessages(context_->uiBus, 0, ix);
            }

            MiniAppCore::VcoModule::UIState& vcoUiState = core->VcoUiState();
            waveformUiStates_ = {&vcoUiState.vcos[0], &vcoUiState.vcos[1]};
            waveformComponent_.SetUIStates(waveformUiStates_);
            MiniAppCore::LfoModule::UIState& lfoUiState = core->LfoUiState();
            lfoWaveformUiStates_ = {&lfoUiState.lfos[0], &lfoUiState.lfos[1]};
            lfoWaveformComponent_.SetUIStates(lfoWaveformUiStates_);

            setSize(context_->config->uiWidth, context_->config->uiHeight);
        }

        // Reads context->uiState (populated once per audio block by the
        // engine's PopulateUIState -- see Engine.hpp's ProcessBlock binding
        // order) and updates button toggle states / labels / encoder
        // bindings accordingly. Ported from the old MainComponent's
        // timerCallback UI-refresh steps (everything after
        // processDspFrame()), minus the MIDI-output/patch-message steps that
        // moved into the runtime. Called once per shell repaint tick (see
        // paint()) rather than from its own juce::Timer: the shell already
        // drives one timer per frame (Runtime::Start()'s uiFrameHz), and
        // this component's repaint is invoked from that same tick via
        // ShellComponent::RepaintAll() -> runtime_.AppComponent().repaint()
        // -> this Component's paint().
        void RefreshFromUIState() {
            if (context_ == nullptr || context_->uiState == nullptr) {
                return;
            }
            const synth::ParameterManager::UIState& uiState = *context_->uiState;

            const bool gestureSelected =
                uiState.gestures.gestureCapacity > 0 && uiState.gestures.selected[0].load(std::memory_order_relaxed);
            const synth::Color gestureColor = uiState.gestures.gestureCapacity > 0
                                                  ? uiState.gestures.colors[0].Load(std::memory_order_relaxed)
                                                  : synth::Color::Orange;
            SetButtonLit(gestureButton_, gestureSelected, ToJuce(gestureColor));
            SetButtonLit(resetButton_, uiState.resetHeld.load(std::memory_order_relaxed), juce::Colour(238, 226, 95));
            SetButtonLit(randomButton_, uiState.randomHeld.load(std::memory_order_relaxed),
                         juce::Colour(129, 214, 178));
            SetButtonLit(randomModButton_, uiState.randomModHeld.load(std::memory_order_relaxed),
                         juce::Colour(191, 159, 255));

            const std::size_t leftScene = uiState.leftScene.load(std::memory_order_relaxed);
            const std::size_t rightScene = uiState.rightScene.load(std::memory_order_relaxed);
            UpdateSceneButton(sceneAButton_, 0, leftScene, rightScene);
            UpdateSceneButton(sceneBButton_, 1, leftScene, rightScene);
            UpdateSceneButton(sceneCButton_, 2, leftScene, rightScene);

            for (std::size_t ix = 0; ix < encoders_.size(); ++ix) {
                encoders_[ix].Bind(&uiState.slots[0].cells[ix]);
            }
        }

        void paint(juce::Graphics& g) override {
            RefreshFromUIState();
            g.fillAll(juce::Colour(24, 26, 28));
            g.setColour(juce::Colours::white);
            g.setFont(16.0f);
            g.drawFittedText("Synth Params", getLocalBounds().removeFromTop(28), juce::Justification::centred, 1);
        }

        void resized() override {
            auto area = getLocalBounds().reduced(16);
            area.removeFromTop(32);
            auto encoderArea = area.removeFromTop(EncoderGridLayout::kTotalHeight);
            for (std::size_t ix = 0; ix < encoders_.size(); ++ix) {
                encoders_[ix].setBounds(EncoderGridLayout::BoundsForIndex(encoderArea, ix));
            }
            auto waveformRow = area.removeFromTop(130);
            waveformComponent_.setBounds(waveformRow.removeFromLeft(waveformRow.getWidth() / 2).reduced(8));
            lfoWaveformComponent_.setBounds(waveformRow.reduced(8));
            auto controls = area.removeFromTop(92);
            auto modifierRow = controls.removeFromTop(46);
            std::array<juce::TextButton*, 6> modifierButtons{
                &bankAButton_, &bankBButton_, &gestureButton_, &resetButton_, &randomButton_, &randomModButton_,
            };
            const int modifierButtonWidth = modifierRow.getWidth() / static_cast<int>(modifierButtons.size());
            for (auto* button : modifierButtons) {
                button->setBounds(modifierRow.removeFromLeft(modifierButtonWidth).reduced(4));
            }
            auto systemRow = controls.removeFromTop(46);
            std::array<juce::TextButton*, 5> systemButtons{
                &sceneAButton_, &sceneBButton_, &sceneCButton_, &startButton_, &stopButton_,
            };
            const int systemButtonWidth = systemRow.getWidth() / static_cast<int>(systemButtons.size());
            for (auto* button : systemButtons) {
                button->setBounds(systemRow.removeFromLeft(systemButtonWidth).reduced(4));
            }
            auto sliders = area.removeFromTop(80);
            gestureSlider_.setBounds(sliders.removeFromLeft(getWidth() / 2 - 24).reduced(8));
            blendSlider_.setBounds(sliders.reduced(8));
        }

    private:
        void AddButton(juce::TextButton& button, const juce::String& text, std::function<void()> callback) {
            button.setButtonText(text);
            button.onClick = std::move(callback);
            addAndMakeVisible(button);
        }

        void PushMessage(const synth::MessageIn& message) {
            if (context_ != nullptr && context_->uiBus != nullptr) {
                context_->uiBus->Push(message);
            }
        }

        // Selecting a page/bank button pushes a SelectParamBank message onto
        // uiBus so the bank swap happens on the audio thread, alongside the
        // manager mutations MessageInBus::Process performs for every other
        // message (see AppContext.hpp's thread-role comment: manager access
        // is audio-thread-owned once running). MiniAppCore::ProcessBlock
        // then keeps the active page in sync with whichever bank ends up
        // selected (see its comment for why that step lives there too).
        void SelectPage(std::size_t pageIx) {
            PushMessage(synth::MessageIn::SelectParamBank(NowMicros(), 0, pageIx));
        }

        static juce::Colour ToJuce(synth::Color color) { return juce::Colour(color.r, color.g, color.b, color.a); }

        static void SetButtonLit(juce::TextButton& button, bool lit, juce::Colour litColour) {
            button.setColour(juce::TextButton::buttonColourId, lit ? litColour : juce::Colour(44, 46, 48));
            button.setColour(juce::TextButton::buttonOnColourId, litColour.brighter(0.1f));
            button.setColour(juce::TextButton::textColourOffId, lit ? juce::Colours::black : juce::Colours::white);
            button.setColour(juce::TextButton::textColourOnId, juce::Colours::black);
        }

        void UpdateSceneButton(juce::TextButton& button, std::size_t sceneIx, std::size_t leftScene,
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
                SetButtonLit(button, true, juce::Colour(92, 214, 120));
            } else if (isLeft) {
                SetButtonLit(button, true, juce::Colour(98, 172, 255));
            } else if (isRight) {
                SetButtonLit(button, true, juce::Colour(255, 180, 86));
            } else {
                SetButtonLit(button, false, juce::Colour(44, 46, 48));
            }
        }

        // Timestamp for messages pushed onto context_->uiBus, sourced from
        // context_->now -- the same TimestampProvider passed to the owning
        // synth::Engine<App>'s constructor (Runtime.hpp's NowMicros() under
        // the JUCE shell, SynthRig's NextTimestamp() under the headless test
        // rig; see AppContext.hpp's doc comment on `now`). Reusing it here
        // means UI-pushed messages and the engine's own uiBus_.Process()
        // timestamp share one clock instead of two independently-running
        // ones. Falls back to a local monotonic counter only if `now` is
        // unset (defensive; every production Engine<App> sets it).
        std::uint64_t NowMicros() const {
            if (context_ != nullptr && context_->now) {
                return context_->now();
            }
            return fallbackTimestamp_++;
        }

        synth::AppContext* context_ = nullptr;
        mutable std::uint64_t fallbackTimestamp_ = 1;

        std::array<synth_juce::EncoderComponent, 7> encoders_;
        synth_juce::VcoWaveformComponent waveformComponent_;
        synth_juce::LfoWaveformComponent lfoWaveformComponent_;
        std::array<synth::DefaultWavetableVco::UIState*, 2> waveformUiStates_{};
        std::array<synth::BasicLFOProcessor::UIState*, 2> lfoWaveformUiStates_{};

        juce::TextButton bankAButton_;
        juce::TextButton bankBButton_;
        juce::TextButton gestureButton_;
        juce::TextButton sceneAButton_;
        juce::TextButton sceneBButton_;
        juce::TextButton sceneCButton_;
        juce::TextButton resetButton_;
        juce::TextButton randomButton_;
        juce::TextButton randomModButton_;
        juce::TextButton startButton_;
        juce::TextButton stopButton_;
        juce::Slider gestureSlider_;
        juce::Slider blendSlider_;
    };

    Ui ui_;
};

}  // namespace synth_miniapp
