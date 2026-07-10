#pragma once

#include "Dresden4Core.hpp"
#include "Dresden4UI.hpp"

namespace synth_dresden4 {

class Dresden4 : public Dresden4Core
{
public:
    void Init(synth::AppContext* context)
    {
        Dresden4Core::Init(context);
        ui_.Attach(context, this);
    }

    synth::ui::Surface& PortableSurface()
    {
        return ui_;
    }

private:
    Dresden4UiSurface ui_;
};

}  // namespace synth_dresden4
