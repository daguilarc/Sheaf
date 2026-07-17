#include "synth/MidiController.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth module tests must not see JUCE headers"
#endif

#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <type_traits>
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

TEST_CASE(MessageInJsonRoundTripsHighGestureIndex) {
    synth::JsonArena arena(4096);
    const synth::MessageIn source = synth::MessageIn::SetGestureSelect(17, 63, true);
    const synth::JSON json = synth::ToJSON(arena, source);
    synth::MessageIn target;
    REQUIRE_TRUE(synth::FromJSON(json, target));
    REQUIRE_TRUE(target.type == synth::MessageIn::Type::SetGestureSelect);
    REQUIRE_TRUE(target.gestureIx == 63);
    REQUIRE_TRUE(target.boolValue);
    REQUIRE_TRUE(target.hasBoolValue);
}

TEST_CASE(GridMessageInFactoriesCarryFlatSemanticFields) {
    const synth::MessageIn press = synth::MessageIn::GridPress(11, 1, -1, 7, 100);
    REQUIRE_TRUE(press.timestamp == 11);
    REQUIRE_TRUE(press.type == synth::MessageIn::Type::GridPress);
    REQUIRE_TRUE(press.gridSlotIx == 1);
    REQUIRE_TRUE(press.gridX == -1);
    REQUIRE_TRUE(press.gridY == 7);
    REQUIRE_TRUE(press.velocity == 100);

    const synth::MessageIn release = synth::MessageIn::GridRelease(12, 1, -1, 7);
    REQUIRE_TRUE(release.timestamp == 12);
    REQUIRE_TRUE(release.type == synth::MessageIn::Type::GridRelease);
    REQUIRE_TRUE(release.gridSlotIx == 1);
    REQUIRE_TRUE(release.gridX == -1);
    REQUIRE_TRUE(release.gridY == 7);

    const synth::MessageIn pressure = synth::MessageIn::GridPressureChange(13, 1, -1, 7, 64);
    REQUIRE_TRUE(pressure.timestamp == 13);
    REQUIRE_TRUE(pressure.type == synth::MessageIn::Type::GridPressureChange);
    REQUIRE_TRUE(pressure.gridSlotIx == 1);
    REQUIRE_TRUE(pressure.gridX == -1);
    REQUIRE_TRUE(pressure.gridY == 7);
    REQUIRE_TRUE(pressure.velocity == 64);

    const synth::MessageIn select = synth::MessageIn::SelectGrid(14, 2, 5);
    REQUIRE_TRUE(select.timestamp == 14);
    REQUIRE_TRUE(select.type == synth::MessageIn::Type::SelectGrid);
    REQUIRE_TRUE(select.gridSlotIx == 2);
    REQUIRE_TRUE(select.gridIx == 5);
}

TEST_CASE(GridMessageInJsonUsesFlatPerVariantShapeAndRoundTrips) {
    synth::JsonArena arena(4096);
    const synth::MessageIn messages[] = {
        synth::MessageIn::GridPress(11, 1, -1, 7, 100),
        synth::MessageIn::GridRelease(12, 1, -1, 7),
        synth::MessageIn::GridPressureChange(13, 1, -1, 7, 64),
        synth::MessageIn::SelectGrid(14, 2, 5),
    };

    for (const synth::MessageIn& source : messages) {
        const synth::JSON json = synth::ToJSON(arena, source);
        REQUIRE_TRUE(json.Get("gridSlot").IntegerValue() == static_cast<std::int64_t>(source.gridSlotIx));
        REQUIRE_TRUE(json.Get("slotIx").IsNull());

        synth::MessageIn target;
        REQUIRE_TRUE(synth::FromJSON(json, target));
        REQUIRE_TRUE(target.type == source.type);
        REQUIRE_TRUE(target.gridSlotIx == source.gridSlotIx);
        if (source.type == synth::MessageIn::Type::SelectGrid) {
            REQUIRE_TRUE(json.Get("type").StringValue() == std::string_view("selectGrid"));
            REQUIRE_TRUE(json.Get("grid").IntegerValue() == 5);
            REQUIRE_TRUE(json.Get("x").IsNull());
            REQUIRE_TRUE(json.Get("y").IsNull());
            REQUIRE_TRUE(json.Get("velocity").IsNull());
            REQUIRE_TRUE(target.gridIx == source.gridIx);
        } else {
            REQUIRE_TRUE(json.Get("grid").IsNull());
            REQUIRE_TRUE(json.Get("x").IntegerValue() == -1);
            REQUIRE_TRUE(json.Get("y").IntegerValue() == 7);
            REQUIRE_TRUE(target.gridX == source.gridX);
            REQUIRE_TRUE(target.gridY == source.gridY);
            if (source.type == synth::MessageIn::Type::GridRelease) {
                REQUIRE_TRUE(json.Get("type").StringValue() == std::string_view("gridRelease"));
                REQUIRE_TRUE(json.Get("velocity").IsNull());
            } else {
                const std::string_view expectedType = source.type == synth::MessageIn::Type::GridPress
                                                          ? "gridPress"
                                                          : "gridPressureChange";
                REQUIRE_TRUE(json.Get("type").StringValue() == expectedType);
                REQUIRE_TRUE(json.Get("velocity").IntegerValue() == source.velocity);
                REQUIRE_TRUE(target.velocity == source.velocity);
            }
        }
    }
}

TEST_CASE(GridMessageInJsonRejectsVelocityOutsideByteRangeWithoutMutation) {
    auto makeMessage = [](synth::JsonArena& arena, std::int64_t velocity) {
        synth::JSON json = arena.Object();
        json.SetNew("type", arena.String("gridPress"));
        json.SetNew("gridSlot", arena.Integer(1));
        json.SetNew("x", arena.Integer(-1));
        json.SetNew("y", arena.Integer(7));
        json.SetNew("velocity", arena.Integer(velocity));
        return json;
    };

    synth::MessageIn target = synth::MessageIn::SceneSelect(99, 3);
    synth::JsonArena negativeArena(1024);
    REQUIRE_TRUE(!synth::FromJSON(makeMessage(negativeArena, -1), target));
    REQUIRE_TRUE(target.type == synth::MessageIn::Type::SceneSelect);
    REQUIRE_TRUE(target.sceneIx == 3);

    synth::JsonArena overflowArena(1024);
    REQUIRE_TRUE(!synth::FromJSON(makeMessage(overflowArena, 256), target));
    REQUIRE_TRUE(target.type == synth::MessageIn::Type::SceneSelect);
    REQUIRE_TRUE(target.sceneIx == 3);
}

TEST_CASE(MessageInBusCapacityConstructorRemainsSourceCompatibleWithLiteralZero) {
    synth::ParameterManager manager;
    synth::MessageInBus bus(&manager, 0);
    REQUIRE_TRUE(bus.Capacity() == 1);
    bus.SetParameterManager(&manager);
}

TEST_CASE(ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit) {
    synth::ParameterManager manager;
    REQUIRE_TRUE(manager.SetGestureCount(64));
    auto& group = manager.CreateGroup({.numVoices = 1, .numScenes = 1, .maxParameters = 1});
    auto& parameter = manager.CreateParameter(group, {.name = "High Gesture", .defaultValue = 0.25f});
    auto& bank = manager.CreateBank();
    bank.AddMapping(77, parameter);
    auto& slot = manager.CreateBankSlot();
    slot.AddPhysicalEncoder(77);
    slot.SelectBank(&bank);

    synth::MessageInBus bus(&manager, 16);
    synth::SystemButtonMidiInConfig buttonConfig;
    buttonConfig.associations.push_back({
        .control = synth::MidiControlAddress{.channel = 2, .cc = 9},
        .press = synth::MessageIn::SetGestureSelect(0, 63, true),
        .release = synth::MessageIn::SetGestureSelect(0, 63, false),
    });
    synth::SystemButtonMidiInProcessor buttons(buttonConfig, &bus);
    buttons.SetTimestampProvider([] { return 41; });
    buttons.Process(synth::BasicMidi::CC(0, 2, 9, 127));
    bus.Process(41);
    REQUIRE_TRUE(manager.GestureSelected(63));

    synth::AnalogMidiInConfig analogConfig;
    analogConfig.gestures.push_back({.control = {.channel = 2, .cc = 10}, .gestureIx = 63});
    synth::AnalogMidiInProcessor analog(analogConfig, &bus);
    analog.SetTimestampProvider([] { return 42; });
    analog.Process(synth::BasicMidi::CC(0, 2, 10, 127));
    bus.Process(42);
    REQUIRE_TRUE(manager.GestureValue(63) == 1.0f);

    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(43, 0, 0, 0.1f)));
    bus.Process(43); // first turn arms the selected gesture
    REQUIRE_TRUE(parameter.GestureActive(0, 63));
    REQUIRE_TRUE(bus.Push(synth::MessageIn::ParamIncDec(44, 0, 0, 0.1f)));
    bus.Process(44); // second turn edits that same active manager gesture
    REQUIRE_TRUE(parameter.GestureValue(0, 63) > 0.25f);

    auto ui = manager.CreateUIState();
    manager.PopulateUIState(*ui);
    static_assert(std::is_same_v<decltype(ui->gestures.bankAffectingMask[0].load()), std::uint32_t>);
    REQUIRE_TRUE(ui->gestures.bankAffectingMask[63].load() == 1u);
    REQUIRE_TRUE(ui->gestures.bankAffectingCount[63].load() == 1);
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

TEST_CASE(SlotValidForKindRejectsNoteEncoderTurns) {
    MidiControllerSlot slot = MakeGenericSlot("gen");
    slot.config.encoderInput = synth::EncoderMidiInConfig{};
    slot.config.encoderInput->turns.push_back({
        .control = {.channel = 1, .cc = 60, .type = synth::MidiControlType::Note},
        .slotIx = 0,
        .position = 0,
    });

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindRejectsNoteAnalogAddresses) {
    MidiControllerSlot gestureSlot = MakeGenericSlot("gesture");
    gestureSlot.config.analogInput = synth::AnalogMidiInConfig{};
    gestureSlot.config.analogInput->gestures.push_back({
        .control = {.channel = 1, .cc = 60, .type = synth::MidiControlType::Note},
        .gestureIx = 0,
    });

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(gestureSlot, &reason));
    REQUIRE_TRUE(!reason.empty());

    MidiControllerSlot sceneBlendSlot = MakeGenericSlot("scene-blend");
    sceneBlendSlot.config.analogInput = synth::AnalogMidiInConfig{};
    sceneBlendSlot.config.analogInput->sceneBlend = MidiControlAddress{
        .channel = 1,
        .cc = 61,
        .type = synth::MidiControlType::Note,
    };
    reason.clear();
    REQUIRE_TRUE(!synth::SlotValidForKind(sceneBlendSlot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindAcceptsGenericNotePushesAndSystemControls) {
    MidiControllerSlot slot = MakeGenericSlot("gen");
    slot.config.encoderInput = synth::EncoderMidiInConfig{};
    slot.config.encoderInput->pushes.push_back({
        .control = {.channel = 1, .cc = 60, .type = synth::MidiControlType::Note},
        .slotIx = 0,
        .position = 0,
    });
    MidiControllerSystemMessageAssociation association = MakeControlOnlyAssociation();
    association.control->type = synth::MidiControlType::Note;
    slot.config.systemMessages.push_back(association);

    std::string reason;
    REQUIRE_TRUE(synth::SlotValidForKind(slot, &reason));
}

TEST_CASE(SlotValidForKindRejectsNoteSystemControlsForWrldBldrAndTwister) {
    MidiControllerSlot wrld = MakeGenericSlot("wrld");
    wrld.kind = MidiProfileKind::WrldBldr;
    MidiControllerSystemMessageAssociation wrldAssociation = MakeWrldBldrAssociation();
    wrldAssociation.control->type = synth::MidiControlType::Note;
    wrld.config.systemMessages.push_back(wrldAssociation);

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(wrld, &reason));
    REQUIRE_TRUE(!reason.empty());

    MidiControllerSlot twister = MakeGenericSlot("twister");
    twister.kind = MidiProfileKind::MfTwister;
    MidiControllerSystemMessageAssociation twisterAssociation = MakeControlOnlyAssociation();
    twisterAssociation.control->type = synth::MidiControlType::Note;
    twister.config.systemMessages.push_back(twisterAssociation);
    reason.clear();
    REQUIRE_TRUE(!synth::SlotValidForKind(twister, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindRejectsTwisterAssociationWithWrongChannel) {
    // Finding 5: MfTwister system associations must carry the fixed
    // hardware channel 3 -- SlotValidForKind previously accepted any
    // control-address association regardless of channel/cc, so a
    // malformed/externally-authored association with e.g. channel 5 (a
    // shape the twister hardware cannot produce) silently passed.
    MidiControllerSlot slot = MakeGenericSlot("twist");
    slot.kind = MidiProfileKind::MfTwister;
    MidiControllerSystemMessageAssociation association = MakeControlOnlyAssociation();
    association.control->channel = 5;  // twister side buttons are fixed to channel 3
    slot.config.systemMessages.push_back(association);

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindRejectsTwisterAssociationWithCcOutsideSideButtonRange) {
    // The physical MF Twister side buttons are cc 8..13 (6 buttons) on
    // channel 3 -- a cc outside that range cannot come from real hardware.
    MidiControllerSlot slot = MakeGenericSlot("twist");
    slot.kind = MidiProfileKind::MfTwister;
    MidiControllerSystemMessageAssociation association = MakeControlOnlyAssociation();
    association.control->cc = 20;  // outside 8..13
    slot.config.systemMessages.push_back(association);

    std::string reason;
    REQUIRE_TRUE(!synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(SlotValidForKindAcceptsFullyPopulatedTwisterSideButtons) {
    // All 6 physical side buttons (cc 8..13) populated -- confirms the
    // default factory's real shape still passes after finding 5's
    // tightened validation.
    synth::MfTwisterDefaultProfileOptions options;
    for (std::size_t ix = 0; ix < options.sideButtons.size(); ++ix) {
        options.sideButtons[ix] = MidiControllerSystemMessageAssociation{
            .press = synth::MessageIn::SceneSelect(0, ix),
            .feedback = synth::MessageIn::SceneSelect(0, ix),
        };
    }
    MidiControllerSlot slot = MakeGenericSlot("twist");
    slot.kind = MidiProfileKind::MfTwister;
    slot.config = synth::MfTwisterDefaultProfileConfig(options);

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

TEST_CASE(DefaultMidiInstrumentConfigCarriesSharedWrldBldrProfile) {
    const synth::MidiInstrumentConfig instrument = synth::DefaultMidiInstrumentConfig();
    REQUIRE_TRUE(instrument.controllers.size() == 1);

    const synth::MidiControllerSlot& slot = instrument.controllers.front();
    REQUIRE_TRUE(slot.name == "wrldbldr");
    REQUIRE_TRUE(slot.kind == synth::MidiProfileKind::WrldBldr);

    std::string reason;
    REQUIRE_TRUE(synth::SlotValidForKind(slot, &reason));
    REQUIRE_TRUE(slot.config.encoderInput.has_value());
    REQUIRE_TRUE(slot.config.encoderInput->turns.size() == 16);
    REQUIRE_TRUE(slot.config.encoderInput->pushes.size() == 16);
    REQUIRE_TRUE(slot.config.systemMessages.size() == 28);
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
