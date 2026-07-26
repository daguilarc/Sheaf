#include "synth/AppContext.hpp"
#include "synth/Engine.hpp"
#include "synth/browser/BrowserMidiBridge.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "browser MIDI bridge tests must not see JUCE"
#endif

#include <chrono>
#include <atomic>
#include <cstdint>
#include <limits>
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
        : sender(4096, [this] { return nowMicros.load(std::memory_order_relaxed); })
    {
        context.midiSender = &sender;
        context.now = [this] { return nowMicros.load(std::memory_order_relaxed); };
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
    std::atomic<std::uint64_t> nowMicros{10'000};
    synth::MidiSender sender;

private:
    synth::AppContext context;
};

using Bridge = synth_browser::BrowserMidiBridge<FakeEngine>;
static_assert(Bridge::kSchedulingLeadMicros == 25'000);

struct RealBridgeTestApp {
    static synth::RuntimeConfig Config()
    {
        synth::RuntimeConfig config;
        config.appName = "BrowserMidiBridgeTest";
        return config;
    }

    void Init(synth::AppContext*) {}
    void ProcessBlock(synth::AudioBlock&) {}
};

using RealEngine = synth::Engine<RealBridgeTestApp>;
using RealBridge = synth_browser::BrowserMidiBridge<RealEngine>;

synth::ScheduledMidiEvent Scheduled(
    synth::ScheduledMidiEventKind kind,
    std::uint64_t dueTimeMicros,
    std::uint64_t sequence,
    std::uint64_t generation = 0)
{
    synth::ScheduledMidiOrderingIntent ordering =
        synth::ScheduledMidiOrderingIntent::Transport;
    if (kind == synth::ScheduledMidiEventKind::TimingClock) {
        ordering = synth::ScheduledMidiOrderingIntent::Clock;
    } else if (kind == synth::ScheduledMidiEventKind::PhaseGenerationCutoff) {
        ordering = synth::ScheduledMidiOrderingIntent::GenerationCutoff;
    }
    return synth::ScheduledMidiEvent{
        .kind = kind,
        .orderingIntent = ordering,
        .broadcast = true,
        .dueTimeMicros = dueTimeMicros,
        .sequence = sequence,
        .phaseGeneration = generation,
    };
}

std::vector<Bridge::Endpoint> Endpoints()
{
    return {
        {.identifier = "in-a", .name = "Input A", .kind = Bridge::EndpointKind::Input},
        {.identifier = "out-a", .name = "Output A", .kind = Bridge::EndpointKind::Output},
        {.identifier = "in-b", .name = "Input B", .kind = Bridge::EndpointKind::Input},
        {.identifier = "out-b", .name = "Output B", .kind = Bridge::EndpointKind::Output},
    };
}

std::vector<RealBridge::Endpoint> RealEndpoints()
{
    return {
        {.identifier = "in-a", .name = "Input A", .kind = RealBridge::EndpointKind::Input},
        {.identifier = "out-a", .name = "Output A", .kind = RealBridge::EndpointKind::Output},
        {.identifier = "in-b", .name = "Input B", .kind = RealBridge::EndpointKind::Input},
        {.identifier = "out-b", .name = "Output B", .kind = RealBridge::EndpointKind::Output},
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
    Require(sent->delivery == Bridge::OutboundDelivery::Immediate,
            "controller feedback remains immediate");
    Require(sent->dueTimeMicros == 0, "immediate feedback has no scheduled deadline");
    Require(!bridge.DequeueOutput().has_value(), "outbound queue drains once");

    bridge.Stop();
}

void TestScheduledTransportRetainsDueTimeAndOutranksFeedback()
{
    FakeEngine engine;
    engine.instrument.controllers = {
        Slot("A", Ref("in-a", "Input A"), Ref("out-a", "Output A")),
    };
    engine.inputs.resize(1);
    Bridge bridge(engine);
    bridge.SubmitEndpoints(Endpoints());
    while (bridge.DequeueAction()) {
    }

    for (std::size_t index = 0; index < 256; ++index) {
        Require(engine.sender.Enqueue(
                    0, synth::BasicMidi::Realtime(index, static_cast<std::uint8_t>(0x90))),
                "feedback fills its independent availability lane");
    }
    Require(engine.sender.TryEnqueue(Scheduled(
                synth::ScheduledMidiEventKind::Continue, 10'500, 1)),
            "scheduled transport enters realtime lane");
    bridge.Start();
    Require(engine.sender.FlushForTests(std::chrono::milliseconds(500)),
            "sender drains feedback and scheduled traffic");

    const auto scheduled = bridge.DequeueOutput();
    Require(scheduled.has_value(), "scheduled transport is available");
    Require(scheduled->bytes == std::vector<std::uint8_t>{0xFB},
            "scheduled transport bytes preserved");
    Require(scheduled->delivery == Bridge::OutboundDelivery::Scheduled,
            "scheduled transport remains distinguished from feedback");
    Require(scheduled->dueTimeMicros == 10'500,
            "scheduled transport retains its absolute engine deadline");
    Require(bridge.DiagnosticsSnapshot().droppedImmediateOutputCount == 0,
            "exact feedback capacity does not drop");

    Require(engine.sender.Enqueue(0, synth::BasicMidi::Realtime(0, 0x91)),
            "newest feedback reaches sender");
    Require(engine.sender.FlushForTests(std::chrono::milliseconds(500)),
            "newest feedback attempt reaches bridge");
    Require(bridge.DiagnosticsSnapshot().droppedImmediateOutputCount == 1,
            "full feedback availability lane drops newest observably");

    for (std::size_t index = 0; index < Bridge::kScheduledOutputCapacity; ++index) {
        Require(engine.sender.TryEnqueue(Scheduled(
                    synth::ScheduledMidiEventKind::Start, 10'750, index + 2)),
                "scheduled lane accepts its fixed capacity");
    }
    Require(engine.sender.TryEnqueue(Scheduled(
                synth::ScheduledMidiEventKind::Continue,
                10'750,
                Bridge::kScheduledOutputCapacity + 2)),
            "newest scheduled event reaches the bounded browser lane");
    Require(engine.sender.FlushForTests(std::chrono::milliseconds(500)),
            "scheduled overflow attempt reaches bridge");
    Require(bridge.DiagnosticsSnapshot().droppedScheduledOutputCount == 1,
            "full scheduled availability lane drops newest observably");
    for (std::size_t index = 0; index < Bridge::kScheduledOutputCapacity; ++index) {
        const auto output = bridge.DequeueOutput();
        Require(output.has_value() && output->bytes == std::vector<std::uint8_t>{0xFA},
                "scheduled newest-drop preserves every older event in FIFO order");
    }
    bridge.Stop();
}

void TestGenerationCutoffKeepsStartBeforeOneTimeZeroClock()
{
    FakeEngine engine;
    engine.instrument.controllers = {
        Slot("A", Ref("in-a", "Input A"), Ref("out-a", "Output A")),
    };
    engine.inputs.resize(1);
    Bridge bridge(engine);
    bridge.SubmitEndpoints(Endpoints());
    while (bridge.DequeueAction()) {
    }

    Require(engine.sender.TryEnqueue(Scheduled(
                synth::ScheduledMidiEventKind::TimingClock, 10'500, 1, 7)),
            "old-generation clock enters sender");
    auto cutoff = Scheduled(
        synth::ScheduledMidiEventKind::PhaseGenerationCutoff, 10'500, 2, 8);
    cutoff.invalidatedPhaseGeneration = 7;
    cutoff.phaseCutoffDueTimeMicros = 10'500;
    Require(engine.sender.TryEnqueue(cutoff), "generation cutoff enters sender");
    Require(engine.sender.TryEnqueue(Scheduled(
                synth::ScheduledMidiEventKind::Start, 10'500, 3)),
            "Start enters sender");
    Require(engine.sender.TryEnqueue(Scheduled(
                synth::ScheduledMidiEventKind::TimingClock, 10'500, 4, 8)),
            "new time-zero clock enters sender");

    bridge.Start();
    Require(engine.sender.FlushForTests(std::chrono::milliseconds(500)),
            "cutoff and replacement events drain");
    const auto start = bridge.DequeueOutput();
    const auto clock = bridge.DequeueOutput();
    Require(start.has_value() && start->bytes == std::vector<std::uint8_t>{0xFA},
            "Start is first at the shared deadline");
    Require(clock.has_value() && clock->bytes == std::vector<std::uint8_t>{0xF8},
            "one replacement time-zero clock follows Start");
    Require(start->dueTimeMicros == 10'500 && clock->dueTimeMicros == 10'500,
            "Start and first clock keep the same absolute deadline");
    Require(!bridge.DequeueOutput().has_value(),
            "invalidated old-generation clock is never exposed to browser");
    Require(engine.sender.DiagnosticsSnapshot().staleGenerationDropCount == 1,
            "generation cutoff remains observable in concrete sender");
    bridge.Stop();
}

void TestContinuousStoppedClockAndLateDrainKeepOriginalDeadlines()
{
    FakeEngine engine;
    engine.instrument.controllers = {
        Slot("A", Ref("in-a", "Input A"), Ref("out-a", "Output A")),
    };
    engine.inputs.resize(1);
    Bridge bridge(engine);
    bridge.SubmitEndpoints(Endpoints());
    while (bridge.DequeueAction()) {
    }

    synth::MasterClock clock;
    clock.SetScheduledMidiEventSink(&engine.sender);
    Require(clock.SetTempoBpm(60.0), "stopped-clock tempo accepted");
    synth::SyncConfig config;
    config.sendClock = true;
    config.ppqn = 4;
    Require(clock.ApplySyncConfig(config), "stopped-clock send policy accepted");
    Require(clock.Prepare(100.0, 25), "stopped clock prepared");
    Require(clock.CommitBlock(0, 25, 1'000'000) != nullptr, "first stopped plan commits");
    Require(clock.CommitBlock(25, 25, 1'250'000) != nullptr, "second stopped plan commits");
    Require(clock.CommitBlock(50, 25, 1'500'000) != nullptr, "third stopped plan commits");

    engine.nowMicros.store(3'000'000, std::memory_order_relaxed);
    bridge.Start();
    Require(engine.sender.FlushForTests(std::chrono::milliseconds(500)),
            "continuous stopped clocks reach browser bridge");
    const auto first = bridge.DequeueOutput();
    const auto second = bridge.DequeueOutput();
    Require(first.has_value() && second.has_value(), "two stopped-grid clocks drain");
    Require(first->bytes == std::vector<std::uint8_t>{0xF8} &&
                second->bytes == std::vector<std::uint8_t>{0xF8},
            "stopped output contains only Timing Clock");
    Require(first->dueTimeMicros == 1'750'000 && second->dueTimeMicros == 2'000'000,
            "late drains retain analytically derived stopped-grid deadlines");
    Require(bridge.DiagnosticsSnapshot().lateScheduledOutputCount == 2,
            "each late browser availability drain increments diagnostics");
    bridge.Stop();
}

void TestOutputReconnectPurgesOldAvailabilityWithoutReplay()
{
    FakeEngine engine;
    engine.instrument.controllers = {
        Slot("A", Ref("in-a", "Input A"), Ref("out-a", "Output A")),
    };
    engine.inputs.resize(1);
    Bridge bridge(engine);
    bridge.SubmitEndpoints(Endpoints());
    while (bridge.DequeueAction()) {
    }
    Require(engine.sender.TryEnqueue(Scheduled(
                synth::ScheduledMidiEventKind::TimingClock, 10'500, 1, 2)),
            "pre-disconnect clock enters sender");
    bridge.Start();
    Require(engine.sender.FlushForTests(std::chrono::milliseconds(500)),
            "pre-disconnect clock reaches bridge availability");

    auto offline = Endpoints();
    offline.erase(offline.begin() + 1);
    bridge.SubmitEndpoints(offline);
    while (bridge.DequeueAction()) {
    }
    bridge.SubmitEndpoints(Endpoints());
    while (bridge.DequeueAction()) {
    }
    Require(!bridge.DequeueOutput().has_value(),
            "reconnect never replays output queued for the old binding");

    Require(engine.sender.TryEnqueue(Scheduled(
                synth::ScheduledMidiEventKind::TimingClock, 11'000, 2, 2)),
            "future clock enters reconnected sender binding");
    Require(engine.sender.FlushForTests(std::chrono::milliseconds(500)),
            "future clock reaches reconnected output");
    const auto future = bridge.DequeueOutput();
    Require(future.has_value() && future->dueTimeMicros == 11'000,
            "reconnected output joins future schedule only");
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

void TestLatestDeviceListMatchesSubmittedEndpoints()
{
    FakeEngine engine;
    Bridge bridge(engine);

    bridge.SubmitEndpoints(Endpoints());
    const synth::MidiDeviceList devices = bridge.LatestDeviceList();

    Require(devices.inputs.size() == 2, "latest device list retains both inputs");
    Require(devices.outputs.size() == 2, "latest device list retains both outputs");
    Require(devices.inputs[0].identifier == "in-a", "first input identifier retained");
    Require(devices.inputs[1].name == "Input B", "second input name retained");
    Require(devices.outputs[0].identifier == "out-a", "first output identifier retained");
    Require(devices.outputs[1].name == "Output B", "second output name retained");
}

void TestActiveToBlacklistedTearsDownEndpointsAndDropsStaleBrowserCallback()
{
    RealEngine engine([] { return std::uint64_t{10'000}; });
    engine.Initialize();
    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        instrument.controllers = {
            Slot("A", Ref("in-a", "Input A"), Ref("out-a", "Output A")),
        };
    });
    RealBridge bridge(engine);
    bridge.Start();
    bridge.SubmitEndpoints(RealEndpoints());
    while (bridge.DequeueAction()) {
    }

    auto staleInputCallback = [&bridge](const std::vector<std::uint8_t>& bytes) {
        return bridge.DeliverIncoming(0, bytes, 55);
    };
    Require(staleInputCallback({0xF8}),
            "active browser callback reaches selected slot");
    Require(engine.MidiBus().Size() == 1,
            "active selected slot routes browser realtime MIDI");
    synth::MessageIn activeClock;
    Require(engine.MidiBus().Pop(
                activeClock, std::numeric_limits<std::uint64_t>::max()),
            "active browser realtime MIDI can be drained");

    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        instrument.controllers[0].disposition =
            synth::MidiControllerDisposition::Blacklisted;
    });
    bridge.SubmitEndpoints(RealEndpoints());
    std::vector<RealBridge::Action> teardown;
    while (const auto action = bridge.DequeueAction()) {
        teardown.push_back(*action);
    }
    Require(teardown.size() == 2, "blacklisting closes both active endpoints");
    Require(teardown[0].type == RealBridge::ActionType::CloseInput &&
                teardown[0].controllerIx == 0,
            "blacklisting closes the active input");
    Require(teardown[1].type == RealBridge::ActionType::CloseOutput &&
                teardown[1].controllerIx == 0,
            "blacklisting closes the active output");
    Require(bridge.ConnectionState().controllers[0].input.status ==
                synth::MidiEndpointStatus::Unconfigured,
            "blacklisted input becomes deliberately unconfigured");
    Require(bridge.ConnectionState().controllers[0].output.status ==
                synth::MidiEndpointStatus::Unconfigured,
            "blacklisted output becomes deliberately unconfigured");

    Require(staleInputCallback({0xF8}),
            "stale browser realtime callback still resolves the preserved slot");
    Require(engine.MidiBus().Size() == 0,
            "drop processor discards stale browser realtime callbacks");

    Require(engine.Context().midiSender->Enqueue(
                0, synth::BasicMidi::SysEx(
                       0, std::vector<std::uint8_t>{0xF0, 0x7D, 0x02, 0xF7})),
            "blacklisted output enqueue is accepted by the sender queue");
    Require(engine.Context().midiSender->FlushForTests(std::chrono::milliseconds(500)),
            "blacklisted output enqueue drains");
    Require(!bridge.DequeueOutput().has_value(),
            "blacklisted controller has no sender sink route");

    engine.EditInstrument([](synth::MidiInstrumentConfig& instrument) {
        instrument.controllers[0].disposition =
            synth::MidiControllerDisposition::Active;
    });
    bridge.SubmitEndpoints(RealEndpoints());
    std::vector<RealBridge::Action> activation;
    while (const auto action = bridge.DequeueAction()) {
        activation.push_back(*action);
    }
    Require(activation.size() == 3, "reactivation opens both endpoints and resyncs");
    Require(activation[0].type == RealBridge::ActionType::OpenInput,
            "reactivation opens the input");
    Require(activation[1].type == RealBridge::ActionType::OpenOutput,
            "reactivation opens the output");
    Require(activation[2].type == RealBridge::ActionType::Resync,
            "reactivation resyncs controller feedback");
    Require(staleInputCallback({0xF8}),
            "reactivated browser callback resolves the active processor");
    Require(engine.MidiBus().Size() == 1,
            "reactivated selected slot routes browser realtime MIDI again");

    bridge.Stop();
}

}  // namespace

int main()
{
    TestReconcileBindsSlotsIndependentlyAndResyncsOutputs();
    TestIncomingAndOutgoingSysexStayOnSelectedControllerSlot();
    TestScheduledTransportRetainsDueTimeAndOutranksFeedback();
    TestGenerationCutoffKeepsStartBeforeOneTimeZeroClock();
    TestContinuousStoppedClockAndLateDrainKeepOriginalDeadlines();
    TestOutputReconnectPurgesOldAvailabilityWithoutReplay();
    TestOfflineSlotDoesNotRemapAnotherSelectedSlot();
    TestNameFallbackUpdatesStoredReferencesThroughTheBridge();
    TestLatestDeviceListMatchesSubmittedEndpoints();
    TestActiveToBlacklistedTearsDownEndpointsAndDropsStaleBrowserCallback();
    return 0;
}
