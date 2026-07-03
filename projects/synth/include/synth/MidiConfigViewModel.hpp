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

#include "synth/MidiConfigBlocks.hpp"
#include "synth/MidiController.hpp"
#include "synth/MidiReconcile.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <map>
#include <string>
#include <variant>
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
//
// Presentation (midi-config-blocks change, task group 2 / design.md D5): a
// row is one of three kinds (see `kind` below) --
//   Individual  -- one config element (an encoder turn/push mapping, an
//                  analog gesture mapping, or a system-message association).
//   Block       -- a run of >=2 config elements presented/edited as a single
//                  block (EncoderBlock/AnalogBlock/SystemBlock, per
//                  MidiConfigBlocks.hpp); editableFields exposes the BLOCK's
//                  own fields (BlockStartCc/BlockEndCc/... below), not the
//                  individual cells'.
//   ConfigLevel -- relative mode, turn step, or scene blend: exactly as
//                  before, never deletable, never part of a block.
// `deletable` is the renderer's single source of truth for whether to show a
// delete ("x") affordance -- true for Individual and Block rows, false for
// ConfigLevel (sru-11's "config-level rows are not deletable").
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
        // --- Block-row fields (kind == Block only; task group 2 / D3/D6) ---
        // A block row's editableFields is drawn from this subset, per its
        // form (EncoderBlock/AnalogBlock/SystemBlock 1-D generic/2-D
        // wrldbldr-launchpad):
        //   EncoderBlock:  Channel, BlockStartCc, BlockEndCc, SlotIx,
        //                  BlockStartPos
        //   AnalogBlock:   Channel, BlockStartCc, BlockEndCc, BlockStartArg
        //                  (start gesture index)
        //   SystemBlock generic (1-D):   BlockMessageType, Channel,
        //                  BlockStartCc, BlockEndCc, BlockStartArg,
        //                  BlockOutputFeedback (BlockBankSlotIx too when
        //                  BlockMessageType == BankSelect)
        //   SystemBlock wrldbldr/launchpad (2-D): BlockMessageType,
        //                  [Channel -- wrldbldr only], BlockStartX,
        //                  BlockStartY, BlockEndX, BlockEndY,
        //                  BlockStartArg, BlockRowMajor,
        //                  BlockOutputFeedback (+ BlockBankSlotIx for
        //                  BankSelect)
        // BlockStartCc/BlockEndCc reuse none of Cc's semantics (Cc means "one
        // mapping's raw cc"); kept distinct so a block's [start,end) pair
        // can't be confused with an individual row's single Cc field.
        BlockStartCc,
        BlockEndCc,
        BlockStartPos,     // EncoderBlock::startPosition
        BlockStartArg,     // AnalogBlock::startGestureIx or SystemBlock::startArg
        BlockBankSlotIx,   // SystemBlock::bankSlotIx (BankSelect message type only)
        BlockStartX,
        BlockStartY,
        BlockEndX,
        BlockEndY,
        BlockRowMajor,        // 0/1 toggle (SystemBlock::rowMajor)
        BlockOutputFeedback,  // 0/1 toggle (SystemBlock::outputFeedback)
        BlockMessageType,     // index into BlockableMessageCatalog() (3 entries)
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

    enum class Kind { Individual, Block, ConfigLevel };

    std::string label;  // e.g. "turn ch0 cc12 -> slot 0 pos 3", or a block summary
    // Fields this row exposes for editing, in display order. ApplyMappingEdit
    // rejects a (Field) not present in a given row's editable set (the JUCE
    // page is expected to only render controls for fields present here, but
    // the view model itself is the source of truth for what's legal).
    std::vector<Field> editableFields;
    RowGroup group = RowGroup::System;
    Kind kind = Kind::Individual;
    bool deletable = false;  // CanDeleteRow()'s cached answer for this row; see that method's doc comment
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

// The fixed 3-entry catalog backing a system Block row's BlockMessageType
// field/combo -- one entry per BlockableMessage value (MidiConfigBlocks.hpp),
// in that enum's declaration order (0 = SceneSelect, 1 = BankSelect,
// 2 = GestureSelect). ApplyMappingEdit's BlockMessageType case and
// RowFieldValue's BlockMessageType case both treat their double as/return an
// index into this vector, matching the RelativeModeCatalog/
// SystemMessageCatalog index convention used elsewhere on this page.
const std::vector<std::string>& BlockableMessageCatalog();

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

// --- Presentation identity (task group 2 / design.md D5) -------------------
//
// Internal to MidiConfigViewModel -- exposed at namespace (not class) scope,
// in a `detail` sub-namespace, purely so the .cpp's free helper functions
// (identity computation/resolution, presentation building) can name these
// types without becoming member functions; nothing outside
// MidiConfigViewModel.cpp is expected to use `detail::` directly. A row's
// identity survives a Rebuild() (index-shifting, canonical re-sort included)
// by naming WHAT a row is about rather than WHERE it currently sits in the
// config's vectors. `RowIdentity` is the discriminated union of the three
// per-section identity shapes sru-11 specifies; `PresentationRow` pairs one
// (or, for a block, several) identity with the row's on-screen kind/group
// and -- for a block row -- the block struct itself (kept authoritative
// between edits so the row can re-render without re-deriving the block from
// its covered cells).
namespace detail {

struct EncoderIdentity {
    bool isPush = false;
    std::size_t slotIx = 0;
    std::size_t position = 0;
    friend bool operator==(const EncoderIdentity&, const EncoderIdentity&) = default;
};
struct AnalogIdentity {
    bool isSceneBlend = false;  // true: the (at most one) scene-blend config-level row
    std::size_t gestureIx = 0;  // meaningful iff !isSceneBlend
    friend bool operator==(const AnalogIdentity&, const AnalogIdentity&) = default;
};
struct SystemIdentity {
    SystemMessageSortKey key;
    std::size_t occurrenceOrdinal = 0;  // breaks ties among cells sharing an identical key
    friend bool operator==(const SystemIdentity&, const SystemIdentity&) = default;
};
using RowIdentity = std::variant<EncoderIdentity, AnalogIdentity, SystemIdentity>;

struct PresentationRow {
    MidiMappingRowVM::Kind kind = MidiMappingRowVM::Kind::Individual;
    MidiMappingRowVM::RowGroup group = MidiMappingRowVM::RowGroup::System;
    // Individual/ConfigLevel: exactly one identity. Block: one identity per
    // covered cell, in the block's own traversal order (matches Expand*'s
    // cell order) -- re-resolved as a set on Rebuild(); if ANY covered
    // identity fails to resolve the whole block row drops (a block is one
    // edit/delete unit, so a partially-resolved block would silently
    // discard cells the user never asked to remove).
    std::vector<RowIdentity> identities;
    // Block rows only: the block struct, AUTHORITATIVELY re-derived from the
    // live config on every Rebuild() (ReSyncBlockRow in the .cpp) -- once the
    // covered identities above resolve, Rebuild() re-runs the section's
    // Reconstruct* over just those covered cells and overwrites this field
    // with the result, so config truth always wins over whatever an
    // ApplyMappingEdit/AddBlock call optimistically staged here (see
    // SectionPresentation's doc comment below). This never RE-PARTITIONS the
    // presentation into different/more/fewer rows (D5's "stable ... without
    // re-grouping" -- the covered cell SET, i.e. `identities`, is untouched
    // by this re-derivation), it only refreshes this one row's field values
    // to match its already-fixed cell set; if that cell set no longer forms
    // exactly one block (e.g. an address moved so cells are no longer
    // consecutive), the row is dropped like any other unresolvable row
    // instead of holding a stale struct.
    std::variant<std::monostate, EncoderBlock, AnalogBlock, SystemBlock> block;
};

// One controller+section's presentation: built (via MidiConfigBlocks.hpp
// Reconstruct*) the first time SectionRows() is read for a (controllerIx,
// section) with no existing entry here -- which in practice IS "the
// collapsed->expanded transition" (D5), since the renderer only ever reads
// SectionRows() for an expanded section -- and discarded by ToggleSection()
// on an expanded->collapsed flip. While an entry exists, Rebuild()
// re-resolves its rows' identities against the fresh snapshot (dropping
// unresolvable ones, appending new config-only identities as individual rows
// at their group's end) but never re-partitions rows into new blocks
// (D5/sru-11's stability guarantee) -- see RebuildPresentationFor() in the
// .cpp.
//
// Block-commit staging (review findings 1/2): a block row's identities name
// its COVERED CELLS (see PresentationRow::identities above), so an edit that
// changes those cells' addresses/positions/arguments (ApplyMappingEdit's
// Block branch) or an AddBlock append changes what a subsequent
// RebuildPresentationFor() needs to re-resolve against. Per this class's
// edit contract (top of file / ApplyMappingEdit's doc comment below): the
// edit methods populate `out` for the HOST to commit, and never assume it
// landed. To still satisfy sru-11's "the block row stays in place with
// updated values" / "+B ... the block row appears at the end of the group"
// once the host DOES commit `out` and calls Rebuild() again (the only
// pattern any current caller -- ControllersPage.hpp -- uses),
// ApplyMappingEdit/AddBlock optimistically write the new block struct +
// identities into THIS view model's own `presentations_` entry at the same
// time they populate `out` (see MidiConfigViewModel.cpp's
// IdentitiesForEncoderExpansion/IdentitiesForAnalogExpansion/
// IdentitiesForSystemExpansion and their call sites). This is a same-
// instance cache-priming hint, not a claim that the edit landed: if the
// host discards `out`, the next real Rebuild() re-resolves this row's
// identities against whatever config actually exists. Two cases:
//   - The staged identities no longer resolve at all (an edit that changed
//     which cells the row covers, e.g. a BlockStartPos/BlockStartCc edit) --
//     the row drops and its cells re-append as individuals below, same as
//     any other stale identity.
//   - The staged identities STILL resolve (e.g. a Channel-only edit, which
//     never changes identity) but now point at cells whose VALUES don't
//     match the staged struct (the discarded edit's values, or whatever a
//     patch load happened to land) -- PresentationRow::block's doc comment
//     above covers this: Rebuild() re-derives the block struct from those
//     resolved cells' ACTUAL config values (ReSyncBlockRow), so the row
//     heals to config truth rather than keeping the stale staged struct.
// Either way it cannot corrupt anything, and a host that always commits
// `out` before its next Rebuild() (the only pattern any current caller
// uses) sees the row stay put with correct values every time.
//
// Erasure on controller removal (review finding 5): Rebuild() ERASES (not
// just empties) the SectionPresentation entry for a controller name that no
// longer resolves, and the matching ExpandState entry in expandState_ below
// -- so a LATER controller reusing that same name (remove, then re-add) is
// treated as a genuinely fresh appearance (lazy-rebuilds its presentation
// from scratch on next expand, starts fully collapsed) rather than
// inheriting the old, now-meaningless entry.
struct SectionPresentation {
    std::vector<PresentationRow> rows;
};

}  // namespace detail

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

    // Looks up a system Block row's current message type as an index into
    // BlockableMessageCatalog(), so a JUCE combo box can preselect the row's
    // current state -- the Field::BlockMessageType counterpart to
    // SystemMessageChoiceIndex() above (RowFieldValue() deliberately refuses
    // BlockMessageType, per its own doc comment, since a message type is not
    // a single numeric value; this is the dedicated accessor callers use
    // instead, mirroring the PressMessage/ReleaseMessage convention). Returns
    // -1 for a non-SystemMessages section, an out-of-range (controllerIx,
    // rowIx), or a row that is not a system Block row (an Individual/
    // ConfigLevel row, or an Encoder/Analog Block row -- neither has a
    // BlockMessageType).
    int BlockMessageTypeIndex(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx) const;

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

    // --- Presentation: add/delete (task group 2 / design.md D5, sru-11) ----
    //
    // Every mutating presentation method below shares ApplyMappingEdit's
    // contract: `out` is populated (and normalized via
    // NormalizeMidiProfileConfig, sru-9) only on success; on failure `out` is
    // untouched and `reason` (if non-null) explains why. None of them mutate
    // this view model's own snapshot or presentation state -- exactly like
    // ApplyMappingEdit, the host commits `out` and calls Rebuild() again.
    // rowIx always means "presentation-row index" (SectionRows()' index
    // space), the same convention ApplyMappingEdit/RowFieldValue already use.

    // True iff the row at (controllerIx, section, rowIx) may be deleted --
    // Individual and Block rows (MidiMappingRowVM::Kind), never ConfigLevel
    // (relative mode/turn step/scene blend, sru-11's "config-level rows are
    // not deletable"). Mirrors (and is the single source of truth behind)
    // each SectionRows() row's own cached `deletable` field -- exposed
    // separately so the renderer can query it without re-deriving the whole
    // row list, e.g. to decide whether to paint a delete button before the
    // row itself is constructed.
    bool CanDeleteRow(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx) const;

    // Deletes the row at (controllerIx, section, rowIx): for an Individual
    // row, removes that one config element (encoder mapping / analog gesture
    // mapping / system-message association); for a Block row, removes every
    // config element the block covers in the SAME commit (sru-11's "a block
    // delete removes all its cells in one commit"). Refused (false, `out`
    // untouched) for a ConfigLevel row, an out-of-range (controllerIx,
    // rowIx), or a row whose identity no longer resolves against the current
    // snapshot (should not happen for a freshly-read SectionRows() index,
    // but guarded the same way every other index-taking method here is).
    bool DeleteRow(std::size_t controllerIx, MidiConfigSection section, std::size_t rowIx, MidiInstrumentConfig& out,
                   std::string* reason = nullptr) const;

    // Appends one new Individual row to `group` with kind-appropriate
    // "next-free" defaults (sru-11's "+": the lowest address/argument not
    // already used by that group -- see the .cpp's NextFree* helpers for the
    // exact per-group rule) and commits it. `group` must be one of the row
    // groups SectionRows() can produce for `section` on this controller's
    // kind (EncoderTurn/EncoderPush for Encoders; AnalogGesture for Analogs;
    // System for SystemMessages -- EncoderMode/EncoderStep/AnalogSceneBlend
    // are config-level, never addable, and refused here) -- refused
    // otherwise. The section need not be expanded first; this call also
    // works against a section whose presentation has not yet been built
    // (SectionRows() lazily builds on first read either way, per this
    // class's presentation doc comment above ToggleSection()).
    bool AddSingle(std::size_t controllerIx, MidiConfigSection section, MidiMappingRowVM::RowGroup group,
                   MidiInstrumentConfig& out, std::string* reason = nullptr) const;

    // Appends one new Block row to `group`, seeded from the next free
    // address/argument range (same "next free" rule AddSingle uses, sized to
    // a small default run -- see the .cpp), committing its expansion in one
    // shot (sru-11's "+B": "append a block, committed as its expansion").
    // Only legal where blocks apply (EncoderTurn/EncoderPush/AnalogGesture,
    // and System for a kind/message combination that supports blocking --
    // never MfTwister, D4 point 3); refused with a reason otherwise
    // (including "no room for a default block" if no >=2-wide free range
    // exists in the group's domain).
    bool AddBlock(std::size_t controllerIx, MidiConfigSection section, MidiMappingRowVM::RowGroup group,
                 MidiInstrumentConfig& out, std::string* reason = nullptr) const;

private:
    struct ExpandState {
        bool configExpanded = false;
        std::map<MidiConfigSection, bool> sections;
    };

    ExpandState& StateFor(const std::string& name);
    const ExpandState* StateForConst(const std::string& name) const;

    // Keyed by (controller name, section) so presentation survives a
    // Rebuild() the same way ExpandState does (name-keyed, reorder-stable).
    using PresentationKey = std::pair<std::string, MidiConfigSection>;

    std::vector<MidiMappingRowVM> BuildSectionRows(std::size_t controllerIx, MidiConfigSection section) const;
    detail::SectionPresentation& PresentationFor(std::size_t controllerIx, MidiConfigSection section) const;
    void DiscardPresentation(const std::string& name, MidiConfigSection section);
    void RebuildPresentationFor(detail::SectionPresentation& presentation, const MidiControllerProfileConfig& config,
                               MidiProfileKind kind, MidiConfigSection section) const;

    MidiInstrumentConfig instrument_;
    MidiConnectionState connection_;
    std::vector<MidiControllerRowVM> controllers_;
    std::map<std::string, ExpandState> expandState_;
    // `mutable`: SectionRows() is const (matching its pre-existing contract
    // used throughout the renderer/tests) but must lazily build a missing
    // presentation entry on first read -- the lazy-build is an internal
    // caching detail, not an observable state change (the built presentation
    // is a pure function of instrument_ at read time), same justification as
    // any other const-correct memoization.
    mutable std::map<PresentationKey, detail::SectionPresentation> presentations_;
};

} // namespace synth
