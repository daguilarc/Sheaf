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
        File
    };

    explicit MainPane(Runtime<App>& runtime)
        : runtime_(runtime)
        , services_(runtime_)
        , mainComponent_(runtime_.GetEngine().Application(), services_)
        , renderer_(mainComponent_)
    {
        services_.SetFocusGuard([this] { return renderer_.hasKeyboardFocus(true); });
        mainComponent_.SetActionHandler([this](const synth::ui::Action&) {
            renderer_.RefreshFromSurface();
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
        renderer_.setBounds(getLocalBounds());
        renderer_.RefreshFromSurface();
    }

    synth::ui::Bounds IntrinsicBounds() const
    {
        return mainComponent_.IntrinsicBounds();
    }

private:
    static synth::runtime_ui::RuntimeMainPage ToRuntimeMainPage(Page page)
    {
        switch (page) {
            case Page::Audio:
                return synth::runtime_ui::RuntimeMainPage::Audio;
            case Page::Controllers:
                return synth::runtime_ui::RuntimeMainPage::Controllers;
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
};

}  // namespace synth_runtime
