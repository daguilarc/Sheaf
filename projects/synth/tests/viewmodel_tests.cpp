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
using synth::MidiEndpointConnection;
using synth::MidiEndpointRef;
using synth::MidiEndpointStatus;
using synth::MidiInstrumentConfig;
using synth::MidiMappingRowVM;
using synth::MidiProfileKind;
using synth::RollingMax256;

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
