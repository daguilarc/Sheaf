#pragma once

// synth_runtime::MainPane / SidebarHost — the library's main pane (Plan 4 Task 2,
// sru-1/sru-2): a fixed-width right sidebar (Audio/Controllers/File tabs plus
// a max-recent-deadline readout) and a content host that shows exactly one of
// the application's portable UI surface or a single library page at a time.
//
// ShellComponent (Shell.hpp) now hosts a MainPane<App> as its only child;
// the former patch chrome row / MidiPanel strip / AudioPanel strip layout is
// gone from the shell (sru-3/sru-4 moved MidiPanel/AudioPanel's logic into
// ControllersPage/AudioConfigPage; sru-6 moved the patch row into FilePage).
// Audio and File pages render through portable semantic trees
// (include/synth/RuntimePages.hpp) with JUCE backends in
// projects/synth/juce/RuntimePagesJuce.hpp. ControllersPage remains a direct
// JUCE renderer until task 5.x.
//
// Content-host visibility (sru-1, binding): switching pages toggles
// juce::Component::setVisible on the portable app component and whichever of
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
#include "PortableJuceBackend.hpp"
#include "RuntimePagesJuce.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <functional>

namespace synth_runtime {

template <synth::SynthApplication App>
class Runtime;

template <synth::SynthApplication App>
class MainPane : public juce::Component
{
public:
    enum class Page
    {
        None,
        Audio,
        Controllers,
        File
    };

    explicit MainPane(Runtime<App>& runtime)
        : runtime_(runtime)
        , appComponent_(runtime.AppSurface())
        , audioPage_(runtime)
        , filePage_(runtime)
        , controllersPage_(runtime)
    {
        sidebar_.onAction = [this](const synth::ui::Action& action) {
            if (action.name == synth::runtime_ui::Actions::kSidebarAudio)
            {
                ShowPage(Page::Audio);
            }
            else if (action.name == synth::runtime_ui::Actions::kSidebarControllers)
            {
                ShowPage(Page::Controllers);
            }
            else if (action.name == synth::runtime_ui::Actions::kSidebarFile)
            {
                ShowPage(Page::File);
            }
        };
        addAndMakeVisible(sidebar_);

        audioPage_.onBack = [this] { ReturnFromPage(Page::Audio); };
        addChildComponent(audioPage_);

        filePage_.onBack = [this] { ReturnFromPage(Page::File); };
        addChildComponent(filePage_);

        controllersPage_.onBack = [this] { ReturnFromPage(Page::Controllers); };
        addChildComponent(controllersPage_);

        addAndMakeVisible(appComponent_);
        appComponent_.RefreshFromSurface();

        ShowPage(Page::None);
    }

    void ShowPage(Page page)
    {
        currentPage_ = page;

        const bool showingApp = (page == Page::None);
        appComponent_.setVisible(showingApp);
        audioPage_.setVisible(page == Page::Audio);
        filePage_.setVisible(page == Page::File);
        controllersPage_.setVisible(page == Page::Controllers);

        resized();
    }

    Page CurrentPage() const
    {
        return currentPage_;
    }

    void WriteDeadlineSample(float pct)
    {
        deadlineMax_.Write(pct);
        sidebar_.SetDeadlinePercent(deadlineMax_.Max());
    }

    void RefreshOnTick()
    {
        appComponent_.RefreshFromSurface();
        audioPage_.RefreshOnTick();
        filePage_.RefreshOnTick();
        controllersPage_.RefreshOnTick();
    }

    void resized() override
    {
        auto area = getLocalBounds();
        sidebar_.setBounds(area.removeFromRight(static_cast<int>(synth::runtime_ui::Layout::kSidebarWidth)));

        audioPage_.setBounds(area);
        filePage_.setBounds(area);
        controllersPage_.setBounds(area);

        appComponent_.setBounds(area);
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
    synth_juce::PortableComponent appComponent_;
    SidebarHost sidebar_;
    AudioConfigPage<App> audioPage_;
    FilePage<App> filePage_;
    ControllersPage<App> controllersPage_;
    Page currentPage_ = Page::None;
    synth::RollingMax256 deadlineMax_;
};

}  // namespace synth_runtime
