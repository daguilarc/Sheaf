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
#include <functional>
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
        // Twister side-button system rows only (sru-8/D1): the logical side
        // button 0..5, persisted as control->cc = 8 + button on the fixed
        // channel 3 (display-only, not independently editable). Kept
        // distinct from Field::Cc (which means "raw CC 0-127" everywhere
        // else) so its 0..5 validation domain and "Btn" label can't be
        // confused with a generic Cc editor.
        Button,
    };

    // Groups rows into contiguous runs of the same on-screen schema, so the
    // renderer can insert a column-header row (and, for the non-tabular
    // Encoder groups / the scene-blend group, a divider + short caption)
    // whenever `group` changes from the previous row in a section's row
    // list. See ColumnHeadersForGroup()/FieldShortLabel() for the header
    // strings and FieldIsInteger() for how individual cells format.
    enum class RowGroup {
        EncoderTurn,
        EncoderPush,
        EncoderMode,
        EncoderStep,
        AnalogGesture,
        AnalogSceneBlend,
        System,
    };

    std::string label;  // e.g. "turn ch0 cc12 -> slot 0 pos 3"
    // Fields this row exposes for editing, in display order. ApplyMappingEdit
    // rejects a (Field) not present in a given row's editable set (the JUCE
    // page is expected to only render controls for fields present here, but
    // the view model itself is the source of truth for what's legal).
    std::vector<Field> editableFields;
    RowGroup group = RowGroup::System;
};

enum class MidiConfigSection { Encoders, SystemMessages, Analogs };

// One selectable entry in the system-message combo box rendered for a
// SystemMessages row's PressMessage/ReleaseMessage fields. `label` is the
// human-readable combo entry; `Build()` constructs the MessageIn this entry
// represents (timestamp 0 -- system-message MessageIns carry no meaningful
// timestamp until dispatched at runtime, matching how the default profile
// factories in MidiController.cpp construct them). "None" (index 0) is only
// legal for ReleaseMessage, where it clears the association's optional
// release; applying it to PressMessage is refused by ApplyMappingEdit since
// press is not optional.
struct SystemMessageChoice {
    std::string label;
    std::function<MessageIn()> build;
};

// The fixed catalog of system messages assignable via PressMessage/
// ReleaseMessage edits. Covers every MessageIn kind and parameter the three
// kind default-profile factories (WrldBldrDefaultProfileConfig,
// MfTwisterDefaultProfileConfig, LaunchpadDefaultProfileConfig -- see
// src/MidiController.cpp) actually construct with their default options, so
// every default-profile system-message row's current press/release message
// round-trips to a catalog index via SystemMessageChoiceIndex(). Index 0 is
// always "None" (release-only, see above); indices are otherwise stable for
// the lifetime of the catalog (UI code may cache them across a session).
const std::vector<SystemMessageChoice>& SystemMessageCatalog();

// True for every field the renderer formats as a plain integer (no decimal
// places -- Channel, Cc, SlotIx, Position, GestureIx, LaunchpadX/Y,
// WrldBldrX/Y). False for TurnStep (a decimal float) and for the
// non-numeric-editor fields (RelativeMode, PressMessage, ReleaseMessage --
// RelativeMode renders as a combo box via RelativeModeCatalog(), and
// Press/ReleaseMessage render as combos over SystemMessageCatalog()).
bool FieldIsInteger(MidiMappingRowVM::Field field);

// Display names for EncoderRelativeMode, indexed by the enum's declaration
// order (index 0 == EncoderRelativeMode::Signed7Bit, index 1 ==
// EncoderRelativeMode::DirectionOnly). ApplyMappingEdit's Field::RelativeMode
// case treats its `value` as an index into this catalog (see that method's
// doc comment); RowFieldValue's Field::RelativeMode case returns the current
// mode's index here, so a JUCE combo's selection and this catalog can never
// drift apart.
const std::vector<std::string>& RelativeModeCatalog();

// Short column-header label for a single field ("Ch", "CC", "Slot", "Pos",
// "Gesture", "X", "Y", "Step", "Mode", "Press", "Release") -- the single
// source of truth the renderer uses to build a header row from a group of
// rows' shared editableFields, so header text can never drift from what a
// row actually renders.
const char* FieldShortLabel(MidiMappingRowVM::Field field);

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

    // Reads the current value of a single editable field on a single row,
    // identified the same way SectionRows()/ApplyMappingEdit() identify rows:
    // (controllerIx, section, rowIx). Implemented next to SectionRows() (both
    // walk the same row layout via ForEachEncoderRow/ForEachAnalogRow in the
    // .cpp) so the two can never drift apart -- this is the single source of
    // truth for "what does this row's field currently show," used both to
    // seed a JUCE editor's initial displayed text and to revert it after a
    // refused edit. Returns false (leaving `out` untouched) for an
    // out-of-range controllerIx/rowIx, a field not advertised in this row's
    // editableFields (see SectionRows()), or PressMessage/ReleaseMessage
    // (those have no single numeric value -- callers use
    // SystemMessageChoiceIndex() instead); otherwise writes the field's
    // current value into `out` and returns true. For Field::RelativeMode,
    // `out` is the current mode's index into RelativeModeCatalog() (not the
    // raw enum value), matching ApplyMappingEdit's index-based contract for
    // that field below.
    bool RowFieldValue(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx,
                       MidiMappingRowVM::Field field, double& out) const;

    // Looks up the current press/release message of a SystemMessages row
    // (identified the same way ApplyMappingEdit/SectionRows identify rows:
    // (controllerIx, section, rowIx)) against SystemMessageCatalog() and
    // returns its index there, so a JUCE combo box can preselect the row's
    // current state. `field` must be PressMessage or ReleaseMessage; any
    // other field, an out-of-range (controllerIx, rowIx), a non-SystemMessages
    // section, or a message that doesn't match any catalog entry all return
    // -1. For ReleaseMessage, an absent `release` (std::nullopt) returns 0
    // (the catalog's "None" entry).
    int SystemMessageChoiceIndex(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx,
                                 MidiMappingRowVM::Field field) const;

    // Edits operate on a COPY of the last-Rebuild()'t instrument. On success,
    // `out` holds the fully edited instrument for the host to commit via
    // engine.EditInstrument (which triggers the runtime's reconcile pass);
    // the view model's own snapshot is untouched either way -- the host is
    // expected to Rebuild() again once the commit lands. On failure, `out`
    // is left untouched and, if `reason` is non-null, it is set to a
    // human-readable explanation (from SlotValidForKind, or a view-model
    // level message for e.g. duplicate names / out-of-range indices / values
    // that fail this field's validation -- see the .cpp for the exact domain
    // checked per Field: Channel 0-15, Cc 0-127, SlotIx/Position/GestureIx/
    // bank & scene indices non-negative integers, TurnStep a positive finite
    // float, RelativeMode a valid RelativeModeCatalog() index, LaunchpadX/Y
    // validated via LaunchpadShapeSupports for the row's launchpad
    // controller, WrldBldrX/Y within WrldBldrPositionToCC's 0-7 grid,
    // PressMessage/ReleaseMessage a valid SystemMessageCatalog() index
    // (ReleaseMessage additionally accepts index 0/"None" to clear the
    // optional release)). `value`'s domain check requires it be integral
    // (value == std::floor(value)) for every field above except TurnStep;
    // every index-shaped field (SlotIx/Position/GestureIx/RelativeMode/
    // PressMessage/ReleaseMessage) additionally caps `value` at min(2^53,
    // size_t(-1)) so it survives the later static_cast<std::size_t> without
    // undefined behavior. Before any of the above, `field` is checked against
    // this row's SectionRows() editableFields and refused with "field not
    // editable for this row" if absent -- e.g. Launchpad SystemMessages rows
    // only advertise their position fields plus PressMessage/ReleaseMessage,
    // so a direct Channel/Cc edit on them is refused here (their paired
    // `control` address is only ever writable via the LaunchpadX/Y path,
    // keeping it consistent). WRLD.Bldr SystemMessages rows advertise
    // Channel (writable directly against association.control->channel) plus
    // WrldBldrX/WrldBldrY (which write both `wrldBldrPosition` and
    // `control->cc` together) and PressMessage/ReleaseMessage.
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
