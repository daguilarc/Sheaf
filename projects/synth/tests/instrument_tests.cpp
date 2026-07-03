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
    association.press = synth::MessageIn::SetShift(0, true);
    association.feedback = association.press;
    return association;
}

MidiControllerSystemMessageAssociation MakeWrldBldrAssociation() {
    MidiControllerSystemMessageAssociation association;
    association.control = MidiControlAddress{.channel = 5, .cc = 0};
    association.wrldBldrPosition = WrldBldrSystemPosition{.channel = 5, .x = 0, .y = 0};
    association.press = synth::MessageIn::SetShift(0, true);
    association.feedback = association.press;
    return association;
}

MidiControllerSystemMessageAssociation MakeLaunchpadAssociation() {
    MidiControllerSystemMessageAssociation association;
    association.launchpadPosition = synth::LaunchpadGridPosition{
        .controller = synth::LaunchpadController::LaunchpadX, .x = 0, .y = 0};
    association.press = synth::MessageIn::SetShift(0, true);
    association.feedback = association.press;
    return association;
}

MidiControllerSystemMessageAssociation MakeNoAddressAssociation() {
    MidiControllerSystemMessageAssociation association;
    association.press = synth::MessageIn::SetShift(0, true);
    association.feedback = association.press;
    return association;
}

MidiControllerSystemMessageAssociation MakeWrldBldrPositionOnlyAssociation() {
    MidiControllerSystemMessageAssociation association;
    association.wrldBldrPosition = WrldBldrSystemPosition{.channel = 5, .x = 0, .y = 0};
    association.press = synth::MessageIn::SetShift(0, true);
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
