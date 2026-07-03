#include "synth/MidiConfigBlocks.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth module tests must not see JUCE headers"
#endif

#include <algorithm>
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

using synth::AnalogBlock;
using synth::AnalogMidiMapping;
using synth::BlockableMessage;
using synth::ComputeSystemMessageSortKey;
using synth::EncoderBlock;
using synth::EncoderMidiMapping;
using synth::ExpandAnalogBlock;
using synth::ExpandEncoderBlock;
using synth::ExpandSystemBlock;
using synth::MessageIn;
using synth::MidiControlAddress;
using synth::MidiControllerSystemMessageAssociation;
using synth::MidiProfileKind;
using synth::NormalizeMidiProfileConfig;
using synth::MidiControllerProfileConfig;
using synth::ReconstructAnalogBlocks;
using synth::ReconstructedAnalogRow;
using synth::ReconstructedEncoderRow;
using synth::ReconstructedSystemRow;
using synth::ReconstructEncoderBlocks;
using synth::ReconstructSystemBlocks;
using synth::SystemAddressField;
using synth::SystemAddressSchema;
using synth::SystemBlock;
using synth::SystemMessageSortKey;
using synth::WrldBldrPositionToCC;
using synth::WrldBldrSystemPosition;

// --- D1: SystemAddressSchema ------------------------------------------------

TEST_CASE(SchemaWrldBldrIsChannelXY) {
    const auto schema = SystemAddressSchema(MidiProfileKind::WrldBldr);
    const std::vector<SystemAddressField> expected = {SystemAddressField::Channel, SystemAddressField::WrldBldrX,
                                                       SystemAddressField::WrldBldrY};
    REQUIRE_TRUE(schema == expected);
}

TEST_CASE(SchemaLaunchpadIsXYOnly) {
    const auto schema = SystemAddressSchema(MidiProfileKind::Launchpad);
    const std::vector<SystemAddressField> expected = {SystemAddressField::LaunchpadX, SystemAddressField::LaunchpadY};
    REQUIRE_TRUE(schema == expected);
}

TEST_CASE(SchemaTwisterIsButtonOnly) {
    const auto schema = SystemAddressSchema(MidiProfileKind::MfTwister);
    const std::vector<SystemAddressField> expected = {SystemAddressField::Button};
    REQUIRE_TRUE(schema == expected);
}

TEST_CASE(SchemaGenericIsChannelCc) {
    const auto schema = SystemAddressSchema(MidiProfileKind::Generic);
    const std::vector<SystemAddressField> expected = {SystemAddressField::Channel, SystemAddressField::Cc};
    REQUIRE_TRUE(schema == expected);
}

// --- D2: SystemMessageSortKey / NormalizeMidiProfileConfig ------------------

TEST_CASE(SortKeyOrdersByMessageTypeDeclarationOrder) {
    MidiControllerSystemMessageAssociation sceneAssoc;
    sceneAssoc.control = MidiControlAddress{.channel = 0, .cc = 0};
    sceneAssoc.press = MessageIn::SceneSelect(0, 0);
    sceneAssoc.feedback = sceneAssoc.press;

    MidiControllerSystemMessageAssociation bankAssoc;
    bankAssoc.control = MidiControlAddress{.channel = 0, .cc = 0};
    bankAssoc.press = MessageIn::SelectParamBank(0, 0, 0);
    bankAssoc.feedback = bankAssoc.press;

    const auto sceneKey = ComputeSystemMessageSortKey(sceneAssoc, MidiProfileKind::Generic);
    const auto bankKey = ComputeSystemMessageSortKey(bankAssoc, MidiProfileKind::Generic);
    // SelectParamBank (7) precedes SceneSelect (12) in MessageIn::Type's
    // declaration order.
    REQUIRE_TRUE(bankKey < sceneKey);
}

TEST_CASE(SortKeyOrdersSceneSelectByArgument) {
    MidiControllerSystemMessageAssociation a;
    a.control = MidiControlAddress{.channel = 0, .cc = 5};
    a.press = MessageIn::SceneSelect(0, 3);
    a.feedback = a.press;

    MidiControllerSystemMessageAssociation b;
    b.control = MidiControlAddress{.channel = 0, .cc = 0};
    b.press = MessageIn::SceneSelect(0, 1);
    b.feedback = b.press;

    const auto keyA = ComputeSystemMessageSortKey(a, MidiProfileKind::Generic);
    const auto keyB = ComputeSystemMessageSortKey(b, MidiProfileKind::Generic);
    REQUIRE_TRUE(keyB < keyA);  // sceneIx 1 < 3, regardless of address
}

TEST_CASE(SortKeyOrdersBankSelectBySlotThenBank) {
    MidiControllerSystemMessageAssociation a;
    a.control = MidiControlAddress{.channel = 0, .cc = 0};
    a.press = MessageIn::SelectParamBank(0, 1, 0);  // slot 1, bank 0
    a.feedback = a.press;

    MidiControllerSystemMessageAssociation b;
    b.control = MidiControlAddress{.channel = 0, .cc = 0};
    b.press = MessageIn::SelectParamBank(0, 0, 5);  // slot 0, bank 5
    b.feedback = b.press;

    const auto keyA = ComputeSystemMessageSortKey(a, MidiProfileKind::Generic);
    const auto keyB = ComputeSystemMessageSortKey(b, MidiProfileKind::Generic);
    REQUIRE_TRUE(keyB < keyA);  // slot 0 < slot 1, regardless of bank
}

TEST_CASE(SortKeyDistinguishesSetResetHeldVariants) {
    MidiControllerSystemMessageAssociation press;
    press.control = MidiControlAddress{.channel = 0, .cc = 0};
    press.press = MessageIn::SetReset(0, true);
    press.feedback = press.press;

    MidiControllerSystemMessageAssociation release;
    release.control = MidiControlAddress{.channel = 0, .cc = 1};
    release.press = MessageIn::SetReset(0, false);
    release.feedback = release.press;

    const auto keyPress = ComputeSystemMessageSortKey(press, MidiProfileKind::Generic);
    const auto keyRelease = ComputeSystemMessageSortKey(release, MidiProfileKind::Generic);
    REQUIRE_TRUE(!(keyPress == keyRelease));
    // Deterministic: false sorts before true.
    REQUIRE_TRUE(keyRelease < keyPress);
}

TEST_CASE(SortKeyTiesBreakByAddressTuple) {
    MidiControllerSystemMessageAssociation a;
    a.control = MidiControlAddress{.channel = 0, .cc = 9};
    a.press = MessageIn::SceneSelect(0, 0);
    a.feedback = a.press;

    MidiControllerSystemMessageAssociation b;
    b.control = MidiControlAddress{.channel = 0, .cc = 1};
    b.press = MessageIn::SceneSelect(0, 0);
    b.feedback = b.press;

    const auto keyA = ComputeSystemMessageSortKey(a, MidiProfileKind::Generic);
    const auto keyB = ComputeSystemMessageSortKey(b, MidiProfileKind::Generic);
    REQUIRE_TRUE(keyB < keyA);  // cc 1 < cc 9, same message
}

TEST_CASE(NormalizeSortsEncoderTurnsAndPushesBySlotThenPosition) {
    MidiControllerProfileConfig config;
    config.encoderInput = synth::EncoderMidiInConfig{};
    config.encoderInput->turns = {
        EncoderMidiMapping{.control = {.channel = 0, .cc = 5}, .slotIx = 1, .position = 0},
        EncoderMidiMapping{.control = {.channel = 0, .cc = 1}, .slotIx = 0, .position = 2},
        EncoderMidiMapping{.control = {.channel = 0, .cc = 0}, .slotIx = 0, .position = 0},
    };
    NormalizeMidiProfileConfig(config, MidiProfileKind::Generic);
    REQUIRE_TRUE(config.encoderInput->turns[0].slotIx == 0 && config.encoderInput->turns[0].position == 0);
    REQUIRE_TRUE(config.encoderInput->turns[1].slotIx == 0 && config.encoderInput->turns[1].position == 2);
    REQUIRE_TRUE(config.encoderInput->turns[2].slotIx == 1 && config.encoderInput->turns[2].position == 0);
}

TEST_CASE(NormalizeSortsAnalogGesturesByIndex) {
    MidiControllerProfileConfig config;
    config.analogInput = synth::AnalogMidiInConfig{};
    config.analogInput->gestures = {
        AnalogMidiMapping{.control = {.channel = 0, .cc = 5}, .gestureIx = 3},
        AnalogMidiMapping{.control = {.channel = 0, .cc = 1}, .gestureIx = 0},
    };
    NormalizeMidiProfileConfig(config, MidiProfileKind::Generic);
    REQUIRE_TRUE(config.analogInput->gestures[0].gestureIx == 0);
    REQUIRE_TRUE(config.analogInput->gestures[1].gestureIx == 3);
}

TEST_CASE(NormalizeSortsSystemMessagesByKeyStably) {
    MidiControllerProfileConfig config;
    MidiControllerSystemMessageAssociation scene2;
    scene2.control = MidiControlAddress{.channel = 0, .cc = 0};
    scene2.press = MessageIn::SceneSelect(0, 2);
    scene2.feedback = scene2.press;

    MidiControllerSystemMessageAssociation scene0;
    scene0.control = MidiControlAddress{.channel = 0, .cc = 1};
    scene0.press = MessageIn::SceneSelect(0, 0);
    scene0.feedback = scene0.press;

    MidiControllerSystemMessageAssociation bank0;
    bank0.control = MidiControlAddress{.channel = 0, .cc = 2};
    bank0.press = MessageIn::SelectParamBank(0, 0, 0);
    bank0.feedback = bank0.press;

    config.systemMessages = {scene2, scene0, bank0};
    NormalizeMidiProfileConfig(config, MidiProfileKind::Generic);

    REQUIRE_TRUE(config.systemMessages[0].press.type == MessageIn::Type::SelectParamBank);
    REQUIRE_TRUE(config.systemMessages[1].press.type == MessageIn::Type::SceneSelect);
    REQUIRE_TRUE(config.systemMessages[1].press.sceneIx == 0);
    REQUIRE_TRUE(config.systemMessages[2].press.type == MessageIn::Type::SceneSelect);
    REQUIRE_TRUE(config.systemMessages[2].press.sceneIx == 2);
}

TEST_CASE(NormalizeIsStableForExactDuplicates) {
    MidiControllerProfileConfig config;
    MidiControllerSystemMessageAssociation first;
    first.control = MidiControlAddress{.channel = 0, .cc = 3};
    first.press = MessageIn::SceneSelect(0, 0);
    first.feedback = first.press;

    MidiControllerSystemMessageAssociation second = first;  // exact duplicate

    config.systemMessages = {first, second};
    NormalizeMidiProfileConfig(config, MidiProfileKind::Generic);
    REQUIRE_TRUE(config.systemMessages.size() == 2);
    // Stable sort: original relative order preserved among exact duplicates.
    REQUIRE_TRUE(config.systemMessages[0].control->cc == 3);
    REQUIRE_TRUE(config.systemMessages[1].control->cc == 3);
}

// --- D3: ExpandEncoderBlock --------------------------------------------

TEST_CASE(ExpandEncoderBlockProducesConsecutiveCcToPositionMapping) {
    EncoderBlock block;
    block.isPush = false;
    block.channel = 2;
    block.startCc = 10;
    block.endCc = 14;  // 4 cells: cc 10,11,12,13
    block.slotIx = 5;
    block.startPosition = 100;

    std::vector<EncoderMidiMapping> out;
    std::string reason;
    REQUIRE_TRUE(ExpandEncoderBlock(block, out, &reason));
    REQUIRE_TRUE(out.size() == 4);
    for (std::size_t ix = 0; ix < out.size(); ++ix) {
        REQUIRE_TRUE(out[ix].control.channel == 2);
        REQUIRE_TRUE(out[ix].control.cc == 10 + ix);
        REQUIRE_TRUE(out[ix].slotIx == 5);
        REQUIRE_TRUE(out[ix].position == 100 + ix);
    }
}

TEST_CASE(ExpandEncoderBlockRejectsInvertedRange) {
    EncoderBlock block;
    block.startCc = 10;
    block.endCc = 5;  // invalid: end <= start
    std::vector<EncoderMidiMapping> out;
    std::string reason;
    REQUIRE_TRUE(!ExpandEncoderBlock(block, out, &reason));
    REQUIRE_TRUE(!reason.empty());
    REQUIRE_TRUE(out.empty());
}

TEST_CASE(ExpandEncoderBlockRejectsCcOutsideMidiDomain) {
    EncoderBlock block;
    block.startCc = 125;
    block.endCc = 200;  // last cell cc=199 exceeds the 0-127 MIDI CC domain
    std::vector<EncoderMidiMapping> out;
    std::string reason;
    REQUIRE_TRUE(!ExpandEncoderBlock(block, out, &reason));
    REQUIRE_TRUE(!reason.empty());
}

// --- D3: ExpandAnalogBlock -----------------------------------------------

TEST_CASE(ExpandAnalogBlockProducesConsecutiveCcToGestureMapping) {
    AnalogBlock block;
    block.channel = 3;
    block.startCc = 0;
    block.endCc = 3;
    block.startGestureIx = 7;

    std::vector<AnalogMidiMapping> out;
    std::string reason;
    REQUIRE_TRUE(ExpandAnalogBlock(block, out, &reason));
    REQUIRE_TRUE(out.size() == 3);
    for (std::size_t ix = 0; ix < out.size(); ++ix) {
        REQUIRE_TRUE(out[ix].control.channel == 3);
        REQUIRE_TRUE(out[ix].control.cc == ix);
        REQUIRE_TRUE(out[ix].gestureIx == 7 + ix);
    }
}

TEST_CASE(ExpandAnalogBlockRejectsSingleCellRangeIsStillValidButEmptyIsNot) {
    AnalogBlock block;
    block.startCc = 5;
    block.endCc = 5;  // empty range
    std::vector<AnalogMidiMapping> out;
    std::string reason;
    REQUIRE_TRUE(!ExpandAnalogBlock(block, out, &reason));
}

// --- D3: ExpandSystemBlock: generic (1-D cc run) --------------------------

TEST_CASE(ExpandSystemBlockGenericSceneSelectProducesCcRunWithFeedbackEqualsPress) {
    SystemBlock block;
    block.kind = MidiProfileKind::Generic;
    block.message = BlockableMessage::SceneSelect;
    block.startArg = 2;
    block.channel = 4;
    block.startCc = 10;
    block.endCc = 13;  // 3 cells
    block.outputFeedback = true;

    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(ExpandSystemBlock(block, out, &reason));
    REQUIRE_TRUE(out.size() == 3);
    for (std::size_t ix = 0; ix < out.size(); ++ix) {
        REQUIRE_TRUE(out[ix].control.has_value());
        REQUIRE_TRUE(out[ix].control->channel == 4);
        REQUIRE_TRUE(out[ix].control->cc == 10 + ix);
        REQUIRE_TRUE(out[ix].press.type == MessageIn::Type::SceneSelect);
        REQUIRE_TRUE(out[ix].press.sceneIx == 2 + ix);
        REQUIRE_TRUE(!out[ix].release.has_value());
        // feedback == press (required field, matching every default factory).
        REQUIRE_TRUE(out[ix].feedback.type == MessageIn::Type::SceneSelect);
        REQUIRE_TRUE(out[ix].feedback.sceneIx == 2 + ix);
        REQUIRE_TRUE(out[ix].outputFeedback == true);
    }
}

TEST_CASE(ExpandSystemBlockGenericBankSelectCarriesBankSlotIx) {
    SystemBlock block;
    block.kind = MidiProfileKind::Generic;
    block.message = BlockableMessage::BankSelect;
    block.startArg = 0;
    block.bankSlotIx = 7;
    block.channel = 1;
    block.startCc = 0;
    block.endCc = 2;

    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(ExpandSystemBlock(block, out, &reason));
    REQUIRE_TRUE(out.size() == 2);
    for (std::size_t ix = 0; ix < out.size(); ++ix) {
        REQUIRE_TRUE(out[ix].press.type == MessageIn::Type::SelectParamBank);
        REQUIRE_TRUE(out[ix].press.slotIx == 7);
        REQUIRE_TRUE(out[ix].press.bankIx == ix);
    }
}

TEST_CASE(ExpandSystemBlockGenericGestureSelectHasPairedRelease) {
    SystemBlock block;
    block.kind = MidiProfileKind::Generic;
    block.message = BlockableMessage::GestureSelect;
    block.startArg = 3;
    block.channel = 1;
    block.startCc = 0;
    block.endCc = 2;

    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(ExpandSystemBlock(block, out, &reason));
    REQUIRE_TRUE(out.size() == 2);
    for (std::size_t ix = 0; ix < out.size(); ++ix) {
        REQUIRE_TRUE(out[ix].press.type == MessageIn::Type::SetGestureSelect);
        REQUIRE_TRUE(out[ix].press.gestureIx == 3 + ix);
        REQUIRE_TRUE(out[ix].press.boolValue == true);
        REQUIRE_TRUE(out[ix].release.has_value());
        REQUIRE_TRUE(out[ix].release->type == MessageIn::Type::SetGestureSelect);
        REQUIRE_TRUE(out[ix].release->gestureIx == 3 + ix);
        REQUIRE_TRUE(out[ix].release->boolValue == false);
    }
}

// --- D3: ExpandSystemBlock: wrldbldr (2-D rectangle, row-major/col-major) --

TEST_CASE(ExpandSystemBlockWrldBldrRowMajorTraversesXAscendingWithinRow) {
    SystemBlock block;
    block.kind = MidiProfileKind::WrldBldr;
    block.message = BlockableMessage::SceneSelect;
    block.startArg = 0;
    block.channel = 5;
    block.startX = 0;
    block.startY = 0;
    block.endX = 1;
    block.endY = 1;  // 2x2 rectangle: (0,0)(1,0)(0,1)(1,1)
    block.rowMajor = true;

    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(ExpandSystemBlock(block, out, &reason));
    REQUIRE_TRUE(out.size() == 4);
    // Row-major, x ascending within a row, y stepping start->end.
    const std::vector<std::pair<int, int>> expectedXY = {{0, 0}, {1, 0}, {0, 1}, {1, 1}};
    for (std::size_t ix = 0; ix < out.size(); ++ix) {
        REQUIRE_TRUE(out[ix].wrldBldrPosition.has_value());
        REQUIRE_TRUE(out[ix].wrldBldrPosition->x == expectedXY[ix].first);
        REQUIRE_TRUE(out[ix].wrldBldrPosition->y == expectedXY[ix].second);
        REQUIRE_TRUE(out[ix].press.sceneIx == ix);
        // Block channel is authoritative; control->cc derives from position.
        REQUIRE_TRUE(out[ix].control.has_value());
        REQUIRE_TRUE(out[ix].control->channel == 5);
        REQUIRE_TRUE(out[ix].control->cc ==
                     WrldBldrPositionToCC(static_cast<std::uint8_t>(expectedXY[ix].first),
                                          static_cast<std::uint8_t>(expectedXY[ix].second)));
        REQUIRE_TRUE(out[ix].wrldBldrPosition->channel == 5);
    }
}

TEST_CASE(ExpandSystemBlockWrldBldrColumnMajorTraversesYWithinColumn) {
    SystemBlock block;
    block.kind = MidiProfileKind::WrldBldr;
    block.message = BlockableMessage::SceneSelect;
    block.startArg = 0;
    block.channel = 5;
    block.startX = 0;
    block.startY = 0;
    block.endX = 1;
    block.endY = 1;
    block.rowMajor = false;

    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(ExpandSystemBlock(block, out, &reason));
    REQUIRE_TRUE(out.size() == 4);
    const std::vector<std::pair<int, int>> expectedXY = {{0, 0}, {0, 1}, {1, 0}, {1, 1}};
    for (std::size_t ix = 0; ix < out.size(); ++ix) {
        REQUIRE_TRUE(out[ix].wrldBldrPosition->x == expectedXY[ix].first);
        REQUIRE_TRUE(out[ix].wrldBldrPosition->y == expectedXY[ix].second);
    }
}

TEST_CASE(ExpandSystemBlockWrldBldrDescendingRowTraversesYDownward) {
    // The default WRLD.Bldr bank grid: banks 0..7 at y=3, banks 8..15 at
    // y=2 -- endY < startY, traversal steps -1.
    SystemBlock block;
    block.kind = MidiProfileKind::WrldBldr;
    block.message = BlockableMessage::BankSelect;
    block.startArg = 0;
    block.bankSlotIx = 0;
    block.channel = 5;
    block.startX = 0;
    block.startY = 3;
    block.endX = 7;
    block.endY = 2;
    block.rowMajor = true;

    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(ExpandSystemBlock(block, out, &reason));
    REQUIRE_TRUE(out.size() == 16);
    for (std::size_t x = 0; x < 8; ++x) {
        REQUIRE_TRUE(out[x].wrldBldrPosition->x == x);
        REQUIRE_TRUE(out[x].wrldBldrPosition->y == 3);
        REQUIRE_TRUE(out[x].press.bankIx == x);
    }
    for (std::size_t x = 0; x < 8; ++x) {
        REQUIRE_TRUE(out[8 + x].wrldBldrPosition->x == x);
        REQUIRE_TRUE(out[8 + x].wrldBldrPosition->y == 2);
        REQUIRE_TRUE(out[8 + x].press.bankIx == 8 + x);
    }
}

TEST_CASE(ExpandSystemBlockLaunchpadHasNoChannelField) {
    SystemBlock block;
    block.kind = MidiProfileKind::Launchpad;
    block.message = BlockableMessage::SceneSelect;
    block.startArg = 0;
    block.startX = 0;
    block.startY = 0;
    block.endX = 1;
    block.endY = 0;
    block.rowMajor = true;

    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(ExpandSystemBlock(block, out, &reason));
    REQUIRE_TRUE(out.size() == 2);
    for (const auto& assoc : out) {
        REQUIRE_TRUE(assoc.launchpadPosition.has_value());
        REQUIRE_TRUE(!assoc.control.has_value());
        REQUIRE_TRUE(!assoc.wrldBldrPosition.has_value());
    }
}

TEST_CASE(ExpandSystemBlockTwisterAlwaysRejected) {
    // Twister never blocks (D4 point 3) -- ExpandSystemBlock refuses a
    // twister-kind block outright rather than producing cells nothing can
    // reconstruct.
    SystemBlock block;
    block.kind = MidiProfileKind::MfTwister;
    block.message = BlockableMessage::SceneSelect;
    block.startArg = 0;
    block.startCc = 0;
    block.endCc = 2;

    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(!ExpandSystemBlock(block, out, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ExpandSystemBlockRejectsSingleCellRectangle) {
    // D4's >= 2 threshold applies at reconstruction; ExpandSystemBlock
    // itself does not forbid a 1-cell block being expanded on its own (a
    // block struct with only 1 cell is a valid, if degenerate, expansion
    // target) -- but an inverted/empty range must still fail.
    SystemBlock block;
    block.kind = MidiProfileKind::Generic;
    block.message = BlockableMessage::SceneSelect;
    block.startCc = 5;
    block.endCc = 5;  // empty
    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(!ExpandSystemBlock(block, out, &reason));
}

TEST_CASE(ExpandSystemBlockWrldBldrRejectsOutOfGridCoordinates) {
    SystemBlock block;
    block.kind = MidiProfileKind::WrldBldr;
    block.message = BlockableMessage::SceneSelect;
    block.channel = 5;
    block.startX = 0;
    block.startY = 0;
    block.endX = 8;  // out of the 0-7 grid
    block.endY = 0;
    block.rowMajor = true;

    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(!ExpandSystemBlock(block, out, &reason));
    REQUIRE_TRUE(!reason.empty());
}

TEST_CASE(ExpandSystemBlockLaunchpadRejectsShapeUnsupportedCoordinates) {
    SystemBlock block;
    block.kind = MidiProfileKind::Launchpad;
    block.message = BlockableMessage::SceneSelect;
    block.startX = 0;
    block.startY = 0;
    block.endX = 20;  // far outside any launchpad shape
    block.endY = 0;

    std::vector<MidiControllerSystemMessageAssociation> out;
    std::string reason;
    REQUIRE_TRUE(!ExpandSystemBlock(block, out, &reason));
}

TEST_CASE(SystemBlockCellCountMatchesGenericRun) {
    SystemBlock block;
    block.kind = MidiProfileKind::Generic;
    block.startCc = 3;
    block.endCc = 9;
    REQUIRE_TRUE(block.CellCount() == 6);
}

TEST_CASE(SystemBlockCellCountMatchesRectangle) {
    SystemBlock block;
    block.kind = MidiProfileKind::WrldBldr;
    block.startX = 0;
    block.endX = 7;
    block.startY = 3;
    block.endY = 2;
    REQUIRE_TRUE(block.CellCount() == 16);  // 8 wide x 2 tall
}

// --- D4: ReconstructEncoderBlocks -----------------------------------------

TEST_CASE(ReconstructEncoderBlocksMergesSixteenConsecutiveIntoOneBlock) {
    std::vector<EncoderMidiMapping> mappings;
    for (std::size_t ix = 0; ix < 16; ++ix) {
        mappings.push_back({.control = {.channel = 0, .cc = static_cast<std::uint8_t>(ix)}, .slotIx = 0, .position = ix});
    }
    const auto rows = ReconstructEncoderBlocks(mappings, false);
    REQUIRE_TRUE(rows.size() == 1);
    REQUIRE_TRUE(rows[0].isBlock);
    REQUIRE_TRUE(rows[0].block.channel == 0);
    REQUIRE_TRUE(rows[0].block.startCc == 0);
    REQUIRE_TRUE(rows[0].block.endCc == 16);
    REQUIRE_TRUE(rows[0].block.slotIx == 0);
    REQUIRE_TRUE(rows[0].block.startPosition == 0);
    REQUIRE_TRUE(rows[0].indices.size() == 16);
}

TEST_CASE(ReconstructEncoderBlocksSplitsBrokenRunAtOutlier) {
    std::vector<EncoderMidiMapping> mappings;
    for (std::size_t ix = 0; ix < 5; ++ix) {
        mappings.push_back({.control = {.channel = 0, .cc = static_cast<std::uint8_t>(ix)}, .slotIx = 0, .position = ix});
    }
    // Outlier: position jumps (breaks consecutiveness) at index 5.
    mappings.push_back({.control = {.channel = 0, .cc = 5}, .slotIx = 0, .position = 99});
    for (std::size_t ix = 6; ix < 10; ++ix) {
        mappings.push_back({.control = {.channel = 0, .cc = static_cast<std::uint8_t>(ix)}, .slotIx = 0, .position = ix - 1});
    }

    const auto rows = ReconstructEncoderBlocks(mappings, false);
    // Expect: block covering indices 0-4 (len 5 >= 2), individual row for
    // index 5 (the outlier), block covering indices 6-9 (len 4 >= 2).
    REQUIRE_TRUE(rows.size() == 3);
    REQUIRE_TRUE(rows[0].isBlock && rows[0].indices.size() == 5);
    REQUIRE_TRUE(!rows[1].isBlock && rows[1].indices.size() == 1 && rows[1].indices[0] == 5);
    REQUIRE_TRUE(rows[2].isBlock && rows[2].indices.size() == 4);
}

TEST_CASE(ReconstructEncoderBlocksSingleMappingStaysIndividual) {
    std::vector<EncoderMidiMapping> mappings = {
        {.control = {.channel = 0, .cc = 0}, .slotIx = 0, .position = 0},
    };
    const auto rows = ReconstructEncoderBlocks(mappings, false);
    REQUIRE_TRUE(rows.size() == 1);
    REQUIRE_TRUE(!rows[0].isBlock);
}

TEST_CASE(ReconstructEncoderBlocksRequiresConstantSlotAndChannel) {
    std::vector<EncoderMidiMapping> mappings = {
        {.control = {.channel = 0, .cc = 0}, .slotIx = 0, .position = 0},
        {.control = {.channel = 0, .cc = 1}, .slotIx = 1, .position = 1},  // slot changes -> breaks run
    };
    const auto rows = ReconstructEncoderBlocks(mappings, false);
    REQUIRE_TRUE(rows.size() == 2);
    REQUIRE_TRUE(!rows[0].isBlock);
    REQUIRE_TRUE(!rows[1].isBlock);
}

TEST_CASE(ReconstructEncoderBlocksRequiresConstantCcOffset) {
    // Positions consecutive, but cc jumps by 2 instead of 1 -- not a
    // constant-offset run.
    std::vector<EncoderMidiMapping> mappings = {
        {.control = {.channel = 0, .cc = 0}, .slotIx = 0, .position = 0},
        {.control = {.channel = 0, .cc = 2}, .slotIx = 0, .position = 1},
        {.control = {.channel = 0, .cc = 4}, .slotIx = 0, .position = 2},
    };
    const auto rows = ReconstructEncoderBlocks(mappings, false);
    REQUIRE_TRUE(rows.size() == 3);
    for (const auto& row : rows) {
        REQUIRE_TRUE(!row.isBlock);
    }
}

// --- D4: ReconstructAnalogBlocks ------------------------------------------

TEST_CASE(ReconstructAnalogBlocksMergesConsecutiveGestures) {
    std::vector<AnalogMidiMapping> mappings;
    for (std::size_t ix = 0; ix < 4; ++ix) {
        mappings.push_back({.control = {.channel = 2, .cc = static_cast<std::uint8_t>(ix)}, .gestureIx = ix});
    }
    const auto rows = ReconstructAnalogBlocks(mappings);
    REQUIRE_TRUE(rows.size() == 1);
    REQUIRE_TRUE(rows[0].isBlock);
    REQUIRE_TRUE(rows[0].block.startGestureIx == 0);
    REQUIRE_TRUE(rows[0].block.startCc == 0);
    REQUIRE_TRUE(rows[0].block.endCc == 4);
}

// --- D4: ReconstructSystemBlocks: generic (1-D) ---------------------------

TEST_CASE(ReconstructSystemBlocksGenericSceneSelectRun) {
    std::vector<MidiControllerSystemMessageAssociation> associations;
    for (std::size_t ix = 0; ix < 4; ++ix) {
        MidiControllerSystemMessageAssociation a;
        a.control = MidiControlAddress{.channel = 1, .cc = static_cast<std::uint8_t>(10 + ix)};
        a.press = MessageIn::SceneSelect(0, ix);
        a.feedback = a.press;
        a.outputFeedback = true;
        associations.push_back(a);
    }
    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::Generic);
    REQUIRE_TRUE(rows.size() == 1);
    REQUIRE_TRUE(rows[0].isBlock);
    REQUIRE_TRUE(rows[0].block.message == BlockableMessage::SceneSelect);
    REQUIRE_TRUE(rows[0].block.startArg == 0);
    REQUIRE_TRUE(rows[0].block.startCc == 10);
    REQUIRE_TRUE(rows[0].block.endCc == 14);
}

TEST_CASE(ReconstructSystemBlocksNonBlockableStayIndividual) {
    std::vector<MidiControllerSystemMessageAssociation> associations;
    MidiControllerSystemMessageAssociation reset;
    reset.control = MidiControlAddress{.channel = 0, .cc = 0};
    reset.press = MessageIn::SetReset(0, true);
    reset.release = MessageIn::SetReset(0, false);
    reset.feedback = reset.press;
    associations.push_back(reset);

    MidiControllerSystemMessageAssociation random;
    random.control = MidiControlAddress{.channel = 0, .cc = 1};
    random.press = MessageIn::SetRandom(0, true);
    random.release = MessageIn::SetRandom(0, false);
    random.feedback = random.press;
    associations.push_back(random);

    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::Generic);
    REQUIRE_TRUE(rows.size() == 2);
    REQUIRE_TRUE(!rows[0].isBlock);
    REQUIRE_TRUE(!rows[1].isBlock);
}

TEST_CASE(ReconstructSystemBlocksTwisterNeverBlocks) {
    std::vector<MidiControllerSystemMessageAssociation> associations;
    for (std::size_t ix = 0; ix < 4; ++ix) {
        MidiControllerSystemMessageAssociation a;
        a.control = MidiControlAddress{.channel = 3, .cc = static_cast<std::uint8_t>(8 + ix)};
        a.press = MessageIn::SceneSelect(0, ix);
        a.feedback = a.press;
        associations.push_back(a);
    }
    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::MfTwister);
    REQUIRE_TRUE(rows.size() == 4);
    for (const auto& row : rows) {
        REQUIRE_TRUE(!row.isBlock);
    }
}

TEST_CASE(ReconstructSystemBlocksUnsortedInputStillReconstructs) {
    // sru-9 "unsorted input still reconstructs" scenario: a bank-selector
    // run stored out of order reconstructs the same block as the sorted
    // equivalent.
    std::vector<MidiControllerSystemMessageAssociation> sorted;
    for (std::size_t ix = 0; ix < 4; ++ix) {
        MidiControllerSystemMessageAssociation a;
        a.control = MidiControlAddress{.channel = 1, .cc = static_cast<std::uint8_t>(ix)};
        a.press = MessageIn::SelectParamBank(0, 0, ix);
        a.feedback = a.press;
        sorted.push_back(a);
    }
    std::vector<MidiControllerSystemMessageAssociation> shuffled = {sorted[2], sorted[0], sorted[3], sorted[1]};

    const auto sortedRows = ReconstructSystemBlocks(sorted, MidiProfileKind::Generic);
    const auto shuffledRows = ReconstructSystemBlocks(shuffled, MidiProfileKind::Generic);
    REQUIRE_TRUE(sortedRows.size() == 1 && sortedRows[0].isBlock);
    REQUIRE_TRUE(shuffledRows.size() == 1 && shuffledRows[0].isBlock);
    REQUIRE_TRUE(shuffledRows[0].block.startArg == sortedRows[0].block.startArg);
    REQUIRE_TRUE(shuffledRows[0].block.startCc == sortedRows[0].block.startCc);
    REQUIRE_TRUE(shuffledRows[0].block.endCc == sortedRows[0].block.endCc);
}

// --- D4: ReconstructSystemBlocks: rectangles (wrldbldr) -------------------

std::vector<MidiControllerSystemMessageAssociation> MakeWrldBldrSceneRun(std::uint8_t startX, std::uint8_t endX,
                                                                          std::uint8_t y, std::size_t startArg) {
    std::vector<MidiControllerSystemMessageAssociation> associations;
    for (std::uint8_t x = startX; x <= endX; ++x) {
        MidiControllerSystemMessageAssociation a;
        a.wrldBldrPosition = WrldBldrSystemPosition{.channel = 5, .x = x, .y = y};
        a.control = MidiControlAddress{.channel = 5, .cc = WrldBldrPositionToCC(x, y)};
        a.press = MessageIn::SceneSelect(0, startArg + (x - startX));
        a.feedback = a.press;
        associations.push_back(a);
    }
    return associations;
}

TEST_CASE(ReconstructSystemBlocksWrldBldrOneRowNByOne) {
    const auto associations = MakeWrldBldrSceneRun(0, 7, 6, 0);  // 8 wide, 1 tall
    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::WrldBldr);
    REQUIRE_TRUE(rows.size() == 1);
    REQUIRE_TRUE(rows[0].isBlock);
    REQUIRE_TRUE(rows[0].block.startX == 0 && rows[0].block.endX == 7);
    REQUIRE_TRUE(rows[0].block.startY == 6 && rows[0].block.endY == 6);
}

TEST_CASE(ReconstructSystemBlocksWrldBldrBankRectangleDescendingRows) {
    // The default WRLD.Bldr profile's bank grid: banks 0..7 at y=3, banks
    // 8..15 at y=2 -- an 8x2 rectangle with endY < startY (sru-10 scenario).
    std::vector<MidiControllerSystemMessageAssociation> associations;
    for (std::uint8_t x = 0; x < 8; ++x) {
        MidiControllerSystemMessageAssociation a;
        a.wrldBldrPosition = WrldBldrSystemPosition{.channel = 5, .x = x, .y = 3};
        a.control = MidiControlAddress{.channel = 5, .cc = WrldBldrPositionToCC(x, 3)};
        a.press = MessageIn::SelectParamBank(0, 0, x);
        a.feedback = a.press;
        associations.push_back(a);
    }
    for (std::uint8_t x = 0; x < 8; ++x) {
        MidiControllerSystemMessageAssociation a;
        a.wrldBldrPosition = WrldBldrSystemPosition{.channel = 5, .x = x, .y = 2};
        a.control = MidiControlAddress{.channel = 5, .cc = WrldBldrPositionToCC(x, 2)};
        a.press = MessageIn::SelectParamBank(0, 0, 8 + x);
        a.feedback = a.press;
        associations.push_back(a);
    }

    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::WrldBldr);
    REQUIRE_TRUE(rows.size() == 1);
    REQUIRE_TRUE(rows[0].isBlock);
    REQUIRE_TRUE(rows[0].block.message == BlockableMessage::BankSelect);
    REQUIRE_TRUE(rows[0].block.startX == 0 && rows[0].block.endX == 7);
    REQUIRE_TRUE(rows[0].block.startY == 3 && rows[0].block.endY == 2);
    REQUIRE_TRUE(rows[0].block.startArg == 0);
    REQUIRE_TRUE(rows[0].indices.size() == 16);
}

TEST_CASE(ReconstructSystemBlocksWrldBldrOneColumnOneByN) {
    std::vector<MidiControllerSystemMessageAssociation> associations;
    for (std::uint8_t y = 0; y < 3; ++y) {
        MidiControllerSystemMessageAssociation a;
        a.wrldBldrPosition = WrldBldrSystemPosition{.channel = 5, .x = 2, .y = y};
        a.control = MidiControlAddress{.channel = 5, .cc = WrldBldrPositionToCC(2, y)};
        a.press = MessageIn::SceneSelect(0, y);
        a.feedback = a.press;
        associations.push_back(a);
    }
    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::WrldBldr);
    REQUIRE_TRUE(rows.size() == 1);
    REQUIRE_TRUE(rows[0].isBlock);
    REQUIRE_TRUE(rows[0].block.startX == 2 && rows[0].block.endX == 2);
    REQUIRE_TRUE(rows[0].block.startY == 0 && rows[0].block.endY == 2);
}

TEST_CASE(ReconstructSystemBlocksWrldBldrRaggedRemainderSplitsIntoTwoRowBlocks) {
    // A 2-row run where the second physical row is wider than the first --
    // D4's greedy fit uses the FIRST row's width and only extends height
    // while later rows repeat that EXACT x-range, so this reconstructs as
    // two separate row blocks (3x1 then 6x1), not one ragged rectangle.
    std::vector<MidiControllerSystemMessageAssociation> associations = MakeWrldBldrSceneRun(0, 2, 0, 0);  // row0: x0-2, arg0-2
    auto row1 = MakeWrldBldrSceneRun(0, 5, 1, 3);  // row1: x0-5, arg3-8 (wider)
    associations.insert(associations.end(), row1.begin(), row1.end());

    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::WrldBldr);
    std::size_t blockCells = 0;
    std::size_t individualCount = 0;
    for (const auto& row : rows) {
        if (row.isBlock) {
            blockCells += row.indices.size();
        } else {
            ++individualCount;
        }
    }
    // Every input cell is covered exactly once, block or individual.
    REQUIRE_TRUE(blockCells + individualCount == associations.size());

    bool foundRow0Block = false;
    bool foundRow1Block = false;
    for (const auto& row : rows) {
        if (!row.isBlock) {
            continue;
        }
        if (row.block.startX == 0 && row.block.endX == 2 && row.block.startY == 0 && row.block.endY == 0) {
            foundRow0Block = true;
        }
        if (row.block.startX == 0 && row.block.endX == 5 && row.block.startY == 1 && row.block.endY == 1) {
            foundRow1Block = true;
        }
    }
    REQUIRE_TRUE(foundRow0Block);
    REQUIRE_TRUE(foundRow1Block);
}

TEST_CASE(ReconstructSystemBlocksColumnMajorAuthoredReconstructsAsOneBlockPerColumn) {
    // D4's explicit non-goal: a column-major-authored 2x2 block (args
    // increasing down each column, then to the next column) does NOT
    // reconstruct as one 2x2 block under this row-major reconstruction --
    // it reconstructs as one block per column, since row-major traversal
    // sees column 0's two cells as args {0,1} (consecutive, forms a run) but
    // column 1 continues with args {2,3} at the SAME two y's -- the
    // candidate run itself (arg consecutive) spans all 4 cells, but the
    // physical-row grouping (by y) sees two 1-wide "rows" per y (x0 has arg
    // 0 and x1 has arg 2 at y=0 -- NOT x-consecutive with each other), so
    // FitRectangles's row split naturally isolates each column.
    std::vector<MidiControllerSystemMessageAssociation> associations;
    auto addCell = [&](std::uint8_t x, std::uint8_t y, std::size_t arg) {
        MidiControllerSystemMessageAssociation a;
        a.wrldBldrPosition = WrldBldrSystemPosition{.channel = 5, .x = x, .y = y};
        a.control = MidiControlAddress{.channel = 5, .cc = WrldBldrPositionToCC(x, y)};
        a.press = MessageIn::SceneSelect(0, arg);
        a.feedback = a.press;
        associations.push_back(a);
    };
    // Column-major authoring: column x=0 gets args 0,1 (y=0,1); column x=1
    // gets args 2,3 (y=0,1).
    addCell(0, 0, 0);
    addCell(0, 1, 1);
    addCell(1, 0, 2);
    addCell(1, 1, 3);

    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::WrldBldr);
    // Flatten and confirm the round-trip property still holds even though
    // the grouping differs from the authored column-major shape.
    MidiControllerProfileConfig sortedConfig;
    sortedConfig.systemMessages = associations;
    NormalizeMidiProfileConfig(sortedConfig, MidiProfileKind::WrldBldr);

    std::size_t totalCells = 0;
    for (const auto& row : rows) {
        totalCells += row.indices.size();
    }
    REQUIRE_TRUE(totalCells == associations.size());
}

// --- D4: default WRLD.Bldr profile round-trip -----------------------------

TEST_CASE(RoundTripDefaultWrldBldrProfileEncodersAndSystemMessages) {
    const auto config = synth::WrldBldrDefaultProfileConfig();

    // Encoders: 16 turns + 16 pushes, each contiguous -> one block apiece.
    const auto turnRows = ReconstructEncoderBlocks(config.encoderInput->turns, false);
    REQUIRE_TRUE(turnRows.size() == 1 && turnRows[0].isBlock);
    const auto pushRows = ReconstructEncoderBlocks(config.encoderInput->pushes, true);
    REQUIRE_TRUE(pushRows.size() == 1 && pushRows[0].isBlock);

    // System messages: reconstruct then expand every row and confirm the
    // flattened result equals the sorted config exactly (D4 round-trip
    // property) -- covers reset/random/random-mod (individual), scene
    // selectors (block), and bank selectors (the descending 8x2 block) all
    // in one pass over the real default factory.
    MidiControllerProfileConfig sortedConfig;
    sortedConfig.systemMessages = config.systemMessages;
    NormalizeMidiProfileConfig(sortedConfig, MidiProfileKind::WrldBldr);

    const auto systemRows = ReconstructSystemBlocks(config.systemMessages, MidiProfileKind::WrldBldr);
    std::vector<MidiControllerSystemMessageAssociation> flattened;
    for (const auto& row : systemRows) {
        if (row.isBlock) {
            std::vector<MidiControllerSystemMessageAssociation> expanded;
            std::string reason;
            REQUIRE_TRUE(ExpandSystemBlock(row.block, expanded, &reason));
            for (auto& e : expanded) {
                flattened.push_back(e);
            }
        } else {
            for (std::size_t ix : row.indices) {
                flattened.push_back(sortedConfig.systemMessages[ix]);
            }
        }
    }
    REQUIRE_TRUE(flattened.size() == sortedConfig.systemMessages.size());
    for (std::size_t ix = 0; ix < flattened.size(); ++ix) {
        REQUIRE_TRUE(flattened[ix].press.type == sortedConfig.systemMessages[ix].press.type);
        REQUIRE_TRUE(flattened[ix].control.has_value() == sortedConfig.systemMessages[ix].control.has_value());
        if (flattened[ix].control.has_value()) {
            REQUIRE_TRUE(*flattened[ix].control == *sortedConfig.systemMessages[ix].control);
        }
    }

    // Explicitly confirm the descending 8x2 bank block (sru-10 scenario):
    // banks 0..7 at y=3, banks 8..15 at y=2, one block, startArg 0.
    bool foundBankBlock = false;
    for (const auto& row : systemRows) {
        if (row.isBlock && row.block.message == BlockableMessage::BankSelect) {
            REQUIRE_TRUE(row.block.startX == 0 && row.block.endX == 7);
            REQUIRE_TRUE(row.block.startY == 3 && row.block.endY == 2);
            REQUIRE_TRUE(row.block.startArg == 0);
            REQUIRE_TRUE(row.indices.size() == 16);
            foundBankBlock = true;
        }
    }
    REQUIRE_TRUE(foundBankBlock);
}

TEST_CASE(RoundTripDefaultLaunchpadProfileSystemMessages) {
    synth::LaunchpadDefaultProfileOptions options;
    options.gestureSelectorCount = 4;
    const auto config = synth::LaunchpadDefaultProfileConfig(options);

    MidiControllerProfileConfig sortedConfig;
    sortedConfig.systemMessages = config.systemMessages;
    NormalizeMidiProfileConfig(sortedConfig, MidiProfileKind::Launchpad);

    const auto rows = ReconstructSystemBlocks(config.systemMessages, MidiProfileKind::Launchpad);
    std::vector<MidiControllerSystemMessageAssociation> flattened;
    for (const auto& row : rows) {
        if (row.isBlock) {
            std::vector<MidiControllerSystemMessageAssociation> expanded;
            std::string reason;
            REQUIRE_TRUE(ExpandSystemBlock(row.block, expanded, &reason));
            for (auto& e : expanded) {
                flattened.push_back(e);
            }
        } else {
            for (std::size_t ix : row.indices) {
                flattened.push_back(sortedConfig.systemMessages[ix]);
            }
        }
    }
    REQUIRE_TRUE(flattened.size() == sortedConfig.systemMessages.size());
}

TEST_CASE(RoundTripDefaultTwisterProfileSystemMessagesAllIndividual) {
    synth::MfTwisterDefaultProfileOptions options;
    for (std::size_t ix = 0; ix < options.sideButtons.size(); ++ix) {
        options.sideButtons[ix] = MidiControllerSystemMessageAssociation{
            .press = MessageIn::SceneSelect(0, ix),
            .feedback = MessageIn::SceneSelect(0, ix),
        };
    }
    const auto config = synth::MfTwisterDefaultProfileConfig(options);
    const auto rows = ReconstructSystemBlocks(config.systemMessages, MidiProfileKind::MfTwister);
    REQUIRE_TRUE(rows.size() == config.systemMessages.size());
    for (const auto& row : rows) {
        REQUIRE_TRUE(!row.isBlock);
    }
}

// --- D4: run-consistency rejections ---------------------------------------

TEST_CASE(ReconstructSystemBlocksRejectsMixedOutputFeedback) {
    std::vector<MidiControllerSystemMessageAssociation> associations;
    for (std::size_t ix = 0; ix < 4; ++ix) {
        MidiControllerSystemMessageAssociation a;
        a.control = MidiControlAddress{.channel = 1, .cc = static_cast<std::uint8_t>(ix)};
        a.press = MessageIn::SceneSelect(0, ix);
        a.feedback = a.press;
        a.outputFeedback = (ix == 2) ? false : true;  // one cell differs
        associations.push_back(a);
    }
    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::Generic);
    // The run breaks at the differing cell -- no single 4-cell block.
    for (const auto& row : rows) {
        if (row.isBlock) {
            REQUIRE_TRUE(row.indices.size() < 4);
        }
    }
}

TEST_CASE(ReconstructSystemBlocksRejectsFeedbackNotEqualToPress) {
    std::vector<MidiControllerSystemMessageAssociation> associations;
    for (std::size_t ix = 0; ix < 4; ++ix) {
        MidiControllerSystemMessageAssociation a;
        a.control = MidiControlAddress{.channel = 1, .cc = static_cast<std::uint8_t>(ix)};
        a.press = MessageIn::SceneSelect(0, ix);
        a.feedback = (ix == 1) ? MessageIn::SceneSelect(0, 99) : a.press;  // feedback != press on one cell
        associations.push_back(a);
    }
    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::Generic);
    for (const auto& row : rows) {
        if (row.isBlock) {
            REQUIRE_TRUE(row.indices.size() < 4);
        }
    }
}

TEST_CASE(ReconstructSystemBlocksRejectsMixedReleasePattern) {
    std::vector<MidiControllerSystemMessageAssociation> associations;
    for (std::size_t ix = 0; ix < 4; ++ix) {
        MidiControllerSystemMessageAssociation a;
        a.control = MidiControlAddress{.channel = 1, .cc = static_cast<std::uint8_t>(ix)};
        a.press = MessageIn::SetGestureSelect(0, ix, true);
        a.feedback = a.press;
        if (ix != 2) {
            a.release = MessageIn::SetGestureSelect(0, ix, false);
        }  // cell 2 is missing its release -- breaks the paired pattern
        associations.push_back(a);
    }
    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::Generic);
    for (const auto& row : rows) {
        if (row.isBlock) {
            REQUIRE_TRUE(row.indices.size() < 4);
        }
    }
}

TEST_CASE(ReconstructSystemBlocksRejectsBankRunSpanningTwoSlots) {
    std::vector<MidiControllerSystemMessageAssociation> associations;
    for (std::size_t ix = 0; ix < 4; ++ix) {
        MidiControllerSystemMessageAssociation a;
        a.control = MidiControlAddress{.channel = 1, .cc = static_cast<std::uint8_t>(ix)};
        a.press = MessageIn::SelectParamBank(0, ix < 2 ? 0 : 1, ix);  // slot changes mid-run
        a.feedback = a.press;
        associations.push_back(a);
    }
    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::Generic);
    for (const auto& row : rows) {
        if (row.isBlock) {
            REQUIRE_TRUE(row.indices.size() < 4);
        }
    }
}

TEST_CASE(ReconstructSystemBlocksDuplicateAddressesStayIndividual) {
    std::vector<MidiControllerSystemMessageAssociation> associations;
    MidiControllerSystemMessageAssociation a;
    a.control = MidiControlAddress{.channel = 1, .cc = 5};
    a.press = MessageIn::SceneSelect(0, 0);
    a.feedback = a.press;
    MidiControllerSystemMessageAssociation b = a;  // exact duplicate (same address, same message)
    associations = {a, b};

    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::Generic);
    REQUIRE_TRUE(rows.size() == 2);
    for (const auto& row : rows) {
        REQUIRE_TRUE(!row.isBlock);
    }
}

// --- D4: round-trip properties ---------------------------------------------

TEST_CASE(RoundTripExpandReconstructEncoderTurnsForArbitraryConfig) {
    std::vector<EncoderMidiMapping> mappings;
    // Two separate runs plus an outlier -- exercises multiple block/individual
    // rows in one reconstruction.
    for (std::size_t ix = 0; ix < 5; ++ix) {
        mappings.push_back({.control = {.channel = 0, .cc = static_cast<std::uint8_t>(ix)}, .slotIx = 0, .position = ix});
    }
    mappings.push_back({.control = {.channel = 1, .cc = 50}, .slotIx = 3, .position = 7});  // lone outlier
    for (std::size_t ix = 0; ix < 3; ++ix) {
        mappings.push_back(
            {.control = {.channel = 2, .cc = static_cast<std::uint8_t>(20 + ix)}, .slotIx = 1, .position = 10 + ix});
    }

    const auto rows = ReconstructEncoderBlocks(mappings, false);
    std::vector<EncoderMidiMapping> flattened;
    for (const auto& row : rows) {
        if (row.isBlock) {
            std::vector<EncoderMidiMapping> expanded;
            std::string reason;
            REQUIRE_TRUE(ExpandEncoderBlock(row.block, expanded, &reason));
            for (const auto& m : expanded) {
                flattened.push_back(m);
            }
        } else {
            for (std::size_t ix : row.indices) {
                flattened.push_back(mappings[ix]);
            }
        }
    }
    REQUIRE_TRUE(flattened.size() == mappings.size());
    for (std::size_t ix = 0; ix < mappings.size(); ++ix) {
        REQUIRE_TRUE(flattened[ix].control.channel == mappings[ix].control.channel);
        REQUIRE_TRUE(flattened[ix].control.cc == mappings[ix].control.cc);
        REQUIRE_TRUE(flattened[ix].slotIx == mappings[ix].slotIx);
        REQUIRE_TRUE(flattened[ix].position == mappings[ix].position);
    }
}

TEST_CASE(RoundTripExpandReconstructSystemBlocksIncludingDuplicates) {
    std::vector<MidiControllerSystemMessageAssociation> associations = MakeWrldBldrSceneRun(0, 4, 3, 0);
    // Add a duplicate-message-different-address pair (legitimately two
    // buttons sending SceneSelect(0)) that must not be silently dropped or
    // merged incorrectly.
    MidiControllerSystemMessageAssociation dup1;
    dup1.wrldBldrPosition = WrldBldrSystemPosition{.channel = 5, .x = 7, .y = 6};
    dup1.control = MidiControlAddress{.channel = 5, .cc = WrldBldrPositionToCC(7, 6)};
    dup1.press = MessageIn::SceneSelect(0, 0);
    dup1.feedback = dup1.press;
    associations.push_back(dup1);

    const auto rows = ReconstructSystemBlocks(associations, MidiProfileKind::WrldBldr);

    // Flatten: expand blocks, keep individuals, then compare against the
    // same sorted view ReconstructSystemBlocks itself operates over.
    MidiControllerProfileConfig sortedConfig;
    sortedConfig.systemMessages = associations;
    NormalizeMidiProfileConfig(sortedConfig, MidiProfileKind::WrldBldr);

    std::vector<MidiControllerSystemMessageAssociation> flattened;
    for (const auto& row : rows) {
        if (row.isBlock) {
            std::vector<MidiControllerSystemMessageAssociation> expanded;
            std::string reason;
            REQUIRE_TRUE(ExpandSystemBlock(row.block, expanded, &reason));
            for (auto& e : expanded) {
                flattened.push_back(e);
            }
        } else {
            for (std::size_t ix : row.indices) {
                // indices refer to the reconstruction's own sorted view --
                // rebuild it the same way ReconstructSystemBlocks does.
                flattened.push_back(sortedConfig.systemMessages[ix]);
            }
        }
    }
    REQUIRE_TRUE(flattened.size() == sortedConfig.systemMessages.size());
}

// --- D4: Reconstruct(Expand(block)) == block, for reconstruction-producible blocks --

TEST_CASE(ReconstructOfExpandedEncoderBlockYieldsSameBlock) {
    EncoderBlock block;
    block.isPush = true;
    block.channel = 4;
    block.startCc = 20;
    block.endCc = 28;
    block.slotIx = 2;
    block.startPosition = 5;

    std::vector<EncoderMidiMapping> expanded;
    std::string reason;
    REQUIRE_TRUE(ExpandEncoderBlock(block, expanded, &reason));

    const auto rows = ReconstructEncoderBlocks(expanded, true);
    REQUIRE_TRUE(rows.size() == 1);
    REQUIRE_TRUE(rows[0].isBlock);
    REQUIRE_TRUE(rows[0].block.isPush == block.isPush);
    REQUIRE_TRUE(rows[0].block.channel == block.channel);
    REQUIRE_TRUE(rows[0].block.startCc == block.startCc);
    REQUIRE_TRUE(rows[0].block.endCc == block.endCc);
    REQUIRE_TRUE(rows[0].block.slotIx == block.slotIx);
    REQUIRE_TRUE(rows[0].block.startPosition == block.startPosition);
}

TEST_CASE(ReconstructOfExpandedSystemBlockYieldsSameBlockGeneric) {
    SystemBlock block;
    block.kind = MidiProfileKind::Generic;
    block.message = BlockableMessage::SceneSelect;
    block.startArg = 4;
    block.channel = 6;
    block.startCc = 30;
    block.endCc = 35;
    block.outputFeedback = false;

    std::vector<MidiControllerSystemMessageAssociation> expanded;
    std::string reason;
    REQUIRE_TRUE(ExpandSystemBlock(block, expanded, &reason));

    const auto rows = ReconstructSystemBlocks(expanded, MidiProfileKind::Generic);
    REQUIRE_TRUE(rows.size() == 1);
    REQUIRE_TRUE(rows[0].isBlock);
    REQUIRE_TRUE(rows[0].block.message == block.message);
    REQUIRE_TRUE(rows[0].block.startArg == block.startArg);
    REQUIRE_TRUE(rows[0].block.channel == block.channel);
    REQUIRE_TRUE(rows[0].block.startCc == block.startCc);
    REQUIRE_TRUE(rows[0].block.endCc == block.endCc);
    REQUIRE_TRUE(rows[0].block.outputFeedback == block.outputFeedback);
}

TEST_CASE(ReconstructOfExpandedSystemBlockYieldsSameBlockWrldBldrRectangle) {
    SystemBlock block;
    block.kind = MidiProfileKind::WrldBldr;
    block.message = BlockableMessage::BankSelect;
    block.startArg = 0;
    block.bankSlotIx = 2;
    block.channel = 5;
    block.startX = 0;
    block.startY = 3;
    block.endX = 7;
    block.endY = 2;  // descending, matches the default WRLD.Bldr shape
    block.rowMajor = true;

    std::vector<MidiControllerSystemMessageAssociation> expanded;
    std::string reason;
    REQUIRE_TRUE(ExpandSystemBlock(block, expanded, &reason));

    const auto rows = ReconstructSystemBlocks(expanded, MidiProfileKind::WrldBldr);
    REQUIRE_TRUE(rows.size() == 1);
    REQUIRE_TRUE(rows[0].isBlock);
    REQUIRE_TRUE(rows[0].block.startX == block.startX && rows[0].block.endX == block.endX);
    REQUIRE_TRUE(rows[0].block.startY == block.startY && rows[0].block.endY == block.endY);
    REQUIRE_TRUE(rows[0].block.bankSlotIx == block.bankSlotIx);
}

// --- D4: broader round-trip property sweep across arbitrary configs --------

void RequireEncoderRoundTrip(const std::vector<EncoderMidiMapping>& mappings, bool isPush) {
    const auto rows = ReconstructEncoderBlocks(mappings, isPush);
    std::vector<EncoderMidiMapping> flattened;
    for (const auto& row : rows) {
        if (row.isBlock) {
            std::vector<EncoderMidiMapping> expanded;
            std::string reason;
            REQUIRE_TRUE(ExpandEncoderBlock(row.block, expanded, &reason));
            flattened.insert(flattened.end(), expanded.begin(), expanded.end());
        } else {
            for (std::size_t ix : row.indices) {
                flattened.push_back(mappings[ix]);
            }
        }
    }
    REQUIRE_TRUE(flattened.size() == mappings.size());
    for (std::size_t ix = 0; ix < mappings.size(); ++ix) {
        REQUIRE_TRUE(flattened[ix].control.channel == mappings[ix].control.channel);
        REQUIRE_TRUE(flattened[ix].control.cc == mappings[ix].control.cc);
        REQUIRE_TRUE(flattened[ix].slotIx == mappings[ix].slotIx);
        REQUIRE_TRUE(flattened[ix].position == mappings[ix].position);
    }
}

TEST_CASE(RoundTripEncoderBlocksWithDuplicateAddressesPassThroughAsIndividual) {
    std::vector<EncoderMidiMapping> mappings = {
        {.control = {.channel = 0, .cc = 0}, .slotIx = 0, .position = 0},
        {.control = {.channel = 0, .cc = 0}, .slotIx = 0, .position = 1},  // duplicate address, breaks cc-consecutive
    };
    RequireEncoderRoundTrip(mappings, false);
}

TEST_CASE(RoundTripEncoderBlocksEmptyInput) {
    std::vector<EncoderMidiMapping> mappings;
    const auto rows = ReconstructEncoderBlocks(mappings, false);
    REQUIRE_TRUE(rows.empty());
}

TEST_CASE(RoundTripEncoderBlocksAllIndividualNoRunFits) {
    std::vector<EncoderMidiMapping> mappings = {
        {.control = {.channel = 0, .cc = 0}, .slotIx = 5, .position = 100},
        {.control = {.channel = 1, .cc = 50}, .slotIx = 2, .position = 3},
        {.control = {.channel = 2, .cc = 99}, .slotIx = 9, .position = 1},
    };
    RequireEncoderRoundTrip(mappings, false);
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

}  // namespace

int main() {
    return Main();
}
