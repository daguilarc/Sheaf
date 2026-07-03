#include "synth/MidiController.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth module tests must not see JUCE headers"
#endif

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

using synth::MidiControllerProfileConfig;
using synth::MidiControllerSlot;
using synth::MidiControllerSystemMessageAssociation;
using synth::MidiControlAddress;
using synth::MidiEndpointRef;
using synth::MidiInstrumentConfig;
using synth::MidiKindSupport;
using synth::MidiProfileKind;
using synth::WrldBldrSystemPosition;

MidiControllerSystemMessageAssociation MakeControlOnlyAssociation() {
    MidiControllerSystemMessageAssociation association;
    association.control = MidiControlAddress{.channel = 3, .cc = 8};
    association.press = synth::MessageIn::SetReset(0, true);
    association.feedback = association.press;
    return association;
}

MidiControllerSystemMessageAssociation MakeWrldBldrAssociation() {
    MidiControllerSystemMessageAssociation association;
    association.control = MidiControlAddress{.channel = 5, .cc = 0};
    association.wrldBldrPosition = WrldBldrSystemPosition{.channel = 5, .x = 0, .y = 0};
    association.press = synth::MessageIn::SetReset(0, true);
    association.feedback = association.press;
    return association;
}

MidiControllerSystemMessageAssociation MakeLaunchpadAssociation() {
    MidiControllerSystemMessageAssociation association;
    association.launchpadPosition = synth::LaunchpadGridPosition{
        .controller = synth::LaunchpadController::LaunchpadX, .x = 0, .y = 0};
    association.press = synth::MessageIn::SetReset(0, true);
    association.feedback = association.press;
    return association;
}

MidiControllerSystemMessageAssociation MakeNoAddressAssociation() {
    MidiControllerSystemMessageAssociation association;
    association.press = synth::MessageIn::SetReset(0, true);
    association.feedback = association.press;
    return association;
}

MidiControllerSystemMessageAssociation MakeWrldBldrPositionOnlyAssociation() {
    MidiControllerSystemMessageAssociation association;
    association.wrldBldrPosition = WrldBldrSystemPosition{.channel = 5, .x = 0, .y = 0};
    association.press = synth::MessageIn::SetReset(0, true);
    association.feedback = association.press;
    return association;
}

MidiControllerSlot MakeGenericSlot(const char* name) {
    MidiControllerSlot slot;
    slot.name = name;
    slot.kind = MidiProfileKind::Generic;
    return slot;
}

TEST_CASE(KindNameRoundTrip) {
    REQUIRE_TRUE(std::string(synth::MidiProfileKindName(MidiProfileKind::WrldBldr)) == "wrldbldr");
    REQUIRE_TRUE(std::string(synth::MidiProfileKindName(MidiProfileKind::MfTwister)) == "twister");
    REQUIRE_TRUE(std::string(synth::MidiProfileKindName(MidiProfileKind::Launchpad)) == "launchpad");
    REQUIRE_TRUE(std::string(synth::MidiProfileKindName(MidiProfileKind::Generic)) == "generic");

    MidiProfileKind kind{};
    REQUIRE_TRUE(synth::MidiProfileKindFromName("wrldbldr", kind));
    REQUIRE_TRUE(kind == MidiProfileKind::WrldBldr);
    REQUIRE_TRUE(synth::MidiProfileKindFromName("twister", kind));
    REQUIRE_TRUE(kind == MidiProfileKind::MfTwister);
    REQUIRE_TRUE(synth::MidiProfileKindFromName("launchpad", kind));
    REQUIRE_TRUE(kind == MidiProfileKind::Launchpad);
    REQUIRE_TRUE(synth::MidiProfileKindFromName("generic", kind));
    REQUIRE_TRUE(kind == MidiProfileKind::Generic);
}

TEST_CASE(KindNameFromUnknownRejected) {
    MidiProfileKind kind = MidiProfileKind::Generic;
    REQUIRE_TRUE(!synth::MidiProfileKindFromName("bogus", kind));
    REQUIRE_TRUE(!synth::MidiProfileKindFromName("", kind));
    REQUIRE_TRUE(!synth::MidiProfileKindFromName("WrldBldr", kind));
}

TEST_CASE(KindSupportMatrix) {
    const MidiKindSupport wrldbldr = synth::KindSupport(MidiProfileKind::WrldBldr);
    REQUIRE_TRUE(wrldbldr.encoders);
    REQUIRE_TRUE(wrldbldr.systemMessages);
    REQUIRE_TRUE(wrldbldr.analogs);

    const MidiKindSupport twister = synth::KindSupport(MidiProfileKind::MfTwister);
    REQUIRE_TRUE(twister.encoders);
    REQUIRE_TRUE(twister.systemMessages);
    REQUIRE_TRUE(!twister.analogs);

    const MidiKindSupport launchpad = synth::KindSupport(MidiProfileKind::Launchpad);
    REQUIRE_TRUE(!launchpad.encoders);
    REQUIRE_TRUE(launchpad.systemMessages);
    REQUIRE_TRUE(!launchpad.analogs);

    const MidiKindSupport generic = synth::KindSupport(MidiProfileKind::Generic);
    REQUIRE_TRUE(generic.encoders);
    REQUIRE_TRUE(generic.systemMessages);
    REQUIRE_TRUE(generic.analogs);
}

TEST_CASE(SlotValidForKindRejectsLaunchpadWithEncoders) {
    MidiControllerSlot slot = MakeGenericSlot("pad");
    slot.kind = MidiProfileKind::Launchpad;
    slot.config.encoderInput = synth::EncoderMidiInConfig{};
    slot.config.systemMessages.push_back(MakeLaunchpadAssociation());

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindRejectsLaunchpadWithWrldBldrPosition) {
    MidiControllerSlot slot = MakeGenericSlot("pad");
    slot.kind = MidiProfileKind::Launchpad;
    slot.config.systemMessages.push_back(MakeWrldBldrAssociation());

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindRejectsLaunchpadControlOnlyAssociation) {
    MidiControllerSlot slot = MakeGenericSlot("pad");
    slot.kind = MidiProfileKind::Launchpad;
    slot.config.systemMessages.push_back(MakeControlOnlyAssociation());

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindRejectsTwisterWithLaunchpadPosition) {
    MidiControllerSlot slot = MakeGenericSlot("twist");
    slot.kind = MidiProfileKind::MfTwister;
    slot.config.systemMessages.push_back(MakeLaunchpadAssociation());

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindRejectsGenericWithLaunchpadPosition) {
    MidiControllerSlot slot = MakeGenericSlot("gen");
    slot.kind = MidiProfileKind::Generic;
    slot.config.systemMessages.push_back(MakeLaunchpadAssociation());

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindRejectsTwisterWithNoAddress) {
    MidiControllerSlot slot = MakeGenericSlot("twist");
    slot.kind = MidiProfileKind::MfTwister;
    slot.config.systemMessages.push_back(MakeNoAddressAssociation());

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindRejectsWrldBldrWithWrldBldrPositionOnly) {
    MidiControllerSlot slot = MakeGenericSlot("wrld");
    slot.kind = MidiProfileKind::WrldBldr;
    slot.config.systemMessages.push_back(MakeWrldBldrPositionOnlyAssociation());

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindAcceptsWrldBldrWithWrldBldrPosition) {
    MidiControllerSlot slot = MakeGenericSlot("wrld");
    slot.kind = MidiProfileKind::WrldBldr;
    slot.config.systemMessages.push_back(MakeWrldBldrAssociation());

    std::string reason;
    REQUIRE_TRUE(synth::SlotValidForKind(slot, &reason));
}

TEST_CASE(SlotValidForKindAcceptsTwisterSideButtonCcAssociation) {
    MidiControllerSlot slot = MakeGenericSlot("twist");
    slot.kind = MidiProfileKind::MfTwister;
    slot.config.systemMessages.push_back(MakeControlOnlyAssociation());

    std::string reason;
    REQUIRE_TRUE(synth::SlotValidForKind(slot, &reason));
}

TEST_CASE(SlotValidForKindAcceptsWrldBldrDefaultProfile) {
    MidiControllerSlot slot = MakeGenericSlot("wrld");
    slot.kind = MidiProfileKind::WrldBldr;
    slot.config = synth::WrldBldrDefaultProfileConfig();

    std::string reason;
    REQUIRE_TRUE(synth::SlotValidForKind(slot, &reason));
}

TEST_CASE(SlotValidForKindAcceptsMfTwisterDefaultProfile) {
    MidiControllerSlot slot = MakeGenericSlot("twist");
    slot.kind = MidiProfileKind::MfTwister;
    slot.config = synth::MfTwisterDefaultProfileConfig();

    std::string reason;
    REQUIRE_TRUE(synth::SlotValidForKind(slot, &reason));
}

TEST_CASE(SlotValidForKindAcceptsLaunchpadDefaultProfile) {
    MidiControllerSlot slot = MakeGenericSlot("pad");
    slot.kind = MidiProfileKind::Launchpad;
    slot.config = synth::LaunchpadDefaultProfileConfig();

    std::string reason;
    REQUIRE_TRUE(synth::SlotValidForKind(slot, &reason));
}

TEST_CASE(AddControllerRejectsDuplicateName) {
    MidiInstrumentConfig instrument;
    MidiControllerSlot first = MakeGenericSlot("dup");
    MidiControllerSlot second = MakeGenericSlot("dup");

    REQUIRE_TRUE(instrument.AddController(first));
    REQUIRE_TRUE(!instrument.AddController(second));
    REQUIRE_TRUE(instrument.controllers.size() == 1);
    REQUIRE_TRUE(instrument.controllers[0].name == "dup");
    REQUIRE_TRUE(instrument.controllers[0].kind == MidiProfileKind::Generic);
}

TEST_CASE(AddControllerRejectsInvalidSlot) {
    MidiInstrumentConfig instrument;
    MidiControllerSlot invalid = MakeGenericSlot("bad");
    invalid.kind = MidiProfileKind::Launchpad;
    invalid.config.systemMessages.push_back(MakeControlOnlyAssociation());

    REQUIRE_TRUE(!instrument.AddController(invalid));
    REQUIRE_TRUE(instrument.controllers.empty());
}

TEST_CASE(OrderedIterationPreservedAfterAddRemove) {
    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("a")));
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("b")));
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("c")));

    REQUIRE_TRUE(instrument.controllers.size() == 3);
    REQUIRE_TRUE(instrument.controllers[0].name == "a");
    REQUIRE_TRUE(instrument.controllers[1].name == "b");
    REQUIRE_TRUE(instrument.controllers[2].name == "c");

    instrument.RemoveController(1);
    REQUIRE_TRUE(instrument.controllers.size() == 2);
    REQUIRE_TRUE(instrument.controllers[0].name == "a");
    REQUIRE_TRUE(instrument.controllers[1].name == "c");

    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("d")));
    REQUIRE_TRUE(instrument.controllers.size() == 3);
    REQUIRE_TRUE(instrument.controllers[2].name == "d");

    REQUIRE_TRUE(instrument.FindController("a") != nullptr);
    REQUIRE_TRUE(instrument.FindController("c") != nullptr);
    REQUIRE_TRUE(instrument.FindController("d") != nullptr);
    REQUIRE_TRUE(instrument.FindController("b") == nullptr);
}

TEST_CASE(RenameControllerRejectsDuplicate) {
    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("a")));
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("b")));

    REQUIRE_TRUE(!instrument.RenameController(0, "b"));
    REQUIRE_TRUE(instrument.controllers[0].name == "a");

    REQUIRE_TRUE(instrument.RenameController(0, "c"));
    REQUIRE_TRUE(instrument.controllers[0].name == "c");
}

TEST_CASE(RenameControllerRejectsBadIndex) {
    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("a")));

    REQUIRE_TRUE(!instrument.RenameController(5, "z"));
}

TEST_CASE(ReplaceControllerRejectsDuplicateAndInvalid) {
    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("a")));
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("b")));

    MidiControllerSlot dupName = MakeGenericSlot("b");
    REQUIRE_TRUE(!instrument.ReplaceController(0, dupName));
    REQUIRE_TRUE(instrument.controllers[0].name == "a");

    MidiControllerSlot invalid = MakeGenericSlot("a");
    invalid.kind = MidiProfileKind::Launchpad;
    invalid.config.systemMessages.push_back(MakeControlOnlyAssociation());
    REQUIRE_TRUE(!instrument.ReplaceController(0, invalid));
    REQUIRE_TRUE(instrument.controllers[0].name == "a");
    REQUIRE_TRUE(instrument.controllers[0].kind == MidiProfileKind::Generic);

    MidiControllerSlot renamed = MakeGenericSlot("a-renamed");
    REQUIRE_TRUE(instrument.ReplaceController(0, renamed));
    REQUIRE_TRUE(instrument.controllers[0].name == "a-renamed");
}

TEST_CASE(MidiEndpointRefIsConfigured) {
    MidiEndpointRef empty;
    REQUIRE_TRUE(!empty.IsConfigured());

    MidiEndpointRef withIdentifier;
    withIdentifier.identifier = "abc";
    REQUIRE_TRUE(withIdentifier.IsConfigured());

    MidiEndpointRef withName;
    withName.name = "My Device";
    REQUIRE_TRUE(withName.IsConfigured());
}

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
    slot.output.identifier = "twister-out-id";
    slot.output.name = "MF Twister Out";
    return slot;
}

MidiControllerSlot MakeLaunchpadSlot(const char* name) {
    MidiControllerSlot slot;
    slot.name = name;
    slot.kind = MidiProfileKind::Launchpad;
    slot.config = synth::LaunchpadDefaultProfileConfig();
    // Endpoint refs intentionally left unconfigured (empty identifier + name)
    // to cover the "unconfigured endpoint round-trips" case.
    return slot;
}

TEST_CASE(InstrumentJsonRoundTripsControllersInOrder) {
    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(MakeWrldBldrSlot("wrld")));
    REQUIRE_TRUE(instrument.AddController(MakeTwisterSlot("twist")));
    REQUIRE_TRUE(instrument.AddController(MakeLaunchpadSlot("left pad")));
    REQUIRE_TRUE(instrument.AddController(MakeLaunchpadSlot("right pad")));

    synth::JsonArena arena(1024 * 1024);
    const synth::JSON json = synth::ToJSON(arena, instrument);
    REQUIRE_TRUE(!json.IsNull());

    MidiInstrumentConfig loaded;
    REQUIRE_TRUE(synth::FromJSON(json, loaded));

    REQUIRE_TRUE(loaded.controllers.size() == 4);
    REQUIRE_TRUE(loaded.controllers[0].name == "wrld");
    REQUIRE_TRUE(loaded.controllers[0].kind == MidiProfileKind::WrldBldr);
    REQUIRE_TRUE(loaded.controllers[0].input.identifier == "wrldbldr-in-id");
    REQUIRE_TRUE(loaded.controllers[0].input.name == "WRLD.Bldr In");
    REQUIRE_TRUE(loaded.controllers[0].output.identifier == "wrldbldr-out-id");
    REQUIRE_TRUE(loaded.controllers[0].output.name == "WRLD.Bldr Out");
    REQUIRE_TRUE(loaded.controllers[0].config.encoderInput.has_value());
    REQUIRE_TRUE(loaded.controllers[0].config.encoderInput->turns.size() ==
                 instrument.controllers[0].config.encoderInput->turns.size());

    REQUIRE_TRUE(loaded.controllers[1].name == "twist");
    REQUIRE_TRUE(loaded.controllers[1].kind == MidiProfileKind::MfTwister);
    REQUIRE_TRUE(loaded.controllers[1].input.identifier == "twister-in-id");
    REQUIRE_TRUE(loaded.controllers[1].output.name == "MF Twister Out");

    REQUIRE_TRUE(loaded.controllers[2].name == "left pad");
    REQUIRE_TRUE(loaded.controllers[2].kind == MidiProfileKind::Launchpad);
    // Unconfigured endpoint refs (empty identifier + name) round-trip as unconfigured.
    REQUIRE_TRUE(!loaded.controllers[2].input.IsConfigured());
    REQUIRE_TRUE(!loaded.controllers[2].output.IsConfigured());

    REQUIRE_TRUE(loaded.controllers[3].name == "right pad");
    REQUIRE_TRUE(loaded.controllers[3].kind == MidiProfileKind::Launchpad);
}

TEST_CASE(InstrumentJsonEmptyControllersRoundTrips) {
    MidiInstrumentConfig instrument;

    synth::JsonArena arena(1024 * 1024);
    const synth::JSON json = synth::ToJSON(arena, instrument);
    REQUIRE_TRUE(!json.IsNull());

    MidiInstrumentConfig loaded;
    REQUIRE_TRUE(synth::FromJSON(json, loaded));
    REQUIRE_TRUE(loaded.controllers.empty());
}

TEST_CASE(InstrumentJsonRejectsUnknownKind) {
    synth::JsonArena arena(1024 * 1024);
    synth::JSON controller = arena.Object();
    controller.SetNew("name", arena.String("pad"));
    controller.SetNew("kind", arena.String("theremin"));
    controller.SetNew("input", synth::ToJSON(arena, MidiEndpointRef{}));
    controller.SetNew("output", synth::ToJSON(arena, MidiEndpointRef{}));
    controller.SetNew("profile", synth::ToJSON(arena, MidiControllerProfileConfig{}));

    synth::JSON controllers = arena.Array();
    controllers.AppendNew(controller);

    synth::JSON json = arena.Object();
    json.SetNew("schema", arena.String(synth::kMidiInstrumentSchema));
    json.SetNew("schemaVersion", arena.Integer(synth::kMidiInstrumentSchemaVersion));
    json.SetNew("controllers", controllers);

    MidiInstrumentConfig target;
    REQUIRE_TRUE(target.AddController(MakeGenericSlot("existing")));
    REQUIRE_TRUE(!synth::FromJSON(json, target));
    REQUIRE_TRUE(target.controllers.size() == 1);
    REQUIRE_TRUE(target.controllers[0].name == "existing");
}

TEST_CASE(InstrumentJsonRejectsDuplicateNames) {
    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("pad")));

    synth::JsonArena arena(1024 * 1024);
    synth::JSON controller = synth::ToJSON(arena, instrument.controllers[0]);
    synth::JSON duplicate = synth::ToJSON(arena, instrument.controllers[0]);

    synth::JSON controllers = arena.Array();
    controllers.AppendNew(controller);
    controllers.AppendNew(duplicate);

    synth::JSON json = arena.Object();
    json.SetNew("schema", arena.String(synth::kMidiInstrumentSchema));
    json.SetNew("schemaVersion", arena.Integer(synth::kMidiInstrumentSchemaVersion));
    json.SetNew("controllers", controllers);

    MidiInstrumentConfig target;
    REQUIRE_TRUE(target.AddController(MakeGenericSlot("existing")));
    REQUIRE_TRUE(!synth::FromJSON(json, target));
    REQUIRE_TRUE(target.controllers.size() == 1);
    REQUIRE_TRUE(target.controllers[0].name == "existing");
}

// Builds a "profile" JSON object directly (bypassing MidiControllerProfileConfig's
// ToJSON) so tests can construct shapes that SlotValidForKind must reject on load
// — the in-memory types can't represent these illegal combinations directly.
// NOTE: JSON::Get returns the first match for a repeated key, so each field must be
// set exactly once here.
synth::JSON MakeProfileJson(synth::JsonArena& arena, synth::JSON encoderInput, synth::JSON systemMessages) {
    synth::JSON profile = arena.Object();
    profile.SetNew("schema", arena.String("synth.midiControllerProfileConfig"));
    profile.SetNew("schemaVersion", arena.Integer(1));
    profile.SetNew("encoderInput", encoderInput);
    profile.SetNew("encoderOutput", arena.Null());
    profile.SetNew("analogInput", arena.Null());
    profile.SetNew("systemMessages", systemMessages);
    return profile;
}

synth::JSON MakeProfileJsonWithSystemMessages(synth::JsonArena& arena, synth::JSON systemMessages) {
    return MakeProfileJson(arena, arena.Null(), systemMessages);
}

synth::JSON MakeInstrumentControllerJson(synth::JsonArena& arena, const char* name, const char* kind,
                                         synth::JSON profile) {
    synth::JSON controller = arena.Object();
    controller.SetNew("name", arena.String(name));
    controller.SetNew("kind", arena.String(kind));
    controller.SetNew("input", synth::ToJSON(arena, MidiEndpointRef{}));
    controller.SetNew("output", synth::ToJSON(arena, MidiEndpointRef{}));
    controller.SetNew("profile", profile);
    return controller;
}

synth::JSON MakeInstrumentJson(synth::JsonArena& arena, synth::JSON controllers) {
    synth::JSON json = arena.Object();
    json.SetNew("schema", arena.String(synth::kMidiInstrumentSchema));
    json.SetNew("schemaVersion", arena.Integer(synth::kMidiInstrumentSchemaVersion));
    json.SetNew("controllers", controllers);
    return json;
}

TEST_CASE(InstrumentJsonRejectsLaunchpadWithEncoderMappings) {
    synth::JsonArena arena(1024 * 1024);
    // Launchpad profile with an illegal encoderInput — launchpad supports no encoders.
    synth::JSON profile =
        MakeProfileJson(arena, synth::ToJSON(arena, synth::EncoderMidiInConfig{}), arena.Array());
    synth::JSON controller = MakeInstrumentControllerJson(arena, "pad", "launchpad", profile);

    synth::JSON controllers = arena.Array();
    controllers.AppendNew(controller);
    synth::JSON json = MakeInstrumentJson(arena, controllers);

    MidiInstrumentConfig target;
    REQUIRE_TRUE(target.AddController(MakeGenericSlot("existing")));
    REQUIRE_TRUE(!synth::FromJSON(json, target));
    REQUIRE_TRUE(target.controllers.size() == 1);
    REQUIRE_TRUE(target.controllers[0].name == "existing");
}

TEST_CASE(InstrumentJsonRejectsLaunchpadWithWrldBldrPosition) {
    synth::JsonArena arena(1024 * 1024);
    // A system-message entry that illegally carries both a launchpad position and a
    // WRLD.Bldr position; launchpad kind must reject the WRLD.Bldr position.
    synth::JSON association = arena.Object();
    association.SetNew("control", arena.Null());
    association.SetNew("wrldBldrPosition",
                        synth::ToJSON(arena, WrldBldrSystemPosition{.channel = 5, .x = 0, .y = 0}));
    association.SetNew("launchpadPosition",
                        synth::ToJSON(arena, synth::LaunchpadGridPosition{
                                                  .controller = synth::LaunchpadController::LaunchpadX,
                                                  .x = 0,
                                                  .y = 0}));
    association.SetNew("press", synth::ToJSON(arena, synth::MessageIn::SetReset(0, true)));
    association.SetNew("release", arena.Null());
    association.SetNew("feedback", synth::ToJSON(arena, synth::MessageIn::SetReset(0, true)));
    association.SetNew("outputFeedback", arena.Boolean(true));

    synth::JSON systemMessages = arena.Array();
    systemMessages.AppendNew(association);
    synth::JSON profile = MakeProfileJsonWithSystemMessages(arena, systemMessages);
    synth::JSON controller = MakeInstrumentControllerJson(arena, "pad", "launchpad", profile);

    synth::JSON controllers = arena.Array();
    controllers.AppendNew(controller);
    synth::JSON json = MakeInstrumentJson(arena, controllers);

    MidiInstrumentConfig target;
    REQUIRE_TRUE(target.AddController(MakeGenericSlot("existing")));
    REQUIRE_TRUE(!synth::FromJSON(json, target));
    REQUIRE_TRUE(target.controllers.size() == 1);
    REQUIRE_TRUE(target.controllers[0].name == "existing");
}

TEST_CASE(InstrumentJsonRejectsBadSchema) {
    synth::JsonArena arena(1024 * 1024);
    synth::JSON json = arena.Object();
    json.SetNew("schema", arena.String("not.the.right.schema"));
    json.SetNew("schemaVersion", arena.Integer(synth::kMidiInstrumentSchemaVersion));
    json.SetNew("controllers", arena.Array());

    MidiInstrumentConfig target;
    REQUIRE_TRUE(target.AddController(MakeGenericSlot("existing")));
    REQUIRE_TRUE(!synth::FromJSON(json, target));
    REQUIRE_TRUE(target.controllers.size() == 1);
    REQUIRE_TRUE(target.controllers[0].name == "existing");
}

TEST_CASE(InstrumentJsonUnconfiguredEndpointRoundTrips) {
    MidiInstrumentConfig instrument;
    REQUIRE_TRUE(instrument.AddController(MakeGenericSlot("gen")));
    REQUIRE_TRUE(!instrument.controllers[0].input.IsConfigured());
    REQUIRE_TRUE(!instrument.controllers[0].output.IsConfigured());

    synth::JsonArena arena(1024 * 1024);
    const synth::JSON json = synth::ToJSON(arena, instrument);

    MidiInstrumentConfig loaded;
    REQUIRE_TRUE(synth::FromJSON(json, loaded));
    REQUIRE_TRUE(!loaded.controllers[0].input.IsConfigured());
    REQUIRE_TRUE(!loaded.controllers[0].output.IsConfigured());
    REQUIRE_TRUE(loaded.controllers[0].input.identifier.empty());
    REQUIRE_TRUE(loaded.controllers[0].input.name.empty());
}

} // namespace

int main() {
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
