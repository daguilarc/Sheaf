#include "synth/AppContext.hpp"
#include "synth/browser/BrowserMidiBridge.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "browser MIDI bridge tests must not see JUCE"
#endif

#include <chrono>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

void Require(bool condition, const char* label)
{
    if (!condition) {
        throw std::runtime_error(label);
    }
}

synth::MidiEndpointRef Ref(std::string identifier, std::string name)
{
    return synth::MidiEndpointRef{.identifier = std::move(identifier), .name = std::move(name)};
}

synth::MidiControllerSlot Slot(std::string name, synth::MidiEndpointRef input, synth::MidiEndpointRef output)
{
    return synth::MidiControllerSlot{.name = std::move(name), .input = std::move(input), .output = std::move(output)};
}

class RecordingProcessor final : public synth::MidiInProcessor {
public:
    void Process(const synth::BasicMidi& midi) override { received.push_back(midi); }

    std::vector<synth::BasicMidi> received;
};

class FakeEngine {
public:
    FakeEngine()
    {
        context.midiSender = &sender;
    }

    synth::MidiInstrumentConfig InstrumentSnapshot() const { return instrument; }
    void EditInstrument(const std::function<void(synth::MidiInstrumentConfig&)>& edit)
    {
        edit(instrument);
    }
    RecordingProcessor* MidiInputProcessor(std::size_t ix)
    {
        return ix < inputs.size() ? &inputs[ix] : nullptr;
    }
    void ResetMidiOutputProcessors(std::size_t ix) { resetSlots.push_back(ix); }
    synth::AppContext& Context() { return context; }

    synth::MidiInstrumentConfig instrument;
    std::vector<RecordingProcessor> inputs;
    std::vector<std::size_t> resetSlots;
    synth::MidiSender sender;

private:
    synth::AppContext context;
};

using Bridge = synth_browser::BrowserMidiBridge<FakeEngine>;

std::vector<Bridge::Endpoint> Endpoints()
{
    return {
        {.identifier = "in-a", .name = "Input A", .kind = Bridge::EndpointKind::Input},
        {.identifier = "out-a", .name = "Output A", .kind = Bridge::EndpointKind::Output},
        {.identifier = "in-b", .name = "Input B", .kind = Bridge::EndpointKind::Input},
        {.identifier = "out-b", .name = "Output B", .kind = Bridge::EndpointKind::Output},
    };
}

void TestReconcileBindsSlotsIndependentlyAndResyncsOutputs()
{
    FakeEngine engine;
    engine.instrument.controllers = {
        Slot("A", Ref("in-a", "Input A"), Ref("out-a", "Output A")),
        Slot("B", Ref("in-b", "Input B"), Ref("out-b", "Output B")),
    };
    engine.inputs.resize(2);
    Bridge bridge(engine);
    bridge.Start();

    bridge.SubmitEndpoints(Endpoints());
    std::vector<Bridge::Action> actions;
    while (const auto action = bridge.DequeueAction()) {
        actions.push_back(*action);
    }

    Require(actions.size() == 6, "open actions for both controller slots");
    Require(actions[0].type == Bridge::ActionType::OpenInput && actions[0].controllerIx == 0, "slot zero input open");
    Require(actions[1].type == Bridge::ActionType::OpenInput && actions[1].controllerIx == 1, "slot one input open");
    Require(actions[2].type == Bridge::ActionType::OpenOutput && actions[2].controllerIx == 0, "slot zero output open");
    Require(actions[3].type == Bridge::ActionType::OpenOutput && actions[3].controllerIx == 1, "slot one output open");
    Require(actions[4].type == Bridge::ActionType::Resync && actions[4].controllerIx == 0, "slot zero resync");
    Require(actions[5].type == Bridge::ActionType::Resync && actions[5].controllerIx == 1, "slot one resync");
    Require(engine.resetSlots == std::vector<std::size_t>({0, 1}), "each selected output resyncs independently");

    bridge.Stop();
}

void TestIncomingAndOutgoingSysexStayOnSelectedControllerSlot()
{
    FakeEngine engine;
    engine.instrument.controllers = {
        Slot("A", Ref("in-a", "Input A"), Ref("out-a", "Output A")),
        Slot("B", Ref("in-b", "Input B"), Ref("out-b", "Output B")),
    };
    engine.inputs.resize(2);
    Bridge bridge(engine);
    bridge.Start();
    bridge.SubmitEndpoints(Endpoints());
    while (bridge.DequeueAction()) {
    }

    const std::vector<std::uint8_t> inbound{0xf0, 0x7d, 0x01, 0xf7};
    Require(bridge.DeliverIncoming(1, inbound, 42), "selected input accepts sysex");
    Require(engine.inputs[0].received.empty(), "slot zero input remains untouched");
    Require(engine.inputs[1].received.size() == 1, "slot one input receives sysex");
    Require(engine.inputs[1].received[0].raw == inbound, "input sysex bytes preserved");

    const std::vector<std::uint8_t> outbound{0xf0, 0x7d, 0x02, 0xf7};
    Require(engine.sender.Enqueue(0, synth::BasicMidi::SysEx(99, outbound)), "queue selected output sysex");
    Require(engine.sender.FlushForTests(std::chrono::milliseconds(500)), "outbound bridge sink drained");
    const auto sent = bridge.DequeueOutput();
    Require(sent.has_value(), "outbound message is available to browser");
    Require(sent->controllerIx == 0, "outbound message keeps controller slot");
    Require(sent->bytes == outbound, "outbound sysex bytes preserved");
    Require(!bridge.DequeueOutput().has_value(), "outbound queue drains once");

    bridge.Stop();
}

void TestOfflineSlotDoesNotRemapAnotherSelectedSlot()
{
    FakeEngine engine;
    engine.instrument.controllers = {
        Slot("A", Ref("in-a", "Input A"), Ref("out-a", "Output A")),
        Slot("B", Ref("in-b", "Input B"), Ref("out-b", "Output B")),
    };
    engine.inputs.resize(2);
    Bridge bridge(engine);
    bridge.Start();
    bridge.SubmitEndpoints(Endpoints());
    while (bridge.DequeueAction()) {
    }

    auto withoutB = Endpoints();
    withoutB.erase(withoutB.begin() + 3);
    withoutB.erase(withoutB.begin() + 2);
    bridge.SubmitEndpoints(withoutB);
    std::vector<Bridge::Action> actions;
    while (const auto action = bridge.DequeueAction()) {
        actions.push_back(*action);
    }

    Require(actions.size() == 2, "offline selected slot closes then reports offline");
    Require(actions[0].type == Bridge::ActionType::CloseInput && actions[0].controllerIx == 1, "only slot one input closes");
    Require(actions[1].type == Bridge::ActionType::CloseOutput && actions[1].controllerIx == 1, "only slot one output closes");
    Require(bridge.ConnectionState().controllers[0].input.status == synth::MidiEndpointStatus::Online, "slot zero input stays online");
    Require(bridge.ConnectionState().controllers[0].output.status == synth::MidiEndpointStatus::Online, "slot zero output stays online");

    bridge.Stop();
}

void TestNameFallbackUpdatesStoredReferencesThroughTheBridge()
{
    FakeEngine engine;
    engine.instrument.controllers = {
        Slot("A", Ref("old-in", "Input A"), Ref("old-out", "Output A")),
    };
    engine.inputs.resize(1);
    Bridge bridge(engine);
    bridge.Start();

    bridge.SubmitEndpoints({
        {.identifier = "new-in", .name = "Input A", .kind = Bridge::EndpointKind::Input},
        {.identifier = "new-out", .name = "Output A", .kind = Bridge::EndpointKind::Output},
    });
    std::vector<Bridge::Action> actions;
    while (const auto action = bridge.DequeueAction()) {
        actions.push_back(*action);
    }

    Require(actions.size() == 5, "fallback opens, updates, and resyncs");
    Require(actions[1].type == Bridge::ActionType::UpdateInputRef && actions[1].identifier == "new-in", "input ref update action");
    Require(actions[3].type == Bridge::ActionType::UpdateOutputRef && actions[3].identifier == "new-out", "output ref update action");
    Require(engine.instrument.controllers[0].input.identifier == "new-in", "input reference updated in engine");
    Require(engine.instrument.controllers[0].output.identifier == "new-out", "output reference updated in engine");

    bridge.Stop();
}

}  // namespace

int main()
{
    TestReconcileBindsSlotsIndependentlyAndResyncsOutputs();
    TestIncomingAndOutgoingSysexStayOnSelectedControllerSlot();
    TestOfflineSlotDoesNotRemapAnotherSelectedSlot();
    TestNameFallbackUpdatesStoredReferencesThroughTheBridge();
    return 0;
}
