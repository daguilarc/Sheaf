#pragma once

#include "synth/ControllerWizard.hpp"

#include <cstdint>
#include <utility>

namespace synth {

// Runtime hosts own their device-list signal and instrument-commit lifecycle.
// This JUCE-free cache owns only the derived classification: callers update a
// snapshot when its source changed, then render Discovery() without doing any
// device enumeration or reconciliation.
class ControllerWizardDiscoveryCache final {
public:
    bool UpdateDeviceList(MidiDeviceList devices)
    {
        if (hasDeviceList_ && devices == devices_)
        {
            return false;
        }
        devices_ = std::move(devices);
        hasDeviceList_ = true;
        Recompute();
        return true;
    }

    void UpdateInstrumentSnapshot(MidiInstrumentConfig instrument)
    {
        instrument_ = std::move(instrument);
        Recompute();
    }

    bool HasDeviceList() const { return hasDeviceList_; }
    const MidiDeviceList& DeviceList() const { return devices_; }
    const WizardDiscovery& Discovery() const { return discovery_; }
    std::uint64_t Revision() const { return revision_; }

private:
    void Recompute()
    {
        discovery_ = DiscoverControllerWizards(devices_, instrument_, ControllerWizardRegistry());
        ++revision_;
    }

    MidiDeviceList devices_;
    MidiInstrumentConfig instrument_;
    WizardDiscovery discovery_;
    bool hasDeviceList_ = false;
    std::uint64_t revision_ = 0;
};

}  // namespace synth
