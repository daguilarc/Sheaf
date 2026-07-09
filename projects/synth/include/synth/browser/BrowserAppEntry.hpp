#pragma once

#include "synth/AppConcepts.hpp"

namespace synth_browser {

template <typename App>
concept BrowserApplication = synth::SynthApplication<App>;

template <BrowserApplication App>
struct BrowserAppBinding {
    using AppType = App;
};

}  // namespace synth_browser

#define SYNTH_BROWSER_APP(AppType) \
    extern "C" void* synth_browser_app_type_anchor() { \
        static_assert(::synth_browser::BrowserApplication<AppType>); \
        return nullptr; \
    }
