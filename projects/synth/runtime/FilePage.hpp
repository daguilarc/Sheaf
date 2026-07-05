#pragma once

// synth_runtime::FilePage — the File page hosted by MainPane's content host
// (Plan 4 Task 3). Re-homes the patch-command chrome row deleted from
// Shell.hpp in commit 2ec3f2f (see `git show 2ec3f2f^:projects/synth/runtime/Shell.hpp`
// for the reference implementation this was lifted from): a Back button at
// the top of the page (binding, p4-globals.md), New/Save/Save As/Load/Revert
// buttons wired straight to Runtime's patch methods, an in-app patch browser
// rooted at RuntimeDataPaths::patchesRoot for Save As/Load, a patch-name
// label showing the current patch's directory name (or "(no patch)"), and a
// status label reflecting the last patch command's result.
//
// Save->SaveAs fallthrough (sar-16, preserved from the deleted
// chrome): dispatching SavePatch() with no current patch directory is
// doomed to come back NeedsSaveAsPath, so saveButton_'s handler checks
// runtime_.GetEngine().Patches().CurrentPatchDirectory().has_value() first
// and opens the in-app Save As browser directly instead when it's unset.
//
// Patch identity (sar-16): the patch-name label reads
// runtime_.GetEngine().Patches().CurrentPatchDirectory() -- the
// message-side PatchManager's own state -- every call, never cached here or
// touched audio-side, refreshed once per UI timer tick via RefreshOnTick()
// (MainPane calls this unconditionally every tick, mirroring
// AudioConfigPage's own per-tick status refresh).
//
#include "synth/AppConcepts.hpp"
#include "synth/Engine.hpp"
#include "synth/PatchBrowser.hpp"
#include "synth/PatchPersistence.hpp"

#include <juce_gui_extra/juce_gui_extra.h>

#include <functional>

namespace synth_runtime {

template <synth::SynthApplication App>
class Runtime;

template <synth::SynthApplication App>
class FilePage : public juce::Component, private juce::ListBoxModel {
public:
    explicit FilePage(Runtime<App>& runtime) : runtime_(runtime) {
        backButton_.setButtonText("Back");
        backButton_.onClick = [this] {
            CloseBrowser();
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
            // Falls through to the in-app Save As browser when no patch is current
            // (sar-16, preserved verbatim from the deleted chrome): see the
            // class doc comment above.
            if (runtime_.GetEngine().Patches().CurrentPatchDirectory().has_value()) {
                runtime_.SavePatch();
                SetStatus("Save requested");
            } else {
                BeginBrowser(BrowserMode::SaveAs);
            }
        };
        addAndMakeVisible(saveButton_);

        saveAsButton_.setButtonText("Save As");
        saveAsButton_.onClick = [this] { BeginBrowser(BrowserMode::SaveAs); };
        addAndMakeVisible(saveAsButton_);

        loadButton_.setButtonText("Load");
        loadButton_.onClick = [this] { BeginBrowser(BrowserMode::Load); };
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

        browserTitleLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
        browserTitleLabel_.setJustificationType(juce::Justification::centredLeft);
        addChildComponent(browserTitleLabel_);

        browserPathLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
        browserPathLabel_.setJustificationType(juce::Justification::centredLeft);
        addChildComponent(browserPathLabel_);

        saveNameEditor_.setMultiLine(false);
        saveNameEditor_.setReturnKeyStartsNewLine(false);
        saveNameEditor_.setText("NewPatch", false);
        saveNameEditor_.onReturnKey = [this] { ConfirmBrowserSelection(); };
        addChildComponent(saveNameEditor_);

        patchList_.setModel(this);
        patchList_.setRowHeight(28);
        patchList_.setColour(juce::ListBox::backgroundColourId, juce::Colours::darkgrey);
        addChildComponent(patchList_);

        browserUpButton_.setButtonText("Up");
        browserUpButton_.onClick = [this] {
            if (patchBrowser_.EnterParent()) {
                RefreshBrowserView();
            }
        };
        addChildComponent(browserUpButton_);

        browserEnterButton_.setButtonText("Enter");
        browserEnterButton_.onClick = [this] {
            if (patchBrowser_.EnterSelected()) {
                RefreshBrowserView();
            }
        };
        addChildComponent(browserEnterButton_);

        browserOkButton_.setButtonText("OK");
        browserOkButton_.onClick = [this] { ConfirmBrowserSelection(); };
        addChildComponent(browserOkButton_);

        browserCancelButton_.setButtonText("Cancel");
        browserCancelButton_.onClick = [this] {
            CloseBrowser();
            SetStatus("Patch browser cancelled");
        };
        addChildComponent(browserCancelButton_);
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

        if (browserMode_ == BrowserMode::Closed) {
            return;
        }

        area.removeFromTop(4);
        browserTitleLabel_.setBounds(area.removeFromTop(24).reduced(4));
        if (browserMode_ == BrowserMode::SaveAs) {
            saveNameEditor_.setBounds(area.removeFromTop(32).reduced(4));
        }
        browserPathLabel_.setBounds(area.removeFromTop(24).reduced(4));

        auto buttons = area.removeFromBottom(36);
        const int browserButtonWidth = 76;
        browserUpButton_.setBounds(buttons.removeFromLeft(browserButtonWidth).reduced(4));
        browserEnterButton_.setBounds(buttons.removeFromLeft(browserButtonWidth).reduced(4));
        browserOkButton_.setBounds(buttons.removeFromRight(browserButtonWidth).reduced(4));
        browserCancelButton_.setBounds(buttons.removeFromRight(browserButtonWidth).reduced(4));

        patchList_.setBounds(area.reduced(4));
    }

    // Called once per UI timer tick by MainPane so the patch-name label
    // stays current without requiring a patch command (sar-16: identity is
    // read from the message-side PatchManager every tick, never cached).
    void RefreshOnTick() { RefreshPatchNameLabel(); }

    // Back control at the top of the page (binding, p4-globals.md): wired by
    // MainPane to ShowPage(Page::None), returning to the app.
    std::function<void()> onBack;

private:
    enum class BrowserMode {
        Closed,
        SaveAs,
        Load,
    };

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

    void BeginBrowser(BrowserMode mode) {
        browserMode_ = mode;
        patchBrowser_.SetRoot(runtime_.DataPaths().patchesRoot);
        if (!patchBrowser_.Refresh()) {
            SetStatus("Patch browser failed: " + juce::String(runtime_.DataPaths().patchesRoot.string()));
        }

        browserTitleLabel_.setText(mode == BrowserMode::SaveAs ? "Save Patch As" : "Load Patch",
                                   juce::dontSendNotification);
        if (mode == BrowserMode::SaveAs) {
            saveNameEditor_.setVisible(true);
            const auto& currentPatchDirectory = runtime_.GetEngine().Patches().CurrentPatchDirectory();
            saveNameEditor_.setText(currentPatchDirectory.has_value()
                                        ? juce::String(currentPatchDirectory->filename().string())
                                        : juce::String("NewPatch"),
                                    false);
            saveNameEditor_.selectAll();
            saveNameEditor_.grabKeyboardFocus();
        } else {
            saveNameEditor_.setVisible(false);
        }

        SetBrowserControlsVisible(true);
        RefreshBrowserView();
        resized();
    }

    void CloseBrowser() {
        browserMode_ = BrowserMode::Closed;
        SetBrowserControlsVisible(false);
        patchList_.updateContent();
        resized();
    }

    void SetBrowserControlsVisible(bool visible) {
        browserTitleLabel_.setVisible(visible);
        browserPathLabel_.setVisible(visible);
        patchList_.setVisible(visible);
        browserUpButton_.setVisible(visible);
        browserEnterButton_.setVisible(visible);
        browserOkButton_.setVisible(visible);
        browserCancelButton_.setVisible(visible);
        saveNameEditor_.setVisible(visible && browserMode_ == BrowserMode::SaveAs);
    }

    void RefreshBrowserView() {
        patchList_.updateContent();
        if (!patchBrowser_.Entries().empty()) {
            patchList_.selectRow(static_cast<int>(patchBrowser_.SelectedIndex()));
        } else {
            patchList_.deselectAllRows();
        }

        const std::filesystem::path relative = patchBrowser_.CurrentRelativePath();
        browserPathLabel_.setText(relative.empty() ? juce::String("/") : juce::String(relative.generic_string()),
                                  juce::dontSendNotification);
        browserEnterButton_.setEnabled(!patchBrowser_.Entries().empty());
        browserUpButton_.setEnabled(!relative.empty());
    }

    void ConfirmBrowserSelection() {
        if (browserMode_ == BrowserMode::SaveAs) {
            const auto path = patchBrowser_.ResolveSaveAsPath(saveNameEditor_.getText().toStdString());
            if (!path.has_value()) {
                SetStatus("Invalid patch name");
                return;
            }
            runtime_.SavePatchAs(*path);
            SetStatus("Save As requested: " + juce::String(path->string()));
            CloseBrowser();
            return;
        }

        if (browserMode_ == BrowserMode::Load) {
            const auto path = patchBrowser_.SelectedLoadPath();
            if (!path.has_value()) {
                SetStatus("No patch selected");
                return;
            }
            runtime_.LoadPatch(*path);
            SetStatus("Load requested: " + juce::String(path->string()));
            CloseBrowser();
        }
    }

    int getNumRows() override { return static_cast<int>(patchBrowser_.Entries().size()); }

    void paintListBoxItem(int rowNumber, juce::Graphics& g, int width, int height, bool rowIsSelected) override {
        g.fillAll(rowIsSelected ? juce::Colours::darkblue : juce::Colours::darkgrey);
        g.setColour(juce::Colours::white);
        g.setFont(juce::FontOptions(14.0f));
        const auto& entries = patchBrowser_.Entries();
        if (rowNumber >= 0 && static_cast<std::size_t>(rowNumber) < entries.size()) {
            g.drawText(entries[static_cast<std::size_t>(rowNumber)].name, 8, 0, width - 16, height,
                       juce::Justification::centredLeft);
        }
    }

    void listBoxItemClicked(int row, const juce::MouseEvent&) override {
        if (row < 0) {
            return;
        }
        patchBrowser_.Select(static_cast<std::size_t>(row));
        if (browserMode_ == BrowserMode::SaveAs && static_cast<std::size_t>(row) < patchBrowser_.Entries().size()) {
            saveNameEditor_.setText(juce::String(patchBrowser_.Entries()[static_cast<std::size_t>(row)].name), false);
        }
        RefreshBrowserView();
    }

    void listBoxItemDoubleClicked(int row, const juce::MouseEvent&) override {
        if (row < 0) {
            return;
        }
        patchBrowser_.Select(static_cast<std::size_t>(row));
        if (browserMode_ == BrowserMode::Load) {
            ConfirmBrowserSelection();
        } else if (browserMode_ == BrowserMode::SaveAs &&
                   static_cast<std::size_t>(row) < patchBrowser_.Entries().size()) {
            saveNameEditor_.setText(juce::String(patchBrowser_.Entries()[static_cast<std::size_t>(row)].name), false);
        }
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
    juce::Label browserTitleLabel_;
    juce::Label browserPathLabel_;
    juce::TextEditor saveNameEditor_;
    juce::ListBox patchList_{"Patches", this};
    juce::TextButton browserUpButton_;
    juce::TextButton browserEnterButton_;
    juce::TextButton browserOkButton_;
    juce::TextButton browserCancelButton_;
    synth::PatchBrowser patchBrowser_;
    BrowserMode browserMode_ = BrowserMode::Closed;
};

}  // namespace synth_runtime
