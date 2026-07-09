#include "synth/AppConcepts.hpp"
#include "synth/AppContext.hpp"
#include "synth/Engine.hpp"
#include "synth/PortableUI.hpp"
#include "synth/browser/BrowserAppEntry.hpp"

#include <type_traits>
#include <utility>

namespace {
class EmptySurface final : public synth::ui::Surface {
public:
    synth::ui::NodeTree BuildTree() override { return {}; }
    void SetActionHandler(ActionHandler handler) override { handler_ = std::move(handler); }
    void DispatchAction(const synth::ui::Action& action) override
    {
        if (handler_) handler_(action);
    }

private:
    ActionHandler handler_;
};

class ValidApp {
public:
    static synth::RuntimeConfig Config() { return synth::RuntimeConfig{.appName = "FakeBrowserApp"}; }
    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
    synth::ui::Surface& PortableSurface() { return surface_; }

private:
    EmptySurface surface_;
};

class MissingSurface {
public:
    static synth::RuntimeConfig Config() { return {}; }
    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
};
}  // namespace

int main()
{
    static_assert(synth::SynthApplication<ValidApp>);
    static_assert(synth_browser::BrowserApplication<ValidApp>);
    static_assert(!synth_browser::BrowserApplication<MissingSurface>);
    static_assert(!synth::SynthApplication<MissingSurface>);
    return 0;
}
