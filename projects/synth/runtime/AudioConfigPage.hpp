#pragma once

// synth_runtime::AudioConfigPage — the Audio page hosted by MainPane's
// content host (Plan 4 Task 3). Re-homes the deleted AudioPanel's logic:
// a Back button at the top of the page (binding,
// p4-globals.md), a "System Default" + enumerated-output-device combo, an
// input combo present only when App::Config().numAudioInputs > 0, and two
// status lines: deviceLine_ (current device + negotiated sample rate/block
// size, routine, refreshed every tick) and statusLine_ (the last
// runtime-reported event message, sticky -- see the "Two-line status split"
// comment further down).
//
// This page does not own the JUCE device manager or the engine's
// device-switch logic; Runtime still owns deviceManager_ (it's also the
// AudioIODeviceCallback target) and the actual switch implementation
// (Runtime::ApplyAudioDeviceSelection/ApplyAudioDeviceInputSelection, which
// themselves call the private SwitchOutputDevice -- sar-15 semantics
// unchanged). This page is constructed with a Runtime<App>& and reads
// Runtime::DeviceManager()/GetEngine() directly for enumeration and
// snapshot queries, and calls Runtime::ApplyAudioDeviceSelection/
// ApplyAudioDeviceInputSelection straight from its combo boxes' onChange --
// the same one-implementation-two-callers shape AudioPanel/Runtime used to
// share, just without an intermediate component Runtime has to own.
//
// Runtime has no reference to this page (pages are constructed after
// Runtime, inside MainPane, and can be torn down/rebuilt independently of
// it -- see MainPane.hpp). Instead this page installs two hooks on
// construction, Runtime::SetAudioStatusHook/SetAudioSyncHook (mirroring
// AudioPanel's old onOutputSelected/onInputSelected callback shape, just
// inverted: Runtime calls INTO this page rather than the page calling out),
// and clears both from its destructor so Runtime never calls into a
// destroyed page. Since MainPane owns exactly one AudioConfigPage for the
// whole app lifetime (constructed once, shown/hidden via setVisible -- see
// MainPane::ShowPage), these hooks are installed once and never need
// re-installing.
//
// Combo re-sync (Task 3 brief: "combo re-syncs when the engine's
// audio-device-changed callback fires"): Runtime's OnEngineAudioDeviceChanged
// (Runtime.hpp) calls SyncAudioSelection() after applying a patch-carried
// device change, which invokes this page's installed sync hook -> Refresh(),
// re-enumerating devices and re-selecting the combo entry matching
// engine.AudioDeviceSnapshot() -- the same path a startup patch load or a
// runtime patch revert takes.
//
// Status refresh (Task 3 brief: "status label showing current device +
// negotiated values"): RefreshStatus() reads deviceManager_.getCurrentAudioDevice()
// directly for the negotiated sample rate/block size, called once on
// construction and again every time MainPane's repaint tick reaches this
// page (see MainPane::WriteDeadlineSample's caller, ShellComponent::RepaintAll)
// -- wired via RefreshOnTick(), which MainPane calls unconditionally each
// tick regardless of which page is currently shown, matching FilePage's own
// per-tick patch-name refresh.
//
// Two-line status split (Task 3 review, Important finding: runtime-reported
// event messages -- e.g. "audio device not found: ..." from
// SetAudioStatus() -- were being overwritten before a user could ever read
// them, because SetAudioStatus() is immediately followed by
// SyncAudioSelection() at every call site in Runtime.hpp, which invokes this
// page's sync hook -> Refresh() -> RefreshStatus(), replacing the message
// with the routine negotiated-device text; RefreshOnTick() then re-clobbered
// it every frame). Fixed by splitting the single statusLabel_ into two:
//   - deviceLine_: the routine "current device + negotiated rate/block"
//     text. Owned by RefreshStatus(), refreshed on every Refresh() call and
//     every RefreshOnTick() call -- exactly the old statusLabel_ behavior,
//     just renamed.
//   - statusLine_: the last runtime-reported event message. Owned
//     exclusively by SetStatus() (Runtime's status hook target) and by this
//     page's own user-initiated actions (e.g. a future "switching..."
//     message set directly from a combo onChange). STICKY: RefreshStatus(),
//     Refresh(), and RefreshOnTick() never write to it, so a "device not
//     found" message now survives the SyncAudioSelection() call that
//     follows it and stays visible until the next real event.

#include "synth/AppConcepts.hpp"
#include "synth/Engine.hpp"

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <memory>

namespace synth_runtime {

template <synth::SynthApplication App>
class Runtime;

template <synth::SynthApplication App>
class AudioConfigPage : public juce::Component {
public:
    static constexpr int kSystemDefaultItemId = 1;

    explicit AudioConfigPage(Runtime<App>& runtime) : runtime_(runtime) {
        backButton_.setButtonText("Back");
        backButton_.onClick = [this] {
            if (onBack) {
                onBack();
            }
        };
        addAndMakeVisible(backButton_);

        outputBox_.setTextWhenNoChoicesAvailable("No outputs");
        outputBox_.setTextWhenNothingSelected("Audio output");
        addAndMakeVisible(outputBox_);
        outputBox_.onChange = [this] {
            if (applyingSelection_) {
                return;
            }
            runtime_.ApplyAudioDeviceSelection(SelectedOutputDeviceName());
        };

        // Input combo only when the app actually requests audio input
        // channels (App::Config().numAudioInputs > 0 -- the miniapp
        // requests 0, so this stays absent there). Built once at
        // construction since RuntimeConfig is fixed per-app.
        if (App::Config().numAudioInputs > 0) {
            inputBox_ = std::make_unique<juce::ComboBox>();
            inputBox_->setTextWhenNoChoicesAvailable("No inputs");
            inputBox_->setTextWhenNothingSelected("Audio input");
            inputBox_->onChange = [this] {
                if (applyingSelection_) {
                    return;
                }
                runtime_.ApplyAudioDeviceInputSelection(SelectedInputDeviceName());
            };
            addAndMakeVisible(*inputBox_);
        }

        deviceLine_.setColour(juce::Label::textColourId, juce::Colours::white);
        deviceLine_.setJustificationType(juce::Justification::centredLeft);
        addAndMakeVisible(deviceLine_);

        statusLine_.setColour(juce::Label::textColourId, juce::Colours::white);
        statusLine_.setJustificationType(juce::Justification::centredLeft);
        addAndMakeVisible(statusLine_);

        // Install this page's status/re-sync hooks on Runtime (see the
        // class doc comment) before the first Refresh(), so any status text
        // Runtime already wants to report (e.g. from Start()'s startup
        // preference handling, which ran before this page ever existed) is
        // not silently lost -- SetAudioStatus()/SetStatus() below is purely
        // forward-looking, but installing early keeps the wiring in one
        // obvious place.
        runtime_.SetAudioStatusHook([this](const juce::String& text) { SetStatus(text); });
        runtime_.SetAudioSyncHook([this] { Refresh(); });

        Refresh();
    }

    ~AudioConfigPage() override {
        // Clear both hooks before this page is destroyed so Runtime never
        // calls into a dangling pointer (see the class doc comment).
        runtime_.SetAudioStatusHook({});
        runtime_.SetAudioSyncHook({});
    }

    AudioConfigPage(const AudioConfigPage&) = delete;
    AudioConfigPage& operator=(const AudioConfigPage&) = delete;

    void resized() override {
        auto area = getLocalBounds().reduced(4);
        backButton_.setBounds(area.removeFromTop(32).removeFromLeft(80));
        area.removeFromTop(4);

        const int comboWidth = juce::jmax(120, area.getWidth() / 4);
        auto row = area.removeFromTop(32);
        outputBox_.setBounds(row.removeFromLeft(comboWidth).reduced(4));
        if (inputBox_) {
            inputBox_->setBounds(row.removeFromLeft(comboWidth).reduced(4));
        }

        deviceLine_.setBounds(area.removeFromTop(32).reduced(4));
        statusLine_.setBounds(area.removeFromTop(32).reduced(4));
    }

    // Re-enumerates output (and, when present, input) device names from
    // runtime_.DeviceManager().getCurrentDeviceTypeObject() and repopulates
    // the combo ("System Default" first, empty name, then each enumerated
    // device), then re-syncs the selection to whatever
    // engine.AudioDeviceSnapshot() currently holds, and refreshes the status
    // label. Called on construction, whenever Runtime's sync hook fires (a
    // startup or runtime patch changed the device), and is safe to call at
    // any point -- getCurrentDeviceTypeObject() returning nullptr just
    // yields an output-only/input-only "System Default" entry.
    void Refresh() {
        juce::AudioDeviceManager& deviceManager = runtime_.DeviceManager();

        outputBox_.clear(juce::dontSendNotification);
        outputBox_.addItem("System Default", kSystemDefaultItemId);
        outputNames_.clear();
        if (juce::AudioIODeviceType* deviceType = deviceManager.getCurrentDeviceTypeObject();
            deviceType != nullptr) {
            outputNames_ = deviceType->getDeviceNames(false);
            for (int ix = 0; ix < outputNames_.size(); ++ix) {
                outputBox_.addItem(outputNames_[ix], kSystemDefaultItemId + ix + 1);
            }
        }

        if (inputBox_) {
            inputBox_->clear(juce::dontSendNotification);
            inputBox_->addItem("System Default", kSystemDefaultItemId);
            inputNames_.clear();
            if (juce::AudioIODeviceType* deviceType = deviceManager.getCurrentDeviceTypeObject();
                deviceType != nullptr) {
                inputNames_ = deviceType->getDeviceNames(true);
                for (int ix = 0; ix < inputNames_.size(); ++ix) {
                    inputBox_->addItem(inputNames_[ix], kSystemDefaultItemId + ix + 1);
                }
            }
        }

        SyncSelection();
        RefreshStatus();
    }

    // Re-syncs the combo's selection(s) to
    // engine.AudioDeviceSnapshot().outputDeviceName/inputDeviceName without
    // applying anything (no device switch, no notification). Empty name
    // selects "System Default"; a name not currently enumerated leaves the
    // combo on "System Default" too (statusLine_ is the source of truth for
    // "device not found", set by Runtime via SetStatus() -- and, unlike
    // deviceLine_, is NOT touched by this method or by Refresh()/
    // RefreshOnTick(), so that message stays visible here).
    void SyncSelection() {
        const juce::ScopedValueSetter<bool> guard(applyingSelection_, true);
        const synth::AudioDeviceState state = runtime_.GetEngine().AudioDeviceSnapshot();

        const juce::String wantedOutput = juce::String(state.outputDeviceName);
        if (wantedOutput.isEmpty()) {
            outputBox_.setSelectedId(kSystemDefaultItemId, juce::dontSendNotification);
        } else {
            const int ix = outputNames_.indexOf(wantedOutput);
            outputBox_.setSelectedId(ix >= 0 ? kSystemDefaultItemId + ix + 1 : kSystemDefaultItemId,
                                     juce::dontSendNotification);
        }

        if (inputBox_) {
            const juce::String wantedInput = juce::String(state.inputDeviceName);
            if (wantedInput.isEmpty()) {
                inputBox_->setSelectedId(kSystemDefaultItemId, juce::dontSendNotification);
            } else {
                const int ix = inputNames_.indexOf(wantedInput);
                inputBox_->setSelectedId(ix >= 0 ? kSystemDefaultItemId + ix + 1 : kSystemDefaultItemId,
                                         juce::dontSendNotification);
            }
        }
    }

    // Overwrites statusLine_ with `text` (Runtime's status hook target, e.g.
    // "audio device not found: ..." or "Audio: <name>"). STICKY: this is the
    // only method (besides a future user-initiated action on this page)
    // that writes statusLine_ -- Refresh()/RefreshStatus()/RefreshOnTick()
    // never touch it, so the message stays visible until the next real
    // event, instead of being clobbered by the routine per-tick/per-sync
    // device-line refresh (Task 3 review, Important finding).
    void SetStatus(const juce::String& text) { statusLine_.setText(text, juce::dontSendNotification); }

    // Refreshes deviceLine_ to show the current device's name plus its
    // negotiated sample rate/block size (Task 3 brief: "status label showing
    // current device + negotiated values"), read straight from
    // runtime_.DeviceManager().getCurrentAudioDevice(). Called by Refresh()
    // and by RefreshOnTick() every repaint tick, so the negotiated values
    // stay current even if they change without going through this page's
    // own combo (e.g. the device itself renegotiating). Deliberately never
    // touches statusLine_ (see that field's doc comment) -- this is the
    // routine line, not the event line.
    void RefreshStatus() {
        juce::AudioIODevice* device = runtime_.DeviceManager().getCurrentAudioDevice();
        if (device == nullptr) {
            deviceLine_.setText("No audio device", juce::dontSendNotification);
            return;
        }
        const juce::String text = device->getName() + juce::String(": ") +
                                  juce::String(device->getCurrentSampleRate(), 0) + " Hz, " +
                                  juce::String(device->getCurrentBufferSizeSamples()) + " frames";
        deviceLine_.setText(text, juce::dontSendNotification);
    }

    // Called once per UI timer tick by MainPane (mirrors FilePage's own
    // per-tick patch-name refresh) so the negotiated-values deviceLine_
    // stays current without requiring a combo change. Does not touch
    // statusLine_ (see that field's doc comment) -- the sticky event message
    // must survive repaint ticks, not just a single Refresh() call.
    void RefreshOnTick() { RefreshStatus(); }

    // Back control at the top of the page (binding, p4-globals.md): wired by
    // MainPane to ShowPage(Page::None), returning to the app.
    std::function<void()> onBack;

private:
    // The output device name currently selected in the combo ("" for System
    // Default).
    juce::String SelectedOutputDeviceName() const {
        const int ix = outputBox_.getSelectedId() - kSystemDefaultItemId - 1;
        return ix >= 0 && ix < outputNames_.size() ? outputNames_[ix] : juce::String();
    }

    // The input device name currently selected in the combo ("" for System
    // Default, or if the combo is absent).
    juce::String SelectedInputDeviceName() const {
        if (!inputBox_) {
            return {};
        }
        const int ix = inputBox_->getSelectedId() - kSystemDefaultItemId - 1;
        return ix >= 0 && ix < inputNames_.size() ? inputNames_[ix] : juce::String();
    }

    Runtime<App>& runtime_;

    juce::TextButton backButton_;
    juce::ComboBox outputBox_;
    // Present only when App::Config().numAudioInputs > 0.
    std::unique_ptr<juce::ComboBox> inputBox_;
    // Routine "current device + negotiated rate/block" text, rewritten by
    // RefreshStatus() on every Refresh()/RefreshOnTick() call.
    juce::Label deviceLine_;
    // The last runtime-reported event message (e.g. "audio device not
    // found: ..."), written only by SetStatus() -- STICKY, never touched by
    // Refresh()/RefreshStatus()/RefreshOnTick() (Task 3 review, Important
    // finding: see the class doc comment's "Two-line status split").
    juce::Label statusLine_;
    juce::StringArray outputNames_;
    // Parallel to outputNames_, populated only when inputBox_ exists.
    juce::StringArray inputNames_;

    // Guards SyncSelection()'s setSelectedId(..., dontSendNotification) --
    // belt-and-suspenders against onChange firing re-entrantly; JUCE's
    // dontSendNotification already suppresses onChange, but this also
    // protects a future switch to sendNotificationSync.
    bool applyingSelection_ = false;
};

}  // namespace synth_runtime
