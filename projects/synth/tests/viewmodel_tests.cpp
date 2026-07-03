#include "synth/MidiConfigViewModel.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth module tests must not see JUCE headers"
#endif

#include <chrono>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct TestCase {
    const char* name;
    void (*fn)();
};

std::vector<TestCase>& Registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Register {
    Register(const char* name, void (*fn)()) {
        Registry().push_back({name, fn});
    }
};

#define TEST_CASE(name) \
    void name(); \
    Register reg_##name(#name, &name); \
    void name()

#define REQUIRE_TRUE(expr) \
    do { \
        if (!(expr)) { \
            std::ostringstream oss; \
            oss << __FILE__ << ":" << __LINE__ << " requirement failed: " #expr; \
            throw std::runtime_error(oss.str()); \
        } \
    } while (false)

using synth::MidiConfigSection;
using synth::MidiConfigViewModel;
using synth::MidiConnectionState;
using synth::MidiControllerConnection;
using synth::MidiControllerSlot;
using synth::MidiControllerSystemMessageAssociation;
using synth::MidiControlAddress;
using synth::EncoderRelativeMode;
using synth::FieldIsInteger;
using synth::FieldShortLabel;
using synth::MidiEndpointConnection;
using synth::MidiEndpointRef;
using synth::MidiEndpointStatus;
using synth::MidiInstrumentConfig;
using synth::MidiMappingRowVM;
using synth::MidiProfileKind;
using synth::RelativeModeCatalog;
using synth::RollingMax256;
using synth::SystemMessageCatalog;

MidiControllerSlot MakeWrldBldrSlot(const char* name) {
    MidiControllerSlot slot;
    slot.name = name;
    slot.kind = MidiProfileKind::WrldBldr;
    slot.config = synth::WrldBldrDefaultProfileConfig();
    slot.input.identifier = "wrldbldr-in-id";
    slot.input.name = "WRLD.Bldr In";
    slot.output.identifier = "wrldbldr-out-id";
    slot.output.name = "WRLD.Bldr Out";
    return slot;
}

MidiControllerSlot MakeTwisterSlot(const char* name) {
    MidiControllerSlot slot;
    slot.name = name;
    slot.kind = MidiProfileKind::MfTwister;
    slot.config = synth::MfTwisterDefaultProfileConfig();
    slot.input.identifier = "twister-in-id";
    slot.input.name = "MF Twister In";
    // Output left unconfigured to exercise the "(none)" label path.
    return slot;
}

MidiControllerSlot MakeLaunchpadSlot(const char* name) {
    MidiControllerSlot slot;
    slot.name = name;
    slot.kind = MidiProfileKind::Launchpad;
    slot.config = synth::LaunchpadDefaultProfileConfig();
    slot.input.identifier = "";
    slot.input.name = "Launchpad X";  // stored ref, no identifier match -> offline
    return slot;
}

MidiControllerSlot MakeGenericSlot(const char* name) {
    MidiControllerSlot slot;
    slot.name = name;
    slot.kind = MidiProfileKind::Generic;
    return slot;
}

// Builds the standard 4-controller instrument (one of each kind) used by
// most tests below, along with matching connection state:
//   wrld:   input Online (deviceName "WRLD.Bldr In (live)"), output Online
//   twist:  input Online, output Unconfigured
//   pads (launchpad): input Offline (stored ref "Launchpad X", no live match)
//   blank (generic): both Unconfigured
MidiInstrumentConfig MakeFourKindInstrument() {
    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(MakeWrldBldrSlot("wrld")));
    REQUIRE_TRUE(instrument.AddController(MakeTwisterSlot("twist")));
    REQUIRE_TRUE(instrument.AddController(MakeLaunchpadSlot("pads")));
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("blank")));
    return instrument;
}

MidiConnectionState MakeFourKindConnection() {
    MidiConnectionState state;
    MidiControllerConnection wrld;
    wrld.input = MidiEndpointConnection{.status = MidiEndpointStatus::Online, .openIdentifier = "wrldbldr-in-id"};
    wrld.output = MidiEndpointConnection{.status = MidiEndpointStatus::Online, .openIdentifier = "wrldbldr-out-id"};
    state.controllers.push_back(wrld);

    MidiControllerConnection twist;
    twist.input = MidiEndpointConnection{.status = MidiEndpointStatus::Online, .openIdentifier = "twister-in-id"};
    twist.output = MidiEndpointConnection{.status = MidiEndpointStatus::Unconfigured};
    state.controllers.push_back(twist);

    MidiControllerConnection pads;
    pads.input = MidiEndpointConnection{.status = MidiEndpointStatus::Offline};
    pads.output = MidiEndpointConnection{.status = MidiEndpointStatus::Unconfigured};
    state.controllers.push_back(pads);

    MidiControllerConnection blank;
    blank.input = MidiEndpointConnection{.status = MidiEndpointStatus::Unconfigured};
    blank.output = MidiEndpointConnection{.status = MidiEndpointStatus::Unconfigured};
    state.controllers.push_back(blank);

    return state;
}

std::string DumpInstrument(const MidiInstrumentConfig& instrument) {
    synth::JsonArena arena(1024 * 1024);
    const synth::JSON json = synth::ToJSON(arena, instrument);
    char* dumped = json.Dumps(JSON_ENCODE_ANY);
    std::string result = dumped != nullptr ? std::string(dumped) : std::string();
    std::free(dumped);
    return result;
}

TEST_CASE(RebuildProducesRowsInOrder) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());

    const auto& rows = vm.Controllers();
    REQUIRE_TRUE(rows.size() == 4);
    REQUIRE_TRUE(rows[0].name == "wrld");
    REQUIRE_TRUE(rows[0].kind == MidiProfileKind::WrldBldr);
    REQUIRE_TRUE(rows[1].name == "twist");
    REQUIRE_TRUE(rows[1].kind == MidiProfileKind::MfTwister);
    REQUIRE_TRUE(rows[2].name == "pads");
    REQUIRE_TRUE(rows[2].kind == MidiProfileKind::Launchpad);
    REQUIRE_TRUE(rows[3].name == "blank");
    REQUIRE_TRUE(rows[3].kind == MidiProfileKind::Generic);
}

TEST_CASE(SectionsAreKindFiltered) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());
    const auto& rows = vm.Controllers();

    auto hasSection = [](const synth::MidiControllerRowVM& row, MidiConfigSection section) {
        for (const auto& s : row.sections) {
            if (s == section) {
                return true;
            }
        }
        return false;
    };

    // wrld: Encoders + SystemMessages + Analogs
    REQUIRE_TRUE(hasSection(rows[0], MidiConfigSection::Encoders));
    REQUIRE_TRUE(hasSection(rows[0], MidiConfigSection::SystemMessages));
    REQUIRE_TRUE(hasSection(rows[0], MidiConfigSection::Analogs));

    // twist: Encoders + SystemMessages, no Analogs
    REQUIRE_TRUE(hasSection(rows[1], MidiConfigSection::Encoders));
    REQUIRE_TRUE(hasSection(rows[1], MidiConfigSection::SystemMessages));
    REQUIRE_TRUE(!hasSection(rows[1], MidiConfigSection::Analogs));

    // pads (launchpad): SystemMessages only
    REQUIRE_TRUE(!hasSection(rows[2], MidiConfigSection::Encoders));
    REQUIRE_TRUE(hasSection(rows[2], MidiConfigSection::SystemMessages));
    REQUIRE_TRUE(!hasSection(rows[2], MidiConfigSection::Analogs));

    // blank (generic): all three
    REQUIRE_TRUE(hasSection(rows[3], MidiConfigSection::Encoders));
    REQUIRE_TRUE(hasSection(rows[3], MidiConfigSection::SystemMessages));
    REQUIRE_TRUE(hasSection(rows[3], MidiConfigSection::Analogs));
}

TEST_CASE(EverythingStartsCollapsed) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());
    const auto& rows = vm.Controllers();

    for (std::size_t ix = 0; ix < rows.size(); ++ix) {
        REQUIRE_TRUE(rows[ix].configExpanded == false);
        for (MidiConfigSection section : rows[ix].sections) {
            REQUIRE_TRUE(vm.SectionExpanded(ix, section) == false);
        }
    }
}

TEST_CASE(ToggleConfigAndSectionFlipAndSurviveRebuild) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());

    vm.ToggleConfig(0);  // wrld
    vm.ToggleSection(0, MidiConfigSection::Encoders);

    REQUIRE_TRUE(vm.Controllers()[0].configExpanded == true);
    REQUIRE_TRUE(vm.SectionExpanded(0, MidiConfigSection::Encoders) == true);
    REQUIRE_TRUE(vm.SectionExpanded(0, MidiConfigSection::SystemMessages) == false);

    // Rebuild with the same controller set (state keyed by name) -- toggles survive.
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());
    REQUIRE_TRUE(vm.Controllers()[0].configExpanded == true);
    REQUIRE_TRUE(vm.SectionExpanded(0, MidiConfigSection::Encoders) == true);

    // Toggling back off flips it back.
    vm.ToggleConfig(0);
    REQUIRE_TRUE(vm.Controllers()[0].configExpanded == false);
}

TEST_CASE(ToggleStateKeyedByNameSurvivesReordering) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());
    vm.ToggleConfig(2);  // "pads"
    REQUIRE_TRUE(vm.Controllers()[2].configExpanded == true);

    // Rebuild with "pads" moved to index 0.
    MidiInstrumentConfig reordered;
    REQUIRE_TRUE(reordered.AddController(MakeLaunchpadSlot("pads")));
    REQUIRE_TRUE(reordered.AddController(MakeWrldBldrSlot("wrld")));
    MidiConnectionState reorderedConnection;
    reorderedConnection.controllers.push_back(MidiControllerConnection{});
    reorderedConnection.controllers.push_back(MidiControllerConnection{});
    vm.Rebuild(reordered, reorderedConnection);

    REQUIRE_TRUE(vm.Controllers()[0].name == "pads");
    REQUIRE_TRUE(vm.Controllers()[0].configExpanded == true);
    REQUIRE_TRUE(vm.Controllers()[1].name == "wrld");
    REQUIRE_TRUE(vm.Controllers()[1].configExpanded == false);
}

TEST_CASE(WrldBldrEncoderSectionListsSixteenTurnsAndPushes) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());

    const std::vector<MidiMappingRowVM> rows = vm.SectionRows(0, MidiConfigSection::Encoders);
    // 16 turns + 16 pushes + 2 config-level rows (RelativeMode, TurnStep).
    REQUIRE_TRUE(rows.size() == 16 + 16 + 2);

    std::size_t turnCount = 0;
    std::size_t pushCount = 0;
    for (const auto& row : rows) {
        // Distinguish per-mapping "turn ch.../push ch..." rows from the
        // config-level "turn step: ..." row, which also contains "turn".
        if (row.label.rfind("turn ch", 0) == 0) {
            ++turnCount;
        } else if (row.label.rfind("push ch", 0) == 0) {
            ++pushCount;
        }
    }
    REQUIRE_TRUE(turnCount == 16);
    REQUIRE_TRUE(pushCount == 16);
}

// --- Finding 2 (Task 4 review, Important): RowFieldValue() -----------------
//
// RowFieldValue is the VM-owned replacement for ControllersPage's old
// page-local RowFieldCurrentValue walker -- it must read the exact same
// value ApplyMappingEdit would accept/produce for that (controllerIx,
// section, rowIx, field), across every field kind the default profiles
// exercise, and return false for a field not advertised on a given row
// (mirroring ApplyMappingEdit's own editableFields gate).

TEST_CASE(RowFieldValueReadsEncoderTurnChannelCcSlotIxPosition) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto& turn = instrument.controllers[0].config.encoderInput->turns[0];
    double value = -1.0;

    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Channel, value));
    REQUIRE_TRUE(value == static_cast<double>(turn.control.channel));

    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Cc, value));
    REQUIRE_TRUE(value == static_cast<double>(turn.control.cc));

    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::SlotIx, value));
    REQUIRE_TRUE(value == static_cast<double>(turn.slotIx));

    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Position, value));
    REQUIRE_TRUE(value == static_cast<double>(turn.position));
}

TEST_CASE(RowFieldValueReadsEncoderConfigLevelRelativeModeAndTurnStep) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto& encoderInput = *instrument.controllers[0].config.encoderInput;
    const std::vector<MidiMappingRowVM> rows = vm.SectionRows(0, MidiConfigSection::Encoders);
    // Config-level rows are the last two: RelativeMode then TurnStep (see
    // ForEachEncoderRow's visit order in the .cpp).
    const std::size_t relativeModeRowIx = rows.size() - 2;
    const std::size_t turnStepRowIx = rows.size() - 1;

    double value = -1.0;
    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::Encoders, relativeModeRowIx,
                                  MidiMappingRowVM::Field::RelativeMode, value));
    REQUIRE_TRUE(value == (encoderInput.relativeMode == synth::EncoderRelativeMode::DirectionOnly ? 1.0 : 0.0));

    REQUIRE_TRUE(
        vm.RowFieldValue(0, MidiConfigSection::Encoders, turnStepRowIx, MidiMappingRowVM::Field::TurnStep, value));
    REQUIRE_TRUE(value == static_cast<double>(encoderInput.turnStep));
}

TEST_CASE(RowFieldValueReadsAnalogGestureFieldsAndSceneBlend) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto& analogInput = *instrument.controllers[0].config.analogInput;
    const auto& gesture = analogInput.gestures[0];
    double value = -1.0;

    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::Analogs, 0, MidiMappingRowVM::Field::Channel, value));
    REQUIRE_TRUE(value == static_cast<double>(gesture.control.channel));

    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::Analogs, 0, MidiMappingRowVM::Field::Cc, value));
    REQUIRE_TRUE(value == static_cast<double>(gesture.control.cc));

    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::Analogs, 0, MidiMappingRowVM::Field::GestureIx, value));
    REQUIRE_TRUE(value == static_cast<double>(gesture.gestureIx));

    const std::vector<MidiMappingRowVM> rows = vm.SectionRows(0, MidiConfigSection::Analogs);
    const std::size_t sceneBlendRowIx = rows.size() - 1;
    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::Analogs, sceneBlendRowIx, MidiMappingRowVM::Field::SceneBlend,
                                  value));
    REQUIRE_TRUE(value == static_cast<double>(analogInput.sceneBlend->cc));
}

TEST_CASE(RowFieldValueReadsWrldBldrSystemMessagePositions) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto& association = instrument.controllers[0].config.systemMessages[0];
    double value = -1.0;

    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::WrldBldrX, value));
    REQUIRE_TRUE(value == static_cast<double>(association.wrldBldrPosition->x));

    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::WrldBldrY, value));
    REQUIRE_TRUE(value == static_cast<double>(association.wrldBldrPosition->y));

    // Channel IS in this row's editableFields (issue #10 -- WRLD.Bldr system
    // rows expose chan/x/y), reading the paired control address's channel.
    // Cc remains NOT advertised: the row's cc is always derived from x/y via
    // WrldBldrPositionToCC, so there is no direct Cc editor.
    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Channel, value));
    REQUIRE_TRUE(value == static_cast<double>(association.control->channel));
    REQUIRE_TRUE(!vm.RowFieldValue(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Cc, value));
}

TEST_CASE(RowFieldValueReadsLaunchpadSystemMessagePositions) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto& association = instrument.controllers[2].config.systemMessages[0];  // "pads"
    double value = -1.0;

    REQUIRE_TRUE(
        vm.RowFieldValue(2, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::LaunchpadX, value));
    REQUIRE_TRUE(value == static_cast<double>(association.launchpadPosition->x));

    REQUIRE_TRUE(
        vm.RowFieldValue(2, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::LaunchpadY, value));
    REQUIRE_TRUE(value == static_cast<double>(association.launchpadPosition->y));

    REQUIRE_TRUE(!vm.RowFieldValue(2, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Channel, value));
}

TEST_CASE(RowFieldValueReadsTwisterSystemMessageButtonOnly) {
    // sru-8/D1: twister system rows advertise exactly one editable address
    // field -- the logical side button 0..5, persisted as control->cc = 8 +
    // button on the fixed channel 3. The zero-arg MfTwisterDefaultProfileConfig()
    // used in MakeTwisterSlot() has no side buttons configured by default
    // (see TwisterSideButtonRowButtonAndMessageFieldsAllSucceed's comment),
    // so build one directly here with a side button set.
    synth::MfTwisterDefaultProfileOptions options;
    options.sideButtons[0] = MidiControllerSystemMessageAssociation{
        .press = synth::MessageIn::SetReset(0, true),
        .release = synth::MessageIn::SetReset(0, false),
    };
    MidiControllerSlot slot;
    slot.name = "twist2";
    slot.kind = MidiProfileKind::MfTwister;
    slot.config = synth::MfTwisterDefaultProfileConfig(options);
    REQUIRE_TRUE(!slot.config.systemMessages.empty());

    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(slot));
    MidiConnectionState connection;
    connection.controllers.push_back(MidiControllerConnection{});

    MidiConfigViewModel vm;
    vm.Rebuild(instrument, connection);

    const auto& association = instrument.controllers[0].config.systemMessages[0];
    REQUIRE_TRUE(association.control->channel == 3);
    REQUIRE_TRUE(association.control->cc == 8);  // side button 0 -> cc 8 + 0

    double value = -1.0;
    REQUIRE_TRUE(vm.RowFieldValue(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Button, value));
    REQUIRE_TRUE(value == 0.0);

    // No editable Channel or Cc field -- the fixed channel is display-only
    // and the button number is the only editable address field.
    REQUIRE_TRUE(!vm.RowFieldValue(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Channel, value));
    REQUIRE_TRUE(!vm.RowFieldValue(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Cc, value));
    REQUIRE_TRUE(
        !vm.RowFieldValue(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::WrldBldrX, value));
}

TEST_CASE(ApplyMappingEditTwisterButtonWritesCcAndRefusesOutOfRange) {
    synth::MfTwisterDefaultProfileOptions options;
    options.sideButtons[0] = MidiControllerSystemMessageAssociation{
        .press = synth::MessageIn::SetReset(0, true),
        .release = synth::MessageIn::SetReset(0, false),
    };
    MidiControllerSlot slot;
    slot.name = "twist2";
    slot.kind = MidiProfileKind::MfTwister;
    slot.config = synth::MfTwisterDefaultProfileConfig(options);

    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(slot));
    MidiConnectionState connection;
    connection.controllers.push_back(MidiControllerConnection{});

    MidiConfigViewModel vm;
    vm.Rebuild(instrument, connection);

    MidiInstrumentConfig out;
    std::string reason;
    REQUIRE_TRUE(vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Button, 5.0,
                                     out, &reason));
    REQUIRE_TRUE(out.controllers[0].config.systemMessages[0].control->cc == 13);  // 8 + 5
    REQUIRE_TRUE(out.controllers[0].config.systemMessages[0].control->channel == 3);  // unchanged, fixed

    // Out-of-range button (only 0..5 valid) is refused with a reason.
    MidiInstrumentConfig rejected;
    std::string rejectReason;
    REQUIRE_TRUE(!vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Button, 6.0,
                                      rejected, &rejectReason));
    REQUIRE_TRUE(!rejectReason.empty());

    MidiInstrumentConfig rejectedNegative;
    std::string rejectReason2;
    REQUIRE_TRUE(!vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Button, -1.0,
                                      rejectedNegative, &rejectReason2));
    REQUIRE_TRUE(!rejectReason2.empty());
}

TEST_CASE(RowFieldValueReturnsFalseForPressReleaseMessageAndOutOfRange) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());

    double value = -1.0;
    // PressMessage/ReleaseMessage have no single numeric value -- callers
    // must use SystemMessageChoiceIndex() instead.
    REQUIRE_TRUE(
        !vm.RowFieldValue(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::PressMessage, value));
    REQUIRE_TRUE(
        !vm.RowFieldValue(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::ReleaseMessage, value));

    // Out-of-range controllerIx/rowIx.
    REQUIRE_TRUE(!vm.RowFieldValue(99, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Channel, value));
    REQUIRE_TRUE(!vm.RowFieldValue(0, MidiConfigSection::Encoders, 9999, MidiMappingRowVM::Field::Channel, value));
}

TEST_CASE(RowFieldValueRoundTripsWithApplyMappingEdit) {
    // For every field ApplyMappingEdit successfully applies, RowFieldValue
    // must read back the same value from the resulting instrument, so a JUCE
    // editor's "revert to VM's last-known value" path never shows something
    // ApplyMappingEdit itself would disagree with.
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig edited;
    std::string reason;
    REQUIRE_TRUE(vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Position, 7.0,
                                     edited, &reason));

    MidiConfigViewModel vmAfter;
    vmAfter.Rebuild(edited, MakeFourKindConnection());
    double value = -1.0;
    REQUIRE_TRUE(
        vmAfter.RowFieldValue(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Position, value));
    REQUIRE_TRUE(value == 7.0);
}

TEST_CASE(ApplyMappingEditChangesOnlyTargetedField) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    // Row 0 of the Encoders section for "wrld" is the first turn mapping.
    MidiInstrumentConfig edited;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Position, 5.0,
                                        edited, &reason);
    REQUIRE_TRUE(ok);
    REQUIRE_TRUE(reason.empty());

    REQUIRE_TRUE(edited.controllers[0].config.encoderInput->turns[0].position == 5);

    // Everything else must be byte-for-byte identical: zero out the one
    // field we intentionally changed on a copy of `instrument` and compare
    // full JSON dumps.
    MidiInstrumentConfig expected = instrument;
    expected.controllers[0].config.encoderInput->turns[0].position = 5;
    REQUIRE_TRUE(DumpInstrument(edited) == DumpInstrument(expected));
}

TEST_CASE(ApplyMappingEditRejectingIllegalEditLeavesOutUntouched) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    // "pads" (launchpad) SystemMessages rows carry launchpad positions only;
    // attempting to set a WrldBldrX field on one is not among that row's
    // editable fields and must be refused with a reason.
    MidiInstrumentConfig out;
    out.controllers.push_back(MakeGenericSlot("sentinel"));  // pre-populate to prove it's untouched
    std::string reason;
    const bool ok =
        vm.ApplyMappingEdit(2, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::WrldBldrX, 3.0, out,
                            &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
    REQUIRE_TRUE(out.controllers.size() == 1);
    REQUIRE_TRUE(out.controllers[0].name == "sentinel");
}

// --- Issue #10: WRLD.Bldr system rows expose an editable Channel ----------
//
// WRLD.Bldr system-message rows advertise Channel alongside WrldBldrX/
// WrldBldrY/PressMessage/ReleaseMessage (see SectionRows' SystemMessages
// case) so the slot reads chan/x/y, matching how the association's `control`
// carries both a channel and a (position-derived) cc. Channel edits write
// only `association.control->channel`; `wrldBldrPosition` and `control->cc`
// (which WrldBldrX/Y edits keep in sync via WrldBldrPositionToCC) must stay
// untouched -- this was previously refused entirely (see git history), which
// is now wrong: the user needs to retarget a slot's MIDI channel without
// also having to touch its x/y position.
TEST_CASE(ApplyMappingEditChannelOnWrldBldrSystemRowIsAccepted) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto rows = vm.SectionRows(0, MidiConfigSection::SystemMessages);
    REQUIRE_TRUE(!rows.empty());
    bool hasChannel = false;
    for (const auto& field : rows[0].editableFields) {
        if (field == MidiMappingRowVM::Field::Channel) {
            hasChannel = true;
        }
    }
    REQUIRE_TRUE(hasChannel);

    const auto& before = instrument.controllers[0].config.systemMessages[0];
    REQUIRE_TRUE(before.wrldBldrPosition.has_value());
    const auto beforePosition = *before.wrldBldrPosition;
    const auto beforeCc = before.control->cc;

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok =
        vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Channel, 5.0, out,
                            &reason);
    REQUIRE_TRUE(ok);
    REQUIRE_TRUE(reason.empty());

    const auto& after = out.controllers[0].config.systemMessages[0];
    REQUIRE_TRUE(after.control.has_value());
    REQUIRE_TRUE(after.control->channel == 5);
    REQUIRE_TRUE(after.control->cc == beforeCc);
    REQUIRE_TRUE(after.wrldBldrPosition.has_value());
    REQUIRE_TRUE(after.wrldBldrPosition->x == beforePosition.x);
    REQUIRE_TRUE(after.wrldBldrPosition->y == beforePosition.y);
    // control->channel is authoritative; the position's channel is kept synced
    // to it so a later X/Y edit (which repacks control from the channel) cannot
    // silently restore the old channel.
    REQUIRE_TRUE(after.wrldBldrPosition->channel == 5);
}

TEST_CASE(WrldBldrChannelEditSurvivesLaterXYEdit) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    // Edit the channel to 5...
    MidiInstrumentConfig afterChannel;
    std::string reason;
    REQUIRE_TRUE(vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Channel, 5.0,
                                     afterChannel, &reason));

    // ...then edit X on the just-committed config. The channel must persist.
    vm.Rebuild(afterChannel, MakeFourKindConnection());
    MidiInstrumentConfig afterXY;
    REQUIRE_TRUE(vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::WrldBldrX, 3.0,
                                     afterXY, &reason));

    const auto& after = afterXY.controllers[0].config.systemMessages[0];
    REQUIRE_TRUE(after.control.has_value());
    REQUIRE_TRUE(after.control->channel == 5);
    REQUIRE_TRUE(after.wrldBldrPosition.has_value());
    REQUIRE_TRUE(after.wrldBldrPosition->channel == 5);
    REQUIRE_TRUE(after.wrldBldrPosition->x == 3);
    // cc is repacked from the new (x,y) but the channel axis is preserved.
    REQUIRE_TRUE(after.control->cc == synth::WrldBldrPositionToCC(after.wrldBldrPosition->x, after.wrldBldrPosition->y));
}

TEST_CASE(ApplyMappingEditChannelOnWrldBldrSystemRowValidatesRange) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok =
        vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Channel, 16.0, out,
                            &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ApplyMappingEditCcOnLaunchpadSystemRowIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto rows = vm.SectionRows(2, MidiConfigSection::SystemMessages);  // "pads" (launchpad)
    REQUIRE_TRUE(!rows.empty());
    for (const auto& field : rows[0].editableFields) {
        REQUIRE_TRUE(field != MidiMappingRowVM::Field::Cc);
    }

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok =
        vm.ApplyMappingEdit(2, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::Cc, 5.0, out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(AddControllerDuplicateNameFails) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.AddController("wrld", MidiProfileKind::Generic, out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(AddControllerLaunchpadSeedsDefaultProfile) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.AddController("newpads", MidiProfileKind::Launchpad, out, &reason);
    REQUIRE_TRUE(ok);
    REQUIRE_TRUE(out.controllers.size() == 5);
    const synth::MidiControllerSlot* added = out.FindController("newpads");
    REQUIRE_TRUE(added != nullptr);
    REQUIRE_TRUE(added->kind == MidiProfileKind::Launchpad);
    REQUIRE_TRUE(!added->config.systemMessages.empty());

    const synth::MidiControllerProfileConfig expectedConfig = synth::LaunchpadDefaultProfileConfig();
    REQUIRE_TRUE(added->config.systemMessages.size() == expectedConfig.systemMessages.size());
}

TEST_CASE(AddControllerGenericSeedsEmptyConfig) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.AddController("blank2", MidiProfileKind::Generic, out, &reason);
    REQUIRE_TRUE(ok);
    const synth::MidiControllerSlot* added = out.FindController("blank2");
    REQUIRE_TRUE(added != nullptr);
    REQUIRE_TRUE(!added->config.encoderInput.has_value());
    REQUIRE_TRUE(!added->config.encoderOutput.has_value());
    REQUIRE_TRUE(!added->config.analogInput.has_value());
    REQUIRE_TRUE(added->config.systemMessages.empty());
}

TEST_CASE(SetEndpointRefWritesSlotRef) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiEndpointRef ref;
    ref.identifier = "new-device-id";
    ref.name = "New Device";

    MidiInstrumentConfig out;
    const bool ok = vm.SetEndpointRef(3, /*output=*/false, ref, out);
    REQUIRE_TRUE(ok);
    REQUIRE_TRUE(out.controllers[3].input.identifier == "new-device-id");
    REQUIRE_TRUE(out.controllers[3].input.name == "New Device");
    // Nothing else in the instrument moved.
    REQUIRE_TRUE(out.controllers.size() == instrument.controllers.size());
    REQUIRE_TRUE(out.controllers[0].name == "wrld");
}

TEST_CASE(DeviceLabelsDistinguishOnlineOfflineAndUnconfigured) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());
    const auto& rows = vm.Controllers();

    // wrld: input Online -> shows the live/stored name (not "(none)"/"(offline)").
    REQUIRE_TRUE(rows[0].inputDeviceLabel.find("(none)") == std::string::npos);
    REQUIRE_TRUE(rows[0].inputDeviceLabel.find("(offline)") == std::string::npos);
    REQUIRE_TRUE(!rows[0].inputDeviceLabel.empty());

    // twist: output Unconfigured -> "(none)".
    REQUIRE_TRUE(rows[1].outputDeviceLabel.find("(none)") != std::string::npos);

    // pads: input configured-but-absent (Offline) -> shows stored ref name + "(offline)".
    REQUIRE_TRUE(rows[2].inputDeviceLabel.find("Launchpad X") != std::string::npos);
    REQUIRE_TRUE(rows[2].inputDeviceLabel.find("(offline)") != std::string::npos);

    // blank: both Unconfigured -> "(none)" for both.
    REQUIRE_TRUE(rows[3].inputDeviceLabel.find("(none)") != std::string::npos);
    REQUIRE_TRUE(rows[3].outputDeviceLabel.find("(none)") != std::string::npos);
}

TEST_CASE(RebuildScalesToFourControllersSixtyFourRowsUnderTenMilliseconds) {
    MidiInstrumentConfig instrument;
    for (int ix = 0; ix < 4; ++ix) {
        MidiControllerSlot slot = MakeWrldBldrSlot(("scale" + std::to_string(ix)).c_str());
        REQUIRE_TRUE(instrument.AddController(std::move(slot)));
    }
    MidiConnectionState connection;
    for (int ix = 0; ix < 4; ++ix) {
        connection.controllers.push_back(MidiControllerConnection{});
    }

    MidiConfigViewModel vm;
    const auto start = std::chrono::steady_clock::now();
    vm.Rebuild(instrument, connection);
    // Also materialize the row lists (SectionRows) since that's the other
    // half of the "64 rows" scale claim -- Rebuild() alone only builds the
    // controller/section tree, not the flattened mapping rows.
    for (std::size_t ix = 0; ix < vm.Controllers().size(); ++ix) {
        for (MidiConfigSection section : vm.Controllers()[ix].sections) {
            auto rows = vm.SectionRows(ix, section);
            (void)rows;
        }
    }
    const auto elapsed = std::chrono::steady_clock::now() - start;
    // Generous margin (brief: "sanity bound, std::chrono assert with
    // generous margin") -- 10ms bound for 4 controllers x ~64 rows each.
    REQUIRE_TRUE(elapsed < std::chrono::milliseconds(10));
}

TEST_CASE(RollingMax256ReturnsMaxOfLast256Writes) {
    RollingMax256 rolling;
    REQUIRE_TRUE(rolling.Max() == 0.0f);

    rolling.Write(1.0f);
    rolling.Write(5.0f);
    rolling.Write(3.0f);
    REQUIRE_TRUE(rolling.Max() == 5.0f);
}

TEST_CASE(RollingMax256ForgetsSpikesOlderThan256Writes) {
    RollingMax256 rolling;
    rolling.Write(100.0f);  // this write will be overwritten after 256 more writes
    for (int ix = 0; ix < 256; ++ix) {
        rolling.Write(1.0f);
    }
    // The initial 100.0f write has been evicted -- 257 total writes means the
    // ring (capacity 256) has wrapped exactly once, overwriting slot 0.
    REQUIRE_TRUE(rolling.Max() == 1.0f);
}

TEST_CASE(RollingMax256KeepsSpikeUntilEvicted) {
    RollingMax256 rolling;
    rolling.Write(42.0f);
    for (int ix = 0; ix < 255; ++ix) {
        rolling.Write(0.0f);
    }
    // Only 256 total writes so far -- the initial spike is still the 0th
    // slot and has not yet been overwritten.
    REQUIRE_TRUE(rolling.Max() == 42.0f);

    rolling.Write(0.0f);  // 257th write wraps around and evicts the spike.
    REQUIRE_TRUE(rolling.Max() == 0.0f);
}

// --- Finding 1: catalog-based PressMessage/ReleaseMessage editing ---------

TEST_CASE(SystemMessageCatalogStartsWithNoneAndHasNoDuplicateLabels) {
    const auto& catalog = SystemMessageCatalog();
    REQUIRE_TRUE(!catalog.empty());
    REQUIRE_TRUE(catalog[0].label == "None");
    for (std::size_t ix = 0; ix < catalog.size(); ++ix) {
        for (std::size_t jx = ix + 1; jx < catalog.size(); ++jx) {
            REQUIRE_TRUE(catalog[ix].label != catalog[jx].label);
        }
    }
}

TEST_CASE(EveryWrldBldrDefaultProfileRowPressAndReleaseRoundTripsToACatalogIndex) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const std::size_t rowCount = instrument.controllers[0].config.systemMessages.size();
    REQUIRE_TRUE(rowCount > 0);
    for (std::size_t rowIx = 0; rowIx < rowCount; ++rowIx) {
        const int pressIx = vm.SystemMessageChoiceIndex(0, MidiConfigSection::SystemMessages, rowIx,
                                                         MidiMappingRowVM::Field::PressMessage);
        REQUIRE_TRUE(pressIx > 0);  // never "None" -- press is not optional

        const bool hasRelease = instrument.controllers[0].config.systemMessages[rowIx].release.has_value();
        const int releaseIx = vm.SystemMessageChoiceIndex(0, MidiConfigSection::SystemMessages, rowIx,
                                                           MidiMappingRowVM::Field::ReleaseMessage);
        if (hasRelease) {
            REQUIRE_TRUE(releaseIx > 0);
        } else {
            REQUIRE_TRUE(releaseIx == 0);  // "None"
        }
    }
}

TEST_CASE(EveryLaunchpadDefaultProfileRowPressAndReleaseRoundTripsToACatalogIndex) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const std::size_t rowCount = instrument.controllers[2].config.systemMessages.size();
    REQUIRE_TRUE(rowCount > 0);
    for (std::size_t rowIx = 0; rowIx < rowCount; ++rowIx) {
        const int pressIx = vm.SystemMessageChoiceIndex(2, MidiConfigSection::SystemMessages, rowIx,
                                                         MidiMappingRowVM::Field::PressMessage);
        REQUIRE_TRUE(pressIx > 0);
    }
}

TEST_CASE(ApplyMappingEditPressMessageAppliesCatalogChoice) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    // wrld row 0 defaults to Reset press (catalog index 1); switch it to
    // "Scene select 3".
    const auto& catalog = SystemMessageCatalog();
    std::size_t sceneThreeIx = 0;
    for (std::size_t ix = 0; ix < catalog.size(); ++ix) {
        if (catalog[ix].label == "Scene select 3") {
            sceneThreeIx = ix;
            break;
        }
    }
    REQUIRE_TRUE(sceneThreeIx != 0);

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::PressMessage,
                                        static_cast<double>(sceneThreeIx), out, &reason);
    REQUIRE_TRUE(ok);
    REQUIRE_TRUE(reason.empty());
    REQUIRE_TRUE(out.controllers[0].config.systemMessages[0].press.type == synth::MessageIn::Type::SceneSelect);
    REQUIRE_TRUE(out.controllers[0].config.systemMessages[0].press.sceneIx == 3);
}

TEST_CASE(ApplyMappingEditReleaseMessageNoneClearsOptional) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    // wrld row 0 has a release (Reset release) by default.
    REQUIRE_TRUE(instrument.controllers[0].config.systemMessages[0].release.has_value());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0,
                                        MidiMappingRowVM::Field::ReleaseMessage, 0.0, out, &reason);
    REQUIRE_TRUE(ok);
    REQUIRE_TRUE(!out.controllers[0].config.systemMessages[0].release.has_value());
}

TEST_CASE(ApplyMappingEditPressMessageNoneIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::PressMessage,
                                        0.0, out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ApplyMappingEditMessageChoiceOutOfRangeIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto& catalog = SystemMessageCatalog();
    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::PressMessage,
                                        static_cast<double>(catalog.size()), out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

// --- Finding 2: WrldBldrX/Y edits keep position and control address paired ---

TEST_CASE(WrldBldrXEditUpdatesBothPositionAndControlAddress) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    // Row 0 (index 0) is the reset modifier button at (0,4) in the default
    // profile (modifiers reset/random/random-mod lead the system-message list).
    const auto& before = instrument.controllers[0].config.systemMessages[0];
    REQUIRE_TRUE(before.wrldBldrPosition.has_value());
    REQUIRE_TRUE(before.wrldBldrPosition->x == 0);

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::WrldBldrX,
                                        5.0, out, &reason);
    REQUIRE_TRUE(ok);
    REQUIRE_TRUE(reason.empty());

    const auto& after = out.controllers[0].config.systemMessages[0];
    REQUIRE_TRUE(after.wrldBldrPosition.has_value());
    REQUIRE_TRUE(after.wrldBldrPosition->x == 5);
    REQUIRE_TRUE(after.wrldBldrPosition->y == before.wrldBldrPosition->y);

    // The paired control address must match the new position via
    // WrldBldrPositionToCC, since SystemButtonMidiInProcessor matches
    // incoming MIDI by `control`, not by `wrldBldrPosition`.
    REQUIRE_TRUE(after.control.has_value());
    REQUIRE_TRUE(after.control->channel == after.wrldBldrPosition->channel);
    REQUIRE_TRUE(after.control->cc ==
                synth::WrldBldrPositionToCC(after.wrldBldrPosition->x, after.wrldBldrPosition->y));
    // And it must have actually changed from the stale pre-edit address.
    REQUIRE_TRUE(after.control->cc != before.control->cc);
}

TEST_CASE(WrldBldrYEditUpdatesBothPositionAndControlAddress) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 1, MidiMappingRowVM::Field::WrldBldrY,
                                        3.0, out, &reason);
    REQUIRE_TRUE(ok);

    const auto& after = out.controllers[0].config.systemMessages[1];
    REQUIRE_TRUE(after.wrldBldrPosition->y == 3);
    REQUIRE_TRUE(after.control->cc ==
                synth::WrldBldrPositionToCC(after.wrldBldrPosition->x, after.wrldBldrPosition->y));
}

// --- Finding 3: unchecked numeric casts / validation -----------------------

TEST_CASE(ApplyMappingEditNegativeChannelIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Channel, -1.0,
                                        out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ApplyMappingEditCc128IsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok =
        vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Cc, 128.0, out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ApplyMappingEditFractionalPositionIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok =
        vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Position, 2.5, out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ApplyMappingEditNegativeSlotIxIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok =
        vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::SlotIx, -3.0, out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

// --- Finding 2: index domain checks reject values too large to round-trip
// through static_cast<std::size_t> (e.g. 1e300 is finite, non-negative, and
// == std::floor(itself), but casting it to std::size_t is undefined
// behavior) ---------------------------------------------------------------

TEST_CASE(ApplyMappingEditHugeSlotIxIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::SlotIx, 1e300,
                                        out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ApplyMappingEditHugePressMessageCatalogIndexIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 0,
                                        MidiMappingRowVM::Field::PressMessage, 1e300, out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ApplyMappingEditWrldBldrCoordinateOutOfGridIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok =
        vm.ApplyMappingEdit(0, MidiConfigSection::SystemMessages, 1, MidiMappingRowVM::Field::WrldBldrX, 8.0, out,
                            &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ApplyMappingEditLaunchpadCoordinateOutOfShapeIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    // "pads" row 0 is LaunchpadX at (0,-1); y=8 is outside LaunchpadX's shape
    // (LaunchpadShapeSupports allows y in [-1, 8) for LaunchpadX).
    MidiInstrumentConfig out;
    std::string reason;
    const bool ok =
        vm.ApplyMappingEdit(2, MidiConfigSection::SystemMessages, 0, MidiMappingRowVM::Field::LaunchpadY, 8.0, out,
                            &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ApplyMappingEditTurnStepMustBePositive) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto rows = vm.SectionRows(0, MidiConfigSection::Encoders);
    // Config-level rows are last: RelativeMode then TurnStep (see
    // ForEachEncoderRow).
    const std::size_t turnStepRowIx = rows.size() - 1;
    REQUIRE_TRUE(rows[turnStepRowIx].label.rfind("turn step", 0) == 0);

    MidiInstrumentConfig out;
    std::string reason;
    const bool negativeOk = vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, turnStepRowIx,
                                                MidiMappingRowVM::Field::TurnStep, -0.5, out, &reason);
    REQUIRE_TRUE(!negativeOk);
    REQUIRE_TRUE(!reason.empty());

    const bool zeroOk = vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, turnStepRowIx,
                                            MidiMappingRowVM::Field::TurnStep, 0.0, out, &reason);
    REQUIRE_TRUE(!zeroOk);
}

TEST_CASE(ApplyMappingEditTurnStepMustBeFiniteFloat) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto rows = vm.SectionRows(0, MidiConfigSection::Encoders);
    const std::size_t turnStepRowIx = rows.size() - 1;
    REQUIRE_TRUE(rows[turnStepRowIx].label.rfind("turn step", 0) == 0);

    MidiInstrumentConfig out;
    std::string reason;
    const bool hugeOk = vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, turnStepRowIx,
                                            MidiMappingRowVM::Field::TurnStep, 1e300, out, &reason);
    REQUIRE_TRUE(!hugeOk);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ApplyMappingEditValidEditsStillCommit) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    MidiInstrumentConfig out;
    std::string reason;
    REQUIRE_TRUE(
        vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Channel, 15.0, out, &reason));
    REQUIRE_TRUE(reason.empty());
    REQUIRE_TRUE(out.controllers[0].config.encoderInput->turns[0].control.channel == 15);

    REQUIRE_TRUE(
        vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::Cc, 127.0, out, &reason));
    REQUIRE_TRUE(out.controllers[0].config.encoderInput->turns[0].control.cc == 127);

    REQUIRE_TRUE(
        vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, 0, MidiMappingRowVM::Field::SlotIx, 2.0, out, &reason));
    REQUIRE_TRUE(out.controllers[0].config.encoderInput->turns[0].slotIx == 2);
}

// --- Finding 4: every editableFields entry actually succeeds ---------------

// Applies a "safe" valid value for `field` against `rowIx` in the given
// section/controller and asserts ApplyMappingEdit succeeds -- pins finding 1
// (PressMessage/ReleaseMessage) permanently alongside the older numeric
// fields, for every row of every section on all four default profile kinds.
double SafeValueFor(MidiMappingRowVM::Field field) {
    using Field = MidiMappingRowVM::Field;
    switch (field) {
        case Field::Channel:
            return 1.0;
        case Field::Cc:
            return 10.0;
        case Field::SlotIx:
            return 0.0;
        case Field::Position:
            return 0.0;
        case Field::RelativeMode:
            return 1.0;
        case Field::TurnStep:
            return 0.5;
        case Field::PressMessage:
            return 1.0;  // "Reset press" -- always present, never "None"
        case Field::ReleaseMessage:
            return 2.0;  // "Reset release"
        case Field::LaunchpadX:
            return 0.0;
        case Field::LaunchpadY:
            return 0.0;
        case Field::WrldBldrX:
            return 0.0;
        case Field::WrldBldrY:
            return 0.0;
        case Field::GestureIx:
            return 0.0;
        case Field::SceneBlend:
            return 10.0;
        case Field::Button:
            return 2.0;
    }
    return 0.0;
}

void RequireEveryEditableFieldSucceeds(MidiConfigViewModel& vm, std::size_t controllerIx, MidiConfigSection section) {
    const auto rows = vm.SectionRows(controllerIx, section);
    for (std::size_t rowIx = 0; rowIx < rows.size(); ++rowIx) {
        for (MidiMappingRowVM::Field field : rows[rowIx].editableFields) {
            MidiInstrumentConfig out;
            std::string reason;
            const bool ok =
                vm.ApplyMappingEdit(controllerIx, section, rowIx, field, SafeValueFor(field), out, &reason);
            if (!ok) {
                std::ostringstream oss;
                oss << "controller " << controllerIx << " section " << static_cast<int>(section) << " row " << rowIx
                    << " field " << static_cast<int>(field) << " failed: " << reason;
                throw std::runtime_error(oss.str());
            }
        }
    }
}

TEST_CASE(TwisterSideButtonRowButtonAndMessageFieldsAllSucceed) {
    // MfTwister side-button associations advertise a single Button field
    // (sru-8/D1: logical side button 0..5, persisted as control->cc = 8 +
    // button on the fixed channel 3) plus PressMessage/ReleaseMessage. The
    // zero-arg MfTwisterDefaultProfileConfig() used elsewhere in this file
    // has no side buttons configured, so exercise that branch directly here
    // (this options shape mirrors mf_twister_default_profile_maps_encoders_
    // and_input_only_side_buttons in parameter_modulation_tests.cpp).
    synth::MfTwisterDefaultProfileOptions options;
    options.sideButtons[0] = MidiControllerSystemMessageAssociation{
        .press = synth::MessageIn::SetReset(0, true),
        .release = synth::MessageIn::SetReset(0, false),
    };

    MidiControllerSlot slot;
    slot.name = "twist2";
    slot.kind = MidiProfileKind::MfTwister;
    slot.config = synth::MfTwisterDefaultProfileConfig(options);
    REQUIRE_TRUE(!slot.config.systemMessages.empty());

    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(slot));
    MidiConnectionState connection;
    connection.controllers.push_back(MidiControllerConnection{});

    MidiConfigViewModel vm;
    vm.Rebuild(instrument, connection);
    RequireEveryEditableFieldSucceeds(vm, 0, MidiConfigSection::SystemMessages);
}

TEST_CASE(EveryEditableFieldOnEveryDefaultProfileRowSucceeds) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    for (std::size_t controllerIx = 0; controllerIx < vm.Controllers().size(); ++controllerIx) {
        for (MidiConfigSection section : vm.Controllers()[controllerIx].sections) {
            RequireEveryEditableFieldSucceeds(vm, controllerIx, section);
        }
    }
}

// --- Issue #9: FieldIsInteger / RelativeModeCatalog / FieldShortLabel -----

TEST_CASE(FieldIsIntegerTrueForIndexAndCoordinateFields) {
    using Field = MidiMappingRowVM::Field;
    REQUIRE_TRUE(FieldIsInteger(Field::Channel));
    REQUIRE_TRUE(FieldIsInteger(Field::Cc));
    REQUIRE_TRUE(FieldIsInteger(Field::SlotIx));
    REQUIRE_TRUE(FieldIsInteger(Field::Position));
    REQUIRE_TRUE(FieldIsInteger(Field::GestureIx));
    REQUIRE_TRUE(FieldIsInteger(Field::LaunchpadX));
    REQUIRE_TRUE(FieldIsInteger(Field::LaunchpadY));
    REQUIRE_TRUE(FieldIsInteger(Field::WrldBldrX));
    REQUIRE_TRUE(FieldIsInteger(Field::WrldBldrY));
    REQUIRE_TRUE(FieldIsInteger(Field::SceneBlend));
    REQUIRE_TRUE(FieldIsInteger(Field::Button));
}

TEST_CASE(FieldIsIntegerFalseForTurnStepAndNonNumericEditorFields) {
    using Field = MidiMappingRowVM::Field;
    REQUIRE_TRUE(!FieldIsInteger(Field::TurnStep));
    REQUIRE_TRUE(!FieldIsInteger(Field::RelativeMode));
    REQUIRE_TRUE(!FieldIsInteger(Field::PressMessage));
    REQUIRE_TRUE(!FieldIsInteger(Field::ReleaseMessage));
}

TEST_CASE(RelativeModeCatalogHasOneEntryPerEnumValueInDeclarationOrder) {
    const std::vector<std::string>& catalog = RelativeModeCatalog();
    REQUIRE_TRUE(catalog.size() == 2);
    REQUIRE_TRUE(!catalog[0].empty());
    REQUIRE_TRUE(!catalog[1].empty());
    REQUIRE_TRUE(catalog[0] != catalog[1]);
}

TEST_CASE(RelativeModeIndexRoundTripsThroughApplyMappingEditAndRowFieldValue) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto rows = vm.SectionRows(0, MidiConfigSection::Encoders);
    const std::size_t relativeModeRowIx = rows.size() - 2;

    // Index 1 == DirectionOnly (declaration order: Signed7Bit=0,
    // DirectionOnly=1 -- see EncoderRelativeMode in MidiController.hpp).
    MidiInstrumentConfig out;
    std::string reason;
    REQUIRE_TRUE(vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, relativeModeRowIx,
                                     MidiMappingRowVM::Field::RelativeMode, 1.0, out, &reason));
    REQUIRE_TRUE(out.controllers[0].config.encoderInput->relativeMode == EncoderRelativeMode::DirectionOnly);

    MidiConfigViewModel vmAfter;
    vmAfter.Rebuild(out, MakeFourKindConnection());
    double value = -1.0;
    REQUIRE_TRUE(vmAfter.RowFieldValue(0, MidiConfigSection::Encoders, relativeModeRowIx,
                                       MidiMappingRowVM::Field::RelativeMode, value));
    REQUIRE_TRUE(value == 1.0);

    // Index 0 == Signed7Bit, round-tripping back the other way.
    MidiInstrumentConfig out2;
    REQUIRE_TRUE(vmAfter.ApplyMappingEdit(0, MidiConfigSection::Encoders, relativeModeRowIx,
                                          MidiMappingRowVM::Field::RelativeMode, 0.0, out2, &reason));
    REQUIRE_TRUE(out2.controllers[0].config.encoderInput->relativeMode == EncoderRelativeMode::Signed7Bit);
}

TEST_CASE(RelativeModeIndexOutOfRangeIsRefused) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const auto rows = vm.SectionRows(0, MidiConfigSection::Encoders);
    const std::size_t relativeModeRowIx = rows.size() - 2;

    MidiInstrumentConfig out;
    std::string reason;
    const bool ok = vm.ApplyMappingEdit(0, MidiConfigSection::Encoders, relativeModeRowIx,
                                        MidiMappingRowVM::Field::RelativeMode, 2.0, out, &reason);
    REQUIRE_TRUE(!ok);
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(FieldShortLabelIsNonEmptyAndDistinctPerField) {
    using Field = MidiMappingRowVM::Field;
    const std::vector<Field> fields = {
        Field::Channel,     Field::Cc,     Field::SlotIx,      Field::Position,       Field::GestureIx,
        Field::LaunchpadX,  Field::LaunchpadY, Field::WrldBldrX, Field::WrldBldrY,     Field::TurnStep,
        Field::RelativeMode, Field::PressMessage, Field::ReleaseMessage, Field::SceneBlend, Field::Button,
    };
    std::vector<std::string> seen;
    for (Field field : fields) {
        const char* label = FieldShortLabel(field);
        REQUIRE_TRUE(label != nullptr);
        REQUIRE_TRUE(*label != '\0');
        seen.push_back(label);
    }
    // Not asserting global uniqueness (X/Y are legitimately reused between
    // Launchpad and WRLD.Bldr coordinate fields), just that the helper
    // returns a real label for every field the renderer might ask about.
}

// --- Issue #9/#11: RowGroup assignment --------------------------------

TEST_CASE(EncoderRowsAreGroupedTurnPushModeStep) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());

    const std::vector<MidiMappingRowVM> rows = vm.SectionRows(0, MidiConfigSection::Encoders);
    // 16 turns, 16 pushes, 1 mode row, 1 step row (see
    // WrldBldrEncoderSectionListsSixteenTurnsAndPushes for the row-count
    // derivation).
    REQUIRE_TRUE(rows.size() == 34);
    for (std::size_t ix = 0; ix < 16; ++ix) {
        REQUIRE_TRUE(rows[ix].group == MidiMappingRowVM::RowGroup::EncoderTurn);
    }
    for (std::size_t ix = 16; ix < 32; ++ix) {
        REQUIRE_TRUE(rows[ix].group == MidiMappingRowVM::RowGroup::EncoderPush);
    }
    REQUIRE_TRUE(rows[32].group == MidiMappingRowVM::RowGroup::EncoderMode);
    REQUIRE_TRUE(rows[33].group == MidiMappingRowVM::RowGroup::EncoderStep);
}

TEST_CASE(AnalogRowsAreGroupedGestureThenSceneBlend) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());

    const std::vector<MidiMappingRowVM> rows = vm.SectionRows(0, MidiConfigSection::Analogs);
    REQUIRE_TRUE(rows.size() >= 2);
    for (std::size_t ix = 0; ix + 1 < rows.size(); ++ix) {
        REQUIRE_TRUE(rows[ix].group == MidiMappingRowVM::RowGroup::AnalogGesture);
    }
    REQUIRE_TRUE(rows.back().group == MidiMappingRowVM::RowGroup::AnalogSceneBlend);
}

TEST_CASE(SystemMessageRowsAreGroupedSystem) {
    MidiConfigViewModel vm;
    vm.Rebuild(MakeFourKindInstrument(), MakeFourKindConnection());

    const std::vector<MidiMappingRowVM> rows = vm.SectionRows(0, MidiConfigSection::SystemMessages);
    REQUIRE_TRUE(!rows.empty());
    for (const auto& row : rows) {
        REQUIRE_TRUE(row.group == MidiMappingRowVM::RowGroup::System);
    }
}

// --- Issue #11: scene blend label reads clearly ----------------------------

TEST_CASE(SceneBlendLabelReadsClearlyWhenAssignedAndUnassigned) {
    MidiConfigViewModel vm;
    MidiInstrumentConfig instrument = MakeFourKindInstrument();
    vm.Rebuild(instrument, MakeFourKindConnection());

    const std::vector<MidiMappingRowVM> rows = vm.SectionRows(0, MidiConfigSection::Analogs);
    REQUIRE_TRUE(rows.back().group == MidiMappingRowVM::RowGroup::AnalogSceneBlend);
    REQUIRE_TRUE(rows.back().label.find("Scene blend") != std::string::npos ||
                rows.back().label.find("scene blend") != std::string::npos);

    // Force an unassigned sceneBlend and confirm the label still reads
    // clearly (not just a bare "(unassigned)" with no context).
    MidiControllerSlot slot = instrument.controllers[0];
    slot.config.analogInput->sceneBlend = std::nullopt;
    MidiInstrumentConfig unassignedInstrument;
    unassignedInstrument.controllers.push_back(slot);
    for (std::size_t ix = 1; ix < instrument.controllers.size(); ++ix) {
        unassignedInstrument.controllers.push_back(instrument.controllers[ix]);
    }
    MidiConfigViewModel vmUnassigned;
    vmUnassigned.Rebuild(unassignedInstrument, MakeFourKindConnection());
    const std::vector<MidiMappingRowVM> unassignedRows = vmUnassigned.SectionRows(0, MidiConfigSection::Analogs);
    REQUIRE_TRUE(unassignedRows.back().label.find("unassigned") != std::string::npos);
}

int Main() {
    int failed = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& ex) {
            ++failed;
            std::cerr << "[FAIL] " << test.name << ": " << ex.what() << "\n";
        }
    }
    return failed == 0 ? 0 : 1;
}

} // namespace

int main() {
    return Main();
}
