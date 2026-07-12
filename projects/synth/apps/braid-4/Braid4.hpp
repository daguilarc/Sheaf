#pragma once

#include "Braid4Core.hpp"
#include "Braid4UI.hpp"

namespace synth_braid4 {

class Braid4 : public Braid4Core
{
public:
    void Init(synth::AppContext* context)
    {
        Braid4Core::Init(context);
        ui_.Attach(context, this);
    }

    synth::ui::Surface& PortableSurface()
    {
        return ui_;
    }

private:
    Braid4UiSurface ui_;
};

}  // namespace synth_braid4
