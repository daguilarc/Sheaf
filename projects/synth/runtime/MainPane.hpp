#pragma once

#include "synth/AppConcepts.hpp"
#include "synth/RuntimeMainComponent.hpp"

#include "JuceRuntimeMainServices.hpp"
#include "PortableJuceBackend.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

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
        Sync,
        File
    };

    explicit MainPane(Runtime<App>& runtime)
        : runtime_(runtime)
        , services_(runtime_)
        , mainComponent_(runtime_.GetEngine().Application(), services_)
        , renderer_(mainComponent_)
    {
        services_.SetFocusGuard([this] { return renderer_.hasKeyboardFocus(true); });
        mainComponent_.SetActionHandler([this](const synth::ui::Action& action) {
            RefreshRendererAfterAction(action);
        });
        addAndMakeVisible(renderer_);
        RefreshOnTick();
    }

    ~MainPane() override
    {
        mainComponent_.SetActionHandler({});
        services_.SetFocusGuard({});
    }

    void ShowPage(Page page)
    {
        mainComponent_.ShowPage(ToRuntimeMainPage(page));
        renderer_.RefreshFromSurface();
    }

    Page CurrentPage() const
    {
        return FromRuntimeMainPage(mainComponent_.CurrentPage());
    }

    void RefreshOnTick()
    {
        mainComponent_.Refresh();
        renderer_.RefreshFromSurface();
    }

    void resized() override
    {
        // Task 8 fix round 1 (sprs-13 finding 1): feed the pane's live JUCE
        // bounds to the shell before the next RefreshFromSurface() rebuilds
        // the tree, so an ExtentAwareSurface app is offered the real window
        // size instead of only ever resolving at its compiled-in default.
        // mainComponent_ is held directly (not through a `ui::Surface&`), so
        // this calls its existing public SetContentExtent() setter (task
        // 8.1) with no dynamic_cast/interface needed at this layer.
        mainComponent_.SetContentExtent(synth_juce::JuceToUiBounds(getLocalBounds().toFloat()));
        renderer_.setBounds(getLocalBounds());
        renderer_.RefreshFromSurface();
    }

    synth::ui::Bounds IntrinsicBounds() const
    {
        return mainComponent_.IntrinsicBounds();
    }

    bool NeedsDeferredRendererRefresh(const synth::ui::Action& action) const
    {
        return mainComponent_.NeedsDeferredDispatch(action);
    }

    bool HasDeferredRendererRefresh() const
    {
        return deferredRendererRefreshPending_;
    }

    void FlushDeferredRendererRefresh()
    {
        if (!deferredRendererRefreshPending_)
        {
            return;
        }
        deferredRendererRefreshPending_ = false;
        renderer_.RefreshFromSurface();
    }

private:
    void RefreshRendererAfterAction(const synth::ui::Action& action)
    {
        if (!NeedsDeferredRendererRefresh(action))
        {
            renderer_.RefreshFromSurface();
            return;
        }
        if (deferredRendererRefreshPending_)
        {
            return;
        }

        deferredRendererRefreshPending_ = true;
        juce::Component::SafePointer<MainPane<App>> safeThis(this);
        if (!juce::MessageManager::callAsync([safeThis] {
                if (safeThis != nullptr)
                {
                    safeThis->FlushDeferredRendererRefresh();
                }
            }))
        {
            // The message queue is shutting down. Do not synchronously rebuild
            // controls inside the active JUCE callback.
            deferredRendererRefreshPending_ = false;
        }
    }

    static synth::runtime_ui::RuntimeMainPage ToRuntimeMainPage(Page page)
    {
        switch (page) {
            case Page::Audio:
                return synth::runtime_ui::RuntimeMainPage::Audio;
            case Page::Controllers:
                return synth::runtime_ui::RuntimeMainPage::Controllers;
            case Page::Sync:
                return synth::runtime_ui::RuntimeMainPage::Sync;
            case Page::File:
                return synth::runtime_ui::RuntimeMainPage::File;
            case Page::None:
                return synth::runtime_ui::RuntimeMainPage::Application;
        }
        return synth::runtime_ui::RuntimeMainPage::Application;
    }

    static Page FromRuntimeMainPage(synth::runtime_ui::RuntimeMainPage page)
    {
        switch (page) {
            case synth::runtime_ui::RuntimeMainPage::Audio:
                return Page::Audio;
            case synth::runtime_ui::RuntimeMainPage::Controllers:
                return Page::Controllers;
            case synth::runtime_ui::RuntimeMainPage::Sync:
                return Page::Sync;
            case synth::runtime_ui::RuntimeMainPage::File:
                return Page::File;
            case synth::runtime_ui::RuntimeMainPage::Application:
                return Page::None;
        }
        return Page::None;
    }

    Runtime<App>& runtime_;
    JuceRuntimeMainServices<App> services_;
    synth::runtime_ui::RuntimeMainComponent<App, JuceRuntimeMainServices<App>> mainComponent_;
    synth_juce::PortableComponent renderer_;
    bool deferredRendererRefreshPending_ = false;
};

}  // namespace synth_runtime
