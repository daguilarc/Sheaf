#include "synth/DspWavetable.hpp"

namespace synth {

const DefaultMorphingWavetable& GetDefaultMorphingWavetable() {
    static const DefaultMorphingWavetable table = MakeDefaultMorphingWavetable<12>();
    return table;
}

} // namespace synth
