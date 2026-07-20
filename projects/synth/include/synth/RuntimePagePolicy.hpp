#pragma once

namespace synth {

enum class RuntimePageKind {
    None,
    Audio,
    Controllers,
    Sync,
    File,
};

inline bool RuntimePageBackSavesConfiguration(RuntimePageKind page) {
    return page == RuntimePageKind::Audio || page == RuntimePageKind::Controllers ||
           page == RuntimePageKind::Sync;
}

}  // namespace synth
