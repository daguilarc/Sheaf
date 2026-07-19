#pragma once

#include "synth/MidiReconcile.hpp"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace synth_browser {

// Bridges the generic MIDI reconciliation core to a browser host. The host
// submits the Web MIDI port snapshot and applies the returned actions to its
// own port objects; this class never owns a browser object or Web API handle.
template <typename EngineType>
class BrowserMidiBridge {
public:
    enum class EndpointKind : std::uint32_t { Input = 0, Output = 1 };
    struct Endpoint {
        std::string identifier;
        std::string name;
        EndpointKind kind = EndpointKind::Input;
    };

    enum class ActionType : std::uint32_t {
        OpenInput = 0,
        OpenOutput = 1,
        CloseInput = 2,
        CloseOutput = 3,
        UpdateInputRef = 4,
        UpdateOutputRef = 5,
        Resync = 6,
    };
    struct Action {
        ActionType type = ActionType::OpenInput;
        std::size_t controllerIx = 0;
        std::string identifier;
        std::string name;
    };
    enum class OutboundDelivery : std::uint32_t {
        Immediate = 0,
        Scheduled = 1,
    };
    struct OutboundMessage {
        std::size_t controllerIx = 0;
        std::vector<std::uint8_t> bytes;
        OutboundDelivery delivery = OutboundDelivery::Immediate;
        // Absolute performance.timeOrigin-relative engine microseconds.
        // Zero for immediate controller feedback.
        std::uint64_t dueTimeMicros = 0;
    };
    struct Diagnostics {
        std::uint64_t droppedImmediateOutputCount = 0;
        std::uint64_t droppedScheduledOutputCount = 0;
        std::uint64_t lateScheduledOutputCount = 0;
    };

    static constexpr std::size_t kImmediateOutputCapacity = 256;
    static constexpr std::size_t kScheduledOutputCapacity = 256;
    // The browser main thread drains at a 16 ms cadence. Keep a full cadence
    // plus bounded task jitter between the sender snapshot and Web MIDI send.
    static constexpr std::uint64_t kSchedulingLeadMicros = 25'000;

    explicit BrowserMidiBridge(EngineType& engine)
        : engine_(engine)
    {
    }

    BrowserMidiBridge(const BrowserMidiBridge&) = delete;
    BrowserMidiBridge& operator=(const BrowserMidiBridge&) = delete;

    ~BrowserMidiBridge() { Stop(); }

    void Start()
    {
        if (started_) {
            return;
        }
        if (synth::MidiSender* sender = MidiSender()) {
            sender->Start();
        }
        started_ = true;
    }

    void Stop()
    {
        if (!started_) {
            return;
        }
        if (synth::MidiSender* sender = MidiSender()) {
            for (std::size_t ix = 0; ix < outputSinks_.size(); ++ix) {
                sender->ClearSinkSync(ix);
            }
            sender->Stop();
        }
        started_ = false;
    }

    void SubmitEndpoints(const std::vector<Endpoint>& endpoints)
    {
        const synth::MidiInstrumentConfig instrument = engine_.InstrumentSnapshot();
        ResizeForControllers(instrument.controllers.size());

        synth::MidiDeviceList present;
        for (const Endpoint& endpoint : endpoints) {
            const synth::MidiDeviceInfoRef ref{.identifier = endpoint.identifier, .name = endpoint.name};
            if (endpoint.kind == EndpointKind::Input) {
                present.inputs.push_back(ref);
            } else {
                present.outputs.push_back(ref);
            }
        }
        latestDeviceList_ = present;

        const synth::ReconcilePlan plan = synth::PlanMidiReconciliation(instrument, present, state_);
        synth::MidiEndpointOps ops;
        ops.openInput = [this](std::size_t ix, const std::string& identifier) {
            actions_.push_back({.type = ActionType::OpenInput, .controllerIx = ix, .identifier = identifier});
            return true;
        };
        ops.openOutput = [this](std::size_t ix, const std::string& identifier) {
            OutputSink* sink = OutputSinkFor(ix);
            synth::MidiSender* sender = MidiSender();
            if (sink == nullptr || sender == nullptr) {
                return false;
            }
            sink->Clear();
            sender->SetSink(ix, sink);
            actions_.push_back({.type = ActionType::OpenOutput, .controllerIx = ix, .identifier = identifier});
            return true;
        };
        ops.closeInput = [this](std::size_t ix) {
            actions_.push_back({.type = ActionType::CloseInput, .controllerIx = ix});
        };
        ops.closeOutput = [this](std::size_t ix) {
            if (synth::MidiSender* sender = MidiSender()) {
                sender->ClearSinkSync(ix);
            }
            if (OutputSink* sink = OutputSinkFor(ix)) {
                sink->Clear();
            }
            actions_.push_back({.type = ActionType::CloseOutput, .controllerIx = ix});
        };
        ops.updateInputRef = [this](std::size_t ix, const std::string& identifier, const std::string& name) {
            engine_.EditInstrument([ix, &identifier, &name](synth::MidiInstrumentConfig& config) {
                if (ix < config.controllers.size()) {
                    config.controllers[ix].input = {.identifier = identifier, .name = name};
                }
            });
            actions_.push_back(
                {.type = ActionType::UpdateInputRef, .controllerIx = ix, .identifier = identifier, .name = name});
        };
        ops.updateOutputRef = [this](std::size_t ix, const std::string& identifier, const std::string& name) {
            engine_.EditInstrument([ix, &identifier, &name](synth::MidiInstrumentConfig& config) {
                if (ix < config.controllers.size()) {
                    config.controllers[ix].output = {.identifier = identifier, .name = name};
                }
            });
            actions_.push_back(
                {.type = ActionType::UpdateOutputRef, .controllerIx = ix, .identifier = identifier, .name = name});
        };
        ops.resync = [this](std::size_t ix) {
            engine_.ResetMidiOutputProcessors(ix);
            actions_.push_back({.type = ActionType::Resync, .controllerIx = ix});
        };
        state_ = synth::ExecuteReconcilePlan(plan, state_, ops);
    }

    std::optional<Action> DequeueAction()
    {
        if (actions_.empty()) {
            return std::nullopt;
        }
        Action action = std::move(actions_.front());
        actions_.pop_front();
        return action;
    }

    bool DeliverIncoming(std::size_t controllerIx, const std::vector<std::uint8_t>& bytes,
                         std::uint64_t timestampMicros)
    {
        if (bytes.empty()) {
            return false;
        }
        synth::MidiInProcessor* processor = engine_.MidiInputProcessor(controllerIx);
        if (processor == nullptr) {
            return false;
        }
        processor->Process(synth::BasicMidi(timestampMicros, bytes));
        return true;
    }

    std::optional<OutboundMessage> DequeueOutput()
    {
        std::lock_guard lock(outputMutex_);
        if (!scheduledOutputs_.empty()) {
            OutboundMessage message = std::move(scheduledOutputs_.front());
            scheduledOutputs_.pop_front();
            if (NowMicros() > message.dueTimeMicros) {
                ++diagnostics_.lateScheduledOutputCount;
            }
            return message;
        }
        if (immediateOutputs_.empty()) {
            return std::nullopt;
        }
        OutboundMessage message = std::move(immediateOutputs_.front());
        immediateOutputs_.pop_front();
        return message;
    }

    Diagnostics DiagnosticsSnapshot() const
    {
        std::lock_guard lock(outputMutex_);
        return diagnostics_;
    }

    const synth::MidiConnectionState& ConnectionState() const { return state_; }
    synth::MidiDeviceList LatestDeviceList() const { return latestDeviceList_; }

private:
    class OutputSink final : public synth::IMidiOutputSink {
    public:
        OutputSink(BrowserMidiBridge& owner, std::size_t controllerIx)
            : owner_(owner)
            , controllerIx_(controllerIx)
        {
        }

        synth::MidiSchedulingCapability SchedulingCapability() const noexcept override
        {
            return synth::MidiSchedulingCapability::HostTimestamped;
        }

        std::uint64_t SchedulingLeadMicros() const noexcept override
        {
            return kSchedulingLeadMicros;
        }

        void Send(const synth::BasicMidi& midi) override
        {
            owner_.EnqueueOutput(controllerIx_, midi.raw, OutboundDelivery::Immediate, 0);
        }

        void SendScheduled(const synth::BasicMidi& midi, std::uint64_t dueTimeMicros) override
        {
            owner_.EnqueueOutput(
                controllerIx_, midi.raw, OutboundDelivery::Scheduled, dueTimeMicros);
        }

        void Clear()
        {
            owner_.ClearOutput(controllerIx_);
        }

    private:
        BrowserMidiBridge& owner_;
        std::size_t controllerIx_ = 0;
    };

    void EnqueueOutput(std::size_t controllerIx,
                       const std::vector<std::uint8_t>& bytes,
                       OutboundDelivery delivery,
                       std::uint64_t dueTimeMicros)
    {
        std::lock_guard lock(outputMutex_);
        auto& queue = delivery == OutboundDelivery::Scheduled
            ? scheduledOutputs_
            : immediateOutputs_;
        const std::size_t capacity = delivery == OutboundDelivery::Scheduled
            ? kScheduledOutputCapacity
            : kImmediateOutputCapacity;
        if (queue.size() >= capacity) {
            if (delivery == OutboundDelivery::Scheduled) {
                ++diagnostics_.droppedScheduledOutputCount;
            } else {
                ++diagnostics_.droppedImmediateOutputCount;
            }
            return;
        }
        queue.push_back(OutboundMessage{
            .controllerIx = controllerIx,
            .bytes = bytes,
            .delivery = delivery,
            .dueTimeMicros = dueTimeMicros,
        });
    }

    void ClearOutput(std::size_t controllerIx)
    {
        std::lock_guard lock(outputMutex_);
        std::erase_if(scheduledOutputs_, [controllerIx](const OutboundMessage& message) {
            return message.controllerIx == controllerIx;
        });
        std::erase_if(immediateOutputs_, [controllerIx](const OutboundMessage& message) {
            return message.controllerIx == controllerIx;
        });
    }

    std::uint64_t NowMicros() const
    {
        const auto& now = engine_.Context().now;
        return now ? now() : 0;
    }

    synth::MidiSender* MidiSender()
    {
        return engine_.Context().midiSender;
    }

    OutputSink* OutputSinkFor(std::size_t controllerIx)
    {
        return controllerIx < outputSinks_.size() ? outputSinks_[controllerIx].get() : nullptr;
    }

    void ResizeForControllers(std::size_t count)
    {
        if (count < outputSinks_.size()) {
            if (synth::MidiSender* sender = MidiSender()) {
                for (std::size_t ix = count; ix < outputSinks_.size(); ++ix) {
                    sender->ClearSinkSync(ix);
                    if (outputSinks_[ix] != nullptr) {
                        outputSinks_[ix]->Clear();
                    }
                }
            }
            outputSinks_.resize(count);
        } else if (count > outputSinks_.size()) {
            const std::size_t oldCount = outputSinks_.size();
            outputSinks_.resize(count);
            // MidiSender exposes a fixed sink table; controller slots beyond
            // that table can still receive input but cannot bind an output.
            const std::size_t supportedCount = std::min(count, synth::MidiSender::kMaxSinks);
            for (std::size_t ix = oldCount; ix < supportedCount; ++ix) {
                outputSinks_[ix] = std::make_unique<OutputSink>(*this, ix);
            }
        }
        state_.controllers.resize(count);
    }

    EngineType& engine_;
    synth::MidiDeviceList latestDeviceList_;
    synth::MidiConnectionState state_;
    std::vector<std::unique_ptr<OutputSink>> outputSinks_;
    std::deque<Action> actions_;
    mutable std::mutex outputMutex_;
    std::deque<OutboundMessage> scheduledOutputs_;
    std::deque<OutboundMessage> immediateOutputs_;
    Diagnostics diagnostics_;
    bool started_ = false;
};

}  // namespace synth_browser
