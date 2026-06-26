#pragma once

#include "synth/MidiController.hpp"

#include <juce_audio_devices/juce_audio_devices.h>

#include <cmath>
#include <memory>
#include <mutex>
#include <optional>
#include <vector>

namespace synth_juce {

class MidiInHandler final : private juce::MidiInputCallback {
public:
    MidiInHandler() = default;
    explicit MidiInHandler(std::unique_ptr<synth::MidiInProcessor> processor)
        : processor_(std::move(processor)) {}
    ~MidiInHandler() override { Close(); }

    MidiInHandler(const MidiInHandler&) = delete;
    MidiInHandler& operator=(const MidiInHandler&) = delete;

    static juce::Array<juce::MidiDeviceInfo> AvailableDevices() {
        return juce::MidiInput::getAvailableDevices();
    }

    void SetProcessor(std::unique_ptr<synth::MidiInProcessor> processor) {
        std::lock_guard lock(processorMutex_);
        processor_ = std::move(processor);
    }

    synth::MidiInProcessor* Processor() const {
        std::lock_guard lock(processorMutex_);
        return processor_.get();
    }

    bool Open(const juce::String& identifier) {
        Close();
        lastError_.clear();
        const auto devices = juce::MidiInput::getAvailableDevices();
        juce::MidiDeviceInfo selected;
        bool found = false;
        for (const auto& device : devices) {
            if (device.identifier == identifier) {
                selected = device;
                found = true;
                break;
            }
        }
        if (!found) {
            lastError_ = "Input device not found";
            return false;
        }

        auto input = juce::MidiInput::openDevice(identifier, this);
        if (input == nullptr) {
            lastError_ = "Input open failed";
            return false;
        }

        deviceIdentifier_ = selected.identifier;
        deviceName_ = selected.name;
        input_ = std::move(input);
        input_->start();
        return true;
    }

    void Close() {
        if (input_ != nullptr) {
            input_->stop();
            input_.reset();
        }
        deviceIdentifier_.clear();
        deviceName_.clear();
    }

    bool IsOpen() const { return input_ != nullptr; }
    const juce::String& DeviceIdentifier() const { return deviceIdentifier_; }
    const juce::String& DeviceName() const { return deviceName_; }
    const juce::String& LastError() const { return lastError_; }

private:
    void handleIncomingMidiMessage(juce::MidiInput*, const juce::MidiMessage& message) override {
        const auto midi = Convert(message);
        if (!midi.has_value()) {
            return;
        }
        std::lock_guard lock(processorMutex_);
        if (processor_ != nullptr) {
            processor_->Process(*midi);
        }
    }

    static std::optional<synth::BasicMidi> Convert(const juce::MidiMessage& message) {
        const auto* data = message.getRawData();
        const int size = message.getRawDataSize();
        const double timestampSeconds = std::max(0.0, message.getTimeStamp());
        const std::uint64_t timestamp = static_cast<std::uint64_t>(std::llround(timestampSeconds * 1000000.0));
        if (size == 3) {
            return synth::BasicMidi(timestamp, data[0], data[1], data[2]);
        }
        if (size == 1 && synth::BasicMidi::IsSupportedRealtimeStatus(data[0])) {
            return synth::BasicMidi::Realtime(timestamp, data[0]);
        }
        if (size > 1 && data[0] == 0xF0) {
            return synth::BasicMidi::SysEx(timestamp, std::vector<std::uint8_t>(data, data + size));
        }
        return std::nullopt;
    }

    mutable std::mutex processorMutex_;
    std::unique_ptr<synth::MidiInProcessor> processor_;
    std::unique_ptr<juce::MidiInput> input_;
    juce::String deviceIdentifier_;
    juce::String deviceName_;
    juce::String lastError_;
};

class MidiOutputHandler final : public synth::IMidiOutputSink {
public:
    MidiOutputHandler() = default;
    ~MidiOutputHandler() override { Close(); }

    MidiOutputHandler(const MidiOutputHandler&) = delete;
    MidiOutputHandler& operator=(const MidiOutputHandler&) = delete;

    static juce::Array<juce::MidiDeviceInfo> AvailableDevices() {
        return juce::MidiOutput::getAvailableDevices();
    }

    bool Open(const juce::String& identifier) {
        Close();
        lastError_.clear();
        const auto devices = juce::MidiOutput::getAvailableDevices();
        juce::MidiDeviceInfo selected;
        bool found = false;
        for (const auto& device : devices) {
            if (device.identifier == identifier) {
                selected = device;
                found = true;
                break;
            }
        }
        if (!found) {
            lastError_ = "Output device not found";
            return false;
        }

        auto output = juce::MidiOutput::openDevice(identifier);
        if (output == nullptr) {
            lastError_ = "Output open failed";
            return false;
        }

        std::lock_guard lock(mutex_);
        output_ = std::move(output);
        deviceIdentifier_ = selected.identifier;
        deviceName_ = selected.name;
        return true;
    }

    void Close() {
        std::lock_guard lock(mutex_);
        output_.reset();
        deviceIdentifier_.clear();
        deviceName_.clear();
    }

    bool IsOpen() const {
        std::lock_guard lock(mutex_);
        return output_ != nullptr;
    }

    const juce::String& DeviceIdentifier() const { return deviceIdentifier_; }
    const juce::String& DeviceName() const { return deviceName_; }
    const juce::String& LastError() const { return lastError_; }

    void Send(const synth::BasicMidi& midi) override {
        if (midi.raw.empty()) {
            return;
        }
        std::lock_guard lock(mutex_);
        if (output_ == nullptr) {
            return;
        }
        output_->sendMessageNow(juce::MidiMessage(midi.raw.data(), static_cast<int>(midi.raw.size())));
    }

private:
    mutable std::mutex mutex_;
    std::unique_ptr<juce::MidiOutput> output_;
    juce::String deviceIdentifier_;
    juce::String deviceName_;
    juce::String lastError_;
};

} // namespace synth_juce
