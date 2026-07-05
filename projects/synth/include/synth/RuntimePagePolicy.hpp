#pragma once

namespace synth {

enum class RuntimePageKind {
    None,
    Audio,
    Controllers,
    File,
};

inline bool RuntimePageBackSavesConfiguration(RuntimePageKind page) {
    return page == RuntimePageKind::Audio || page == RuntimePageKind::Controllers;
}

}  // namespace synth
