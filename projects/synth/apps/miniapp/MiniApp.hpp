#pragma once

// synth_miniapp::MiniApp — portable-UI application wrapper around MiniAppCore
// (Plan 3 Task 6), satisfying synth::SynthApplication so it can run under
// synth_runtime::Runtime/ShellComponent (runtime/Runtime.hpp,
// runtime/Shell.hpp).
//
// JUCE rendering and widget hosting live in the JUCE backend (Task 3);
// this header stays JUCE-free and exposes the portable semantic surface via
// PortableSurface(). Patch buttons, MIDI device controls, and patch logging
// remain owned by the runtime shell (FilePage / ControllersPage / Runtime).

#include "MiniAppCore.hpp"
#include "MiniAppUI.hpp"

namespace synth_miniapp {

class MiniApp : public MiniAppCore
{
public:
    void Init(synth::AppContext* context)
    {
        MiniAppCore::Init(context);
        ui_.Attach(context, this);
    }

    synth::ui::Surface& PortableSurface()
    {
        return ui_;
    }

private:
    MiniAppUiSurface ui_;
};

}  // namespace synth_miniapp
