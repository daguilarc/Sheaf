#pragma once

#include "synth/AppConcepts.hpp"
#include "synth/browser/BrowserRuntime.hpp"

namespace synth_browser {

template <typename App>
concept BrowserApplication = synth::SynthApplication<App>;

template <BrowserApplication App>
struct BrowserAppBinding {
    using AppType = App;
};

}  // namespace synth_browser

#define SYNTH_BROWSER_APP(AppType) \
    extern "C" ::synth_browser::RuntimeAbi* synth_browser_create_runtime() { \
        static_assert(::synth_browser::BrowserApplication<AppType>); \
        return new ::synth_browser::RuntimeAbiAdapter<AppType>(); \
    } \
    extern "C" void* synth_browser_app_type_anchor() { \
        static ::synth_browser::BrowserAppBinding<AppType> binding; \
        return &binding; \
    }
