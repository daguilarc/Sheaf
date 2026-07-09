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
    struct OutboundMessage {
        std::size_t controllerIx = 0;
        std::vector<std::uint8_t> bytes;
    };

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
                sender->SetSink(ix, nullptr);
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
        if (outputSinks_.empty()) {
            return std::nullopt;
        }
        for (std::size_t offset = 0; offset < outputSinks_.size(); ++offset) {
            const std::size_t ix = (nextOutputSlot_ + offset) % outputSinks_.size();
            if (outputSinks_[ix] == nullptr) {
                continue;
            }
            if (std::optional<std::vector<std::uint8_t>> bytes = outputSinks_[ix]->Dequeue()) {
                nextOutputSlot_ = (ix + 1) % outputSinks_.size();
                return OutboundMessage{.controllerIx = ix, .bytes = std::move(*bytes)};
            }
        }
        return std::nullopt;
    }

    const synth::MidiConnectionState& ConnectionState() const { return state_; }

private:
    class OutputSink final : public synth::IMidiOutputSink {
    public:
        void Send(const synth::BasicMidi& midi) override
        {
            std::lock_guard lock(mutex_);
            if (messages_.size() < kMaxQueuedMessages) {
                messages_.push_back(midi.raw);
            }
        }

        std::optional<std::vector<std::uint8_t>> Dequeue()
        {
            std::lock_guard lock(mutex_);
            if (messages_.empty()) {
                return std::nullopt;
            }
            std::vector<std::uint8_t> bytes = std::move(messages_.front());
            messages_.pop_front();
            return bytes;
        }

        void Clear()
        {
            std::lock_guard lock(mutex_);
            messages_.clear();
        }

    private:
        static constexpr std::size_t kMaxQueuedMessages = 256;
        std::mutex mutex_;
        std::deque<std::vector<std::uint8_t>> messages_;
    };

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
                }
            }
            outputSinks_.resize(count);
        } else if (count > outputSinks_.size()) {
            const std::size_t oldCount = outputSinks_.size();
            outputSinks_.resize(count);
            const std::size_t supportedCount = std::min(count, synth::MidiSender::kMaxSinks);
            for (std::size_t ix = oldCount; ix < supportedCount; ++ix) {
                outputSinks_[ix] = std::make_unique<OutputSink>();
            }
        }
        state_.controllers.resize(count);
        if (!outputSinks_.empty()) {
            nextOutputSlot_ %= outputSinks_.size();
        } else {
            nextOutputSlot_ = 0;
        }
    }

    EngineType& engine_;
    synth::MidiConnectionState state_;
    std::vector<std::unique_ptr<OutputSink>> outputSinks_;
    std::deque<Action> actions_;
    std::size_t nextOutputSlot_ = 0;
    bool started_ = false;
};

}  // namespace synth_browser
