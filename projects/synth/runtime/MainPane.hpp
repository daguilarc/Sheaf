#pragma once

// synth_runtime::MainPane / Sidebar — the library's main pane (Plan 4 Task 2,
// sru-1/sru-2): a fixed-width right sidebar (Audio/Controllers/File tabs plus
// a max-recent-deadline readout) and a content host that shows exactly one of
// the application's own UIComponent() or a single library page at a time.
//
// ShellComponent (Shell.hpp) now hosts a MainPane<App> as its only child;
// the former patch chrome row / MidiPanel strip / AudioPanel strip layout is
// gone from the shell (sru-3/sru-4 moved MidiPanel/AudioPanel's logic into
// ControllersPage/AudioConfigPage; sru-6 moved the patch row into FilePage --
// both done in Task 3). Audio and File now show real pages
// (AudioConfigPage.hpp / FilePage.hpp); Controllers stays a placeholder
// (juce::Label naming the page plus a Back button) until the next task lands
// ControllersPage.
//
// Content-host visibility (sru-1, binding): switching pages toggles
// juce::Component::setVisible on the app component and whichever of
// {audioPage_, filePage_, placeholderLabel_} is relevant, it never
// destroys/reconstructs the app component -- its state (audio keeps running
// regardless; this is purely a UI-visibility concern) is retained across
// page navigation. audioPage_/filePage_ are likewise constructed once (in
// MainPane's constructor) and never destroyed/reconstructed across
// navigation -- only setVisible toggles.
//
// Deadline readout (sru-2, binding): Runtime's UI timer calls
// WriteDeadlineSample(deviceManager_.getCpuUsage() * 100.0f) once per tick
// (Runtime.hpp's timerCallback, after MessageThreadTick/OnTimerTick, before
// the repaint hook fires) -- MainPane forwards the sample into a
// synth::RollingMax256 (JUCE-free, MidiConfigViewModel.hpp) and the sidebar
// paints its rolling-max label as "%.1f%%" on every repaint.
//
// Per-tick page refresh (Task 3): RefreshOnTick() calls
// audioPage_.RefreshOnTick()/filePage_.RefreshOnTick() unconditionally every
// tick, regardless of which page is currently shown -- FilePage's patch-name
// label and AudioConfigPage's negotiated-values status both need to reflect
// state that can change without going through either page's own controls
// (a patch load changing the current patch directory or the audio device).
// ShellComponent::RepaintAll (Shell.hpp) calls this before repainting.

#include "synth/AppConcepts.hpp"
#include "synth/MidiConfigViewModel.hpp"

#include "AudioConfigPage.hpp"
#include "FilePage.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <cstdio>
#include <functional>

namespace synth_runtime {

// Forward declaration; Runtime<App> is defined in Runtime.hpp, which
// includes this header transitively through Shell.hpp -- MainPane only
// needs a reference, so a forward declaration avoids a circular include.
template <synth::SynthApplication App>
class Runtime;

// The fixed-width (96px, sru-2 binding) right-edge sidebar: Audio,
// Controllers, and File buttons (96x40 each, top-down) followed by the
// deadline readout label (96x40). Callbacks are wired by MainPane's
// constructor straight into MainPane::ShowPage.
class Sidebar : public juce::Component {
public:
    static constexpr int kWidth = 96;
    static constexpr int kButtonHeight = 40;

    Sidebar() {
        audioButton_.setButtonText("Audio");
        addAndMakeVisible(audioButton_);

        controllersButton_.setButtonText("Controllers");
        addAndMakeVisible(controllersButton_);

        fileButton_.setButtonText("File");
        addAndMakeVisible(fileButton_);

        deadlineLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
        deadlineLabel_.setJustificationType(juce::Justification::centred);
        deadlineLabel_.setText("0.0%", juce::dontSendNotification);
        addAndMakeVisible(deadlineLabel_);
    }

    void resized() override {
        auto area = getLocalBounds();
        audioButton_.setBounds(area.removeFromTop(kButtonHeight));
        controllersButton_.setBounds(area.removeFromTop(kButtonHeight));
        fileButton_.setBounds(area.removeFromTop(kButtonHeight));
        deadlineLabel_.setBounds(area.removeFromTop(kButtonHeight));
    }

    // Renders the current rolling-max deadline percentage, "%.1f%%" (sru-2
    // binding). Called by MainPane after every WriteDeadlineSample.
    void SetDeadlineText(float pct) {
        char buffer[32];
        std::snprintf(buffer, sizeof(buffer), "%.1f%%", static_cast<double>(pct));
        deadlineLabel_.setText(juce::String(buffer), juce::dontSendNotification);
    }

    juce::TextButton audioButton_;
    juce::TextButton controllersButton_;
    juce::TextButton fileButton_;

private:
    juce::Label deadlineLabel_;
};

// The library main pane: Sidebar at the fixed right edge, a content host
// filling the remainder showing either the application's UIComponent() or
// exactly one library page (sru-1).
template <synth::SynthApplication App>
class MainPane : public juce::Component {
public:
    enum class Page { None, Audio, Controllers, File };

    explicit MainPane(Runtime<App>& runtime) : runtime_(runtime), audioPage_(runtime), filePage_(runtime) {
        sidebar_.audioButton_.onClick = [this] { ShowPage(Page::Audio); };
        sidebar_.controllersButton_.onClick = [this] { ShowPage(Page::Controllers); };
        sidebar_.fileButton_.onClick = [this] { ShowPage(Page::File); };
        addAndMakeVisible(sidebar_);

        // Controllers stays a placeholder (Back button + label) until the
        // next task lands ControllersPage.
        backButton_.setButtonText("Back");
        backButton_.onClick = [this] { ShowPage(Page::None); };
        addChildComponent(backButton_);

        placeholderLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
        placeholderLabel_.setJustificationType(juce::Justification::centred);
        addChildComponent(placeholderLabel_);

        audioPage_.onBack = [this] { ShowPage(Page::None); };
        addChildComponent(audioPage_);

        filePage_.onBack = [this] { ShowPage(Page::None); };
        addChildComponent(filePage_);

        addAndMakeVisible(runtime_.AppComponent());

        ShowPage(Page::None);
    }

    // Swaps content-host visibility between the app component (None) and
    // the named page (sru-1: exactly one visible at a time; the app
    // component's own state is retained via setVisible(false), never
    // destroyed/reconstructed -- see this header's doc comment). Controllers
    // still shows the shared placeholder (backButton_ + placeholderLabel_)
    // until the next task lands ControllersPage.
    void ShowPage(Page page) {
        currentPage_ = page;

        const bool showingApp = (page == Page::None);
        const bool showingPlaceholder = (page == Page::Controllers);
        runtime_.AppComponent().setVisible(showingApp);
        backButton_.setVisible(showingPlaceholder);
        placeholderLabel_.setVisible(showingPlaceholder);
        audioPage_.setVisible(page == Page::Audio);
        filePage_.setVisible(page == Page::File);

        if (showingPlaceholder) {
            placeholderLabel_.setText(PageName(page), juce::dontSendNotification);
        }

        resized();
    }

    Page CurrentPage() const { return currentPage_; }

    // Runtime's UI timer calls this once per tick with
    // deviceManager_.getCpuUsage() * 100.0f (sru-2 binding); forwarded into
    // the JUCE-free rolling-max tracker and reflected into the sidebar
    // label's text immediately (Runtime's repaint hook, invoked later in the
    // same tick, repaints the sidebar so the new text actually appears).
    void WriteDeadlineSample(float pct) {
        deadlineMax_.Write(pct);
        sidebar_.SetDeadlineText(deadlineMax_.Max());
    }

    // Called once per UI timer tick (see this header's doc comment) so
    // FilePage's patch-name label and AudioConfigPage's negotiated-values
    // status stay current regardless of which page is currently shown.
    void RefreshOnTick() {
        audioPage_.RefreshOnTick();
        filePage_.RefreshOnTick();
    }

    void resized() override {
        auto area = getLocalBounds();
        sidebar_.setBounds(area.removeFromRight(Sidebar::kWidth));

        // Content host: the remaining area, shared by the app component and
        // whichever page is showing. Back sits at the top of the page area
        // (binding: "Back control at the top of every page") -- the
        // placeholder's Back button is laid out here; audioPage_/filePage_
        // each lay out their own Back button internally within this same
        // area.
        auto contentArea = area;
        auto backArea = contentArea.removeFromTop(32);
        backButton_.setBounds(backArea.removeFromLeft(80).reduced(4));
        placeholderLabel_.setBounds(contentArea);

        audioPage_.setBounds(area);
        filePage_.setBounds(area);

        runtime_.AppComponent().setBounds(area);
    }

private:
    static const char* PageName(Page page) {
        switch (page) {
            case Page::Audio:
                return "Audio";
            case Page::Controllers:
                return "Controllers";
            case Page::File:
                return "File";
            case Page::None:
                break;
        }
        return "";
    }

    Runtime<App>& runtime_;
    Sidebar sidebar_;
    juce::TextButton backButton_;
    juce::Label placeholderLabel_;
    AudioConfigPage<App> audioPage_;
    FilePage<App> filePage_;
    Page currentPage_ = Page::None;
    synth::RollingMax256 deadlineMax_;
};

}  // namespace synth_runtime
