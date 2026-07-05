#pragma once

// synth_runtime::MainPane / Sidebar — the library's main pane (Plan 4 Task 2,
// sru-1/sru-2): a fixed-width right sidebar (Audio/Controllers/File tabs plus
// a max-recent-deadline readout) and a content host that shows exactly one of
// the application's own UIComponent() or a single library page at a time.
//
// ShellComponent (Shell.hpp) now hosts a MainPane<App> as its only child;
// the former patch chrome row / MidiPanel strip / AudioPanel strip layout is
// gone from the shell (sru-3/sru-4 moved MidiPanel/AudioPanel's logic into
// ControllersPage/AudioConfigPage; sru-6 moved the patch row into FilePage).
// Audio, File, and Controllers all show real pages (AudioConfigPage.hpp /
// FilePage.hpp / ControllersPage.hpp) as of Task 4 of Plan 4, which deleted
// the last placeholder (a juce::Label naming the page plus a Back button).
//
// Content-host visibility (sru-1, binding): switching pages toggles
// juce::Component::setVisible on the app component and whichever of
// {audioPage_, filePage_, controllersPage_} is relevant, it never
// destroys/reconstructs the app component -- its state (audio keeps running
// regardless; this is purely a UI-visibility concern) is retained across
// page navigation. audioPage_/filePage_/controllersPage_ are likewise
// constructed once (in MainPane's constructor) and never
// destroyed/reconstructed across navigation -- only setVisible toggles.
//
// Deadline readout (sru-2, binding): Runtime's UI timer calls
// WriteDeadlineSample(deviceManager_.getCpuUsage() * 100.0f) once per tick
// (Runtime.hpp's timerCallback, after MessageThreadTick/OnTimerTick, before
// the repaint hook fires) -- MainPane forwards the sample into a
// synth::RollingMax256 (JUCE-free, MidiConfigViewModel.hpp) and the sidebar
// paints its rolling-max label as "%.1f%%" on every repaint.
//
// Per-tick page refresh (Task 3, extended Task 4): RefreshOnTick() calls
// audioPage_.RefreshOnTick()/filePage_.RefreshOnTick()/
// controllersPage_.RefreshOnTick() unconditionally every tick, regardless of
// which page is currently shown -- FilePage's patch-name label and
// AudioConfigPage's negotiated-values status both need to reflect state that
// can change without going through either page's own controls (a patch load
// changing the current patch directory or the audio device), and
// ControllersPage's own RefreshOnTick() only actually rebuilds its view
// model when its internal dirty flag is set (see ControllersPage.hpp), so
// calling it unconditionally here is cheap. ShellComponent::RepaintAll
// (Shell.hpp) calls this before repainting.

#include "synth/AppConcepts.hpp"
#include "synth/MidiConfigViewModel.hpp"

#include "AudioConfigPage.hpp"
#include "ControllersPage.hpp"
#include "FilePage.hpp"
#include "synth/RuntimePagePolicy.hpp"

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

    explicit MainPane(Runtime<App>& runtime)
        : runtime_(runtime), audioPage_(runtime), filePage_(runtime), controllersPage_(runtime) {
        sidebar_.audioButton_.onClick = [this] { ShowPage(Page::Audio); };
        sidebar_.controllersButton_.onClick = [this] { ShowPage(Page::Controllers); };
        sidebar_.fileButton_.onClick = [this] { ShowPage(Page::File); };
        addAndMakeVisible(sidebar_);

        audioPage_.onBack = [this] { ReturnFromPage(Page::Audio); };
        addChildComponent(audioPage_);

        filePage_.onBack = [this] { ReturnFromPage(Page::File); };
        addChildComponent(filePage_);

        controllersPage_.onBack = [this] { ReturnFromPage(Page::Controllers); };
        addChildComponent(controllersPage_);

        addAndMakeVisible(runtime_.AppComponent());

        ShowPage(Page::None);
    }

    // Swaps content-host visibility between the app component (None) and
    // the named page (sru-1: exactly one visible at a time; the app
    // component's own state is retained via setVisible(false), never
    // destroyed/reconstructed -- see this header's doc comment).
    void ShowPage(Page page) {
        currentPage_ = page;

        const bool showingApp = (page == Page::None);
        runtime_.AppComponent().setVisible(showingApp);
        audioPage_.setVisible(page == Page::Audio);
        filePage_.setVisible(page == Page::File);
        controllersPage_.setVisible(page == Page::Controllers);

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
    // FilePage's patch-name label, AudioConfigPage's negotiated-values
    // status, and ControllersPage's view model stay current regardless of
    // which page is currently shown.
    void RefreshOnTick() {
        audioPage_.RefreshOnTick();
        filePage_.RefreshOnTick();
        controllersPage_.RefreshOnTick();
    }

    void resized() override {
        auto area = getLocalBounds();
        sidebar_.setBounds(area.removeFromRight(Sidebar::kWidth));

        // Content host: the remaining area, shared by the app component and
        // whichever page is showing. Back sits at the top of the page area
        // (binding: "Back control at the top of every page") --
        // audioPage_/filePage_/controllersPage_ each lay out their own Back
        // button internally within this same area.
        audioPage_.setBounds(area);
        filePage_.setBounds(area);
        controllersPage_.setBounds(area);

        runtime_.AppComponent().setBounds(area);
    }

private:
    static synth::RuntimePageKind ToRuntimePageKind(Page page) {
        switch (page) {
            case Page::Audio:
                return synth::RuntimePageKind::Audio;
            case Page::Controllers:
                return synth::RuntimePageKind::Controllers;
            case Page::File:
                return synth::RuntimePageKind::File;
            case Page::None:
                return synth::RuntimePageKind::None;
        }
        return synth::RuntimePageKind::None;
    }

    void ReturnFromPage(Page page) {
        if (synth::RuntimePageBackSavesConfiguration(ToRuntimePageKind(page))) {
            runtime_.SaveRuntimeConfiguration();
        }
        ShowPage(Page::None);
    }

    Runtime<App>& runtime_;
    Sidebar sidebar_;
    AudioConfigPage<App> audioPage_;
    FilePage<App> filePage_;
    ControllersPage<App> controllersPage_;
    Page currentPage_ = Page::None;
    synth::RollingMax256 deadlineMax_;
};

}  // namespace synth_runtime
