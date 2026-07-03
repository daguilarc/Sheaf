#pragma once

// MidiConfigViewModel.hpp — JUCE-free view model for the Controllers page.
//
// This header (and its .cpp) contain ALL tree/edit logic for the Controllers
// page; the upcoming JUCE page is a thin renderer over this model (Plan 4
// Task 1). Nothing here includes JUCE, so it is headlessly testable via
// tests/viewmodel_tests.cpp.
//
// Edits (ApplyMappingEdit/AddController/SetEndpointRef) never mutate the
// view model's own snapshot -- they operate on a COPY of the instrument the
// model was last Rebuild() with, and only populate the `out` parameter when
// the resulting instrument passes validity (SlotValidForKind + name
// uniqueness). The host commits `out` via engine.EditInstrument and then
// calls Rebuild() again with the freshly reconciled state; this view model
// never assumes its own snapshot changed just because an edit returned true.

#include "synth/MidiController.hpp"
#include "synth/MidiReconcile.hpp"

#include <array>
#include <cstddef>
#include <map>
#include <string>
#include <vector>

namespace synth {

// 256-slot ring buffer tracking a rolling maximum. Message-thread only (no
// atomics) -- callers write once per UI timer tick and read back for display
// (e.g. the sidebar's deadline readout, sru-2). Once 256 values have been
// written, each new Write() overwrites the oldest slot, so the max "forgets"
// spikes older than the last 256 writes.
struct RollingMax256 {
    static constexpr std::size_t kCapacity = 256;

    void Write(float v) {
        values_[next_] = v;
        next_ = (next_ + 1) % kCapacity;
        if (filled_ < kCapacity) {
            ++filled_;
        }
    }

    float Max() const {
        float result = 0.0f;
        bool any = false;
        for (std::size_t ix = 0; ix < filled_; ++ix) {
            if (!any || values_[ix] > result) {
                result = values_[ix];
                any = true;
            }
        }
        return result;
    }

private:
    std::array<float, kCapacity> values_{};
    std::size_t next_ = 0;
    std::size_t filled_ = 0;
};

// One editable row rendered inside a section's mapping list.
struct MidiMappingRowVM {
    enum class Field {
        Channel,
        Cc,
        SlotIx,
        Position,
        RelativeMode,
        TurnStep,
        PressMessage,
        ReleaseMessage,
        LaunchpadX,
        LaunchpadY,
        WrldBldrX,
        WrldBldrY,
        GestureIx,
        SceneBlend,
    };

    std::string label;  // e.g. "turn ch0 cc12 -> slot 0 pos 3"
    // Fields this row exposes for editing, in display order. ApplyMappingEdit
    // rejects a (Field) not present in a given row's editable set (the JUCE
    // page is expected to only render controls for fields present here, but
    // the view model itself is the source of truth for what's legal).
    std::vector<Field> editableFields;
};

enum class MidiConfigSection { Encoders, SystemMessages, Analogs };

struct MidiControllerRowVM {
    std::string name;
    MidiProfileKind kind = MidiProfileKind::Generic;
    MidiEndpointStatus inputStatus = MidiEndpointStatus::Unconfigured;
    MidiEndpointStatus outputStatus = MidiEndpointStatus::Unconfigured;
    std::string inputDeviceLabel;   // present device name; stored ref + " (offline)"; or "(none)"
    std::string outputDeviceLabel;
    bool configExpanded = false;    // starts false
    std::vector<MidiConfigSection> sections;  // kind-filtered via KindSupport, each starts collapsed
};

// JUCE-free view model driving the Controllers page. Rebuild() is a pure
// data transform from the Plan 1 model (MidiInstrumentConfig) and the
// runtime's per-controller connection state (MidiConnectionState) into the
// row tree above. Expand/collapse state is kept keyed by controller NAME (in
// a std::map, so it is stable regardless of controller reordering) and
// survives across Rebuild() calls -- only a controller's first-ever
// appearance starts collapsed.
class MidiConfigViewModel {
public:
    void Rebuild(const MidiInstrumentConfig& instrument, const MidiConnectionState& connection);

    const std::vector<MidiControllerRowVM>& Controllers() const { return controllers_; }

    void ToggleConfig(std::size_t controllerIx);
    void ToggleSection(std::size_t controllerIx, MidiConfigSection section);
    bool SectionExpanded(std::size_t controllerIx, MidiConfigSection section) const;

    std::vector<MidiMappingRowVM> SectionRows(std::size_t controllerIx, MidiConfigSection section) const;

    // Edits operate on a COPY of the last-Rebuild()'t instrument. On success,
    // `out` holds the fully edited instrument for the host to commit via
    // engine.EditInstrument (which triggers the runtime's reconcile pass);
    // the view model's own snapshot is untouched either way -- the host is
    // expected to Rebuild() again once the commit lands. On failure, `out`
    // is left untouched and, if `reason` is non-null, it is set to a
    // human-readable explanation (from SlotValidForKind, or a view-model
    // level message for e.g. duplicate names / out-of-range indices).
    bool ApplyMappingEdit(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx,
                          MidiMappingRowVM::Field field, double value, MidiInstrumentConfig& out,
                          std::string* reason = nullptr) const;

    bool AddController(std::string name, MidiProfileKind kind, MidiInstrumentConfig& out,
                       std::string* reason = nullptr) const;

    bool SetEndpointRef(std::size_t controllerIx, bool output, MidiEndpointRef ref,
                        MidiInstrumentConfig& out) const;

private:
    struct ExpandState {
        bool configExpanded = false;
        std::map<MidiConfigSection, bool> sections;
    };

    ExpandState& StateFor(const std::string& name);
    const ExpandState* StateForConst(const std::string& name) const;

    MidiInstrumentConfig instrument_;
    MidiConnectionState connection_;
    std::vector<MidiControllerRowVM> controllers_;
    std::map<std::string, ExpandState> expandState_;
};

} // namespace synth
