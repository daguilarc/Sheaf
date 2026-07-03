#pragma once

// synth_runtime::FilePage — the File page hosted by MainPane's content host
// (Plan 4 Task 3). Re-homes the patch-command chrome row deleted from
// Shell.hpp in commit 2ec3f2f (see `git show 2ec3f2f^:projects/synth/runtime/Shell.hpp`
// for the reference implementation this was lifted from): a Back button at
// the top of the page (binding, p4-globals.md), New/Save/Save As/Load/Revert
// buttons wired straight to Runtime's patch methods, a patch-name label
// showing the current patch's directory name (or "(no patch)"), and a
// status label reflecting the last patch command's result.
//
// Save->SaveAs fallthrough (sar-16, preserved verbatim from the deleted
// chrome): dispatching SavePatch() with no current patch directory is
// doomed to come back NeedsSaveAsPath, so saveButton_'s handler checks
// runtime_.GetEngine().Patches().CurrentPatchDirectory().has_value() first
// and opens the Save As chooser directly instead when it's unset.
//
// Patch identity (sar-16): the patch-name label reads
// runtime_.GetEngine().Patches().CurrentPatchDirectory() -- the
// message-side PatchManager's own state -- every call, never cached here or
// touched audio-side, refreshed once per UI timer tick via RefreshOnTick()
// (MainPane calls this unconditionally every tick, mirroring
// AudioConfigPage's own per-tick status refresh).
//
// FileChooser lifetime (async idiom, unchanged from the deleted chrome):
// juce::FileChooser::launchAsync requires the chooser object to stay alive
// for the duration of the operation, so it's held in a member unique_ptr,
// recreated on each launch (destroying any previous, already-completed
// chooser).

#include "synth/AppConcepts.hpp"
#include "synth/Engine.hpp"
#include "synth/PatchPersistence.hpp"

#include <juce_gui_extra/juce_gui_extra.h>

#include <functional>
#include <memory>

namespace synth_runtime {

template <synth::SynthApplication App>
class Runtime;

template <synth::SynthApplication App>
class FilePage : public juce::Component {
public:
    explicit FilePage(Runtime<App>& runtime) : runtime_(runtime) {
        backButton_.setButtonText("Back");
        backButton_.onClick = [this] {
            if (onBack) {
                onBack();
            }
        };
        addAndMakeVisible(backButton_);

        newButton_.setButtonText("New");
        newButton_.onClick = [this] {
            runtime_.NewPatch();
            SetStatus("New patch created");
        };
        addAndMakeVisible(newButton_);

        saveButton_.setButtonText("Save");
        saveButton_.onClick = [this] {
            // Falls through to the Save As chooser when no patch is current
            // (sar-16, preserved verbatim from the deleted chrome): see the
            // class doc comment above.
            if (runtime_.GetEngine().Patches().CurrentPatchDirectory().has_value()) {
                runtime_.SavePatch();
                SetStatus("Save requested");
            } else {
                LaunchSaveAsChooser();
            }
        };
        addAndMakeVisible(saveButton_);

        saveAsButton_.setButtonText("Save As");
        saveAsButton_.onClick = [this] { LaunchSaveAsChooser(); };
        addAndMakeVisible(saveAsButton_);

        loadButton_.setButtonText("Load");
        loadButton_.onClick = [this] { LaunchLoadChooser(); };
        addAndMakeVisible(loadButton_);

        revertButton_.setButtonText("Revert");
        revertButton_.onClick = [this] {
            runtime_.RevertPatch();
            SetStatus("Revert requested");
        };
        addAndMakeVisible(revertButton_);

        patchNameLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
        patchNameLabel_.setJustificationType(juce::Justification::centredLeft);
        addAndMakeVisible(patchNameLabel_);
        RefreshPatchNameLabel();

        statusLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
        statusLabel_.setJustificationType(juce::Justification::centredLeft);
        statusLabel_.setText("Ready", juce::dontSendNotification);
        addAndMakeVisible(statusLabel_);
    }

    FilePage(const FilePage&) = delete;
    FilePage& operator=(const FilePage&) = delete;

    void resized() override {
        auto area = getLocalBounds().reduced(4);
        auto backRow = area.removeFromTop(32);
        backButton_.setBounds(backRow.removeFromLeft(80));
        area.removeFromTop(4);

        auto patchRow = area.removeFromTop(36);
        const int patchButtonWidth = 84;
        newButton_.setBounds(patchRow.removeFromLeft(patchButtonWidth).reduced(4));
        saveButton_.setBounds(patchRow.removeFromLeft(patchButtonWidth).reduced(4));
        saveAsButton_.setBounds(patchRow.removeFromLeft(patchButtonWidth).reduced(4));
        loadButton_.setBounds(patchRow.removeFromLeft(patchButtonWidth).reduced(4));
        revertButton_.setBounds(patchRow.removeFromLeft(patchButtonWidth).reduced(4));

        patchNameLabel_.setBounds(area.removeFromTop(28).reduced(4));
        statusLabel_.setBounds(area.removeFromTop(28).reduced(4));
    }

    // Called once per UI timer tick by MainPane so the patch-name label
    // stays current without requiring a patch command (sar-16: identity is
    // read from the message-side PatchManager every tick, never cached).
    void RefreshOnTick() { RefreshPatchNameLabel(); }

    // Back control at the top of the page (binding, p4-globals.md): wired by
    // MainPane to ShowPage(Page::None), returning to the app.
    std::function<void()> onBack;

private:
    void SetStatus(const juce::String& text) { statusLabel_.setText(text, juce::dontSendNotification); }

    // Reads the current patch identity straight from the message-side
    // owner (engine.Patches(), a synth::PatchManager) every call -- sar-16:
    // never cached anywhere else, never touched from the audio side.
    // CurrentPatchDirectory() is the patch directory's full path; the label
    // shows just its filename (the directory's own name), or "(no patch)"
    // when no patch is current.
    void RefreshPatchNameLabel() {
        const auto& currentPatchDirectory = runtime_.GetEngine().Patches().CurrentPatchDirectory();
        const juce::String text = currentPatchDirectory.has_value()
                                       ? juce::String(currentPatchDirectory->filename().string())
                                       : juce::String("(no patch)");
        patchNameLabel_.setText(text, juce::dontSendNotification);
    }

    void LaunchSaveAsChooser() {
        const juce::File root(runtime_.GetEngine().Config().patchesRoot.string());
        fileChooser_ = std::make_unique<juce::FileChooser>("Save Patch As", root);
        const auto flags = juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectDirectories |
                            juce::FileBrowserComponent::warnAboutOverwriting;
        fileChooser_->launchAsync(flags, [this](const juce::FileChooser& chooser) {
            const juce::File result = chooser.getResult();
            if (result == juce::File{}) {
                return;
            }
            runtime_.SavePatchAs(result);
            SetStatus("Save As requested: " + result.getFullPathName());
        });
    }

    void LaunchLoadChooser() {
        const juce::File root(runtime_.GetEngine().Config().patchesRoot.string());
        fileChooser_ = std::make_unique<juce::FileChooser>("Load Patch", root);
        const auto flags = juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories;
        fileChooser_->launchAsync(flags, [this](const juce::FileChooser& chooser) {
            const juce::File result = chooser.getResult();
            if (result == juce::File{}) {
                return;
            }
            runtime_.LoadPatch(result);
            SetStatus("Load requested: " + result.getFullPathName());
        });
    }

    Runtime<App>& runtime_;

    juce::TextButton backButton_;
    juce::TextButton newButton_;
    juce::TextButton saveButton_;
    juce::TextButton saveAsButton_;
    juce::TextButton loadButton_;
    juce::TextButton revertButton_;
    juce::Label patchNameLabel_;
    juce::Label statusLabel_;

    // Held so the chooser survives until its async callback fires (modern
    // JUCE idiom: FileChooser::launchAsync requires the chooser object to
    // stay alive for the duration of the operation). Recreated on each
    // launch, which destroys any previous (already-completed) chooser.
    std::unique_ptr<juce::FileChooser> fileChooser_;
};

}  // namespace synth_runtime
