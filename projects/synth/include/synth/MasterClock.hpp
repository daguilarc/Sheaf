#pragma once

// JUCE-free musical-clock contracts and the bounded audio-sample/host-time
// mapper. All steady-state operations are fixed-capacity and noexcept.

#include <array>
#include <cstddef>
#include <cstdint>
#include <optional>

namespace synth {

struct SyncConfig {
    bool sendClock = false;
    bool receiveClock = false;
    bool sendTransport = false;
    bool receiveTransport = false;
    int ppqn = 24;

    bool IsValid() const noexcept { return ppqn >= 1 && ppqn <= 960; }
    bool operator==(const SyncConfig&) const = default;
};

enum class ClockTransportState : std::uint8_t {
    Stopped,
    ArmedStart,
    ArmedContinue,
    Running,
};

enum class ClockAcquisitionState : std::uint8_t {
    Internal,
    Acquiring,
    Locked,
    FreeRun,
};

enum class ClockSource : std::uint8_t {
    Internal,
    ExternalMidi,
};

struct ClockDiagnostics {
    ClockAcquisitionState acquisition = ClockAcquisitionState::Internal;
    ClockSource source = ClockSource::Internal;
    bool hasActiveExternalSource = false;
    std::size_t activeExternalSourceSlot = 0;
    double currentBpm = 120.0;
    std::uint64_t outputLatencyMicros = 0;
    std::uint64_t ignoredInputCount = 0;
    std::uint64_t lateEventCount = 0;
    std::uint64_t droppedOutputCount = 0;
    std::uint64_t mapperDiscontinuityCount = 0;
    std::uint64_t mapperGeneration = 0;
};

struct ClockPlanDescriptor {
    std::uint64_t startSample = 0;
    std::uint64_t endSample = 0;
    double lifetimeStartQuarterNotes = 0.0;
    double transportStartQuarterNotes = 0.0;
    double quarterNotesPerSample = 0.0;
    ClockTransportState transportState = ClockTransportState::Stopped;
    std::uint64_t transportEpoch = 0;
    std::uint64_t generation = 0;

    bool Contains(double absoluteOutputSample) const noexcept;
    double LifetimeQuarterNotesAt(double absoluteOutputSample) const noexcept;
    double TransportQuarterNotesAt(double absoluteOutputSample) const noexcept;
    double LifetimeEndQuarterNotes() const noexcept;
    double TransportEndQuarterNotes() const noexcept;
};

// Applications receive only const access to a plan. Its descriptor contains
// one affine segment and no per-sample storage.
class ClockBlockPlan {
public:
    constexpr ClockBlockPlan() noexcept = default;
    explicit constexpr ClockBlockPlan(ClockPlanDescriptor descriptor) noexcept
        : descriptor_(descriptor) {}

    std::uint64_t StartSample() const noexcept { return descriptor_.startSample; }
    std::uint64_t EndSample() const noexcept { return descriptor_.endSample; }
    std::uint64_t FrameCount() const noexcept {
        return descriptor_.endSample >= descriptor_.startSample
            ? descriptor_.endSample - descriptor_.startSample
            : 0;
    }
    double LifetimeStartQuarterNotes() const noexcept {
        return descriptor_.lifetimeStartQuarterNotes;
    }
    double TransportStartQuarterNotes() const noexcept {
        return descriptor_.transportState == ClockTransportState::Running
            ? descriptor_.transportStartQuarterNotes
            : 0.0;
    }
    double QuarterNotesPerSample() const noexcept {
        return descriptor_.quarterNotesPerSample;
    }
    ClockTransportState TransportState() const noexcept {
        return descriptor_.transportState;
    }
    bool IsTransportRunning() const noexcept {
        return descriptor_.transportState == ClockTransportState::Running;
    }
    std::uint64_t TransportEpoch() const noexcept { return descriptor_.transportEpoch; }
    std::uint64_t Generation() const noexcept { return descriptor_.generation; }
    const ClockPlanDescriptor& Descriptor() const noexcept { return descriptor_; }

    bool Contains(double absoluteOutputSample) const noexcept;
    double LifetimeQuarterNotesAt(double absoluteOutputSample) const noexcept;
    double TransportQuarterNotesAt(double absoluteOutputSample) const noexcept;
    std::optional<double> TryLifetimeQuarterNotesAt(double absoluteOutputSample) const noexcept;
    std::optional<double> TryTransportQuarterNotesAt(double absoluteOutputSample) const noexcept;
    double LifetimeEndQuarterNotes() const noexcept;
    double TransportEndQuarterNotes() const noexcept;

private:
    ClockPlanDescriptor descriptor_{};
};

enum class MapperObservationResult : std::uint8_t {
    Rejected,
    Anchored,
    Continuous,
    Discontinuity,
};

class AudioSampleTimeMapper {
public:
    static constexpr std::size_t kPhaseErrorWindow = 5;
    static constexpr std::size_t kHistoryCapacity = 64;
    static constexpr double kPhaseErrorEwmaGain = 1.0 / 32.0;
    static constexpr double kMaximumSlewPpm = 500.0;

    struct Diagnostics {
        bool anchored = false;
        std::uint64_t generation = 0;
        std::uint64_t discontinuityCount = 0;
        std::uint64_t lateEventCount = 0;
        std::uint64_t ignoredObservationCount = 0;
        std::size_t phaseErrorCount = 0;
        double latestPhaseErrorMicros = 0.0;
        double medianPhaseErrorMicros = 0.0;
        double filteredPhaseErrorMicros = 0.0;
        double currentMicrosPerSample = 0.0;
    };

    bool Prepare(double sampleRate, std::uint64_t outputLookaheadMicros) noexcept;
    bool IsPrepared() const noexcept { return prepared_; }
    double SampleRate() const noexcept { return sampleRate_; }
    double NominalMicrosPerSample() const noexcept { return nominalMicrosPerSample_; }
    std::uint64_t OutputLookaheadMicros() const noexcept { return outputLookaheadMicros_; }

    MapperObservationResult ObserveBlock(
        std::uint64_t blockStartSample,
        std::uint64_t callbackTimestampMicros) noexcept;

    std::optional<double> TimeMicrosAt(double absoluteOutputSample) const noexcept;
    std::optional<std::uint64_t> TimestampMicrosAt(double absoluteOutputSample) const noexcept;
    std::optional<double> SampleAtTimestamp(std::uint64_t timestampMicros) const noexcept;
    Diagnostics DiagnosticsSnapshot() const noexcept { return diagnostics_; }
    std::size_t HistorySize() const noexcept { return segmentCount_; }

private:
    struct Segment {
        double startSample = 0.0;
        double startTimeMicros = 0.0;
        double microsPerSample = 0.0;
        std::uint64_t generation = 0;
    };

    const Segment* SegmentAtSample(double absoluteOutputSample) const noexcept;
    const Segment* SegmentAtTimestamp(double timestampMicros, double& endSample) const noexcept;
    const Segment& SegmentAtLogicalIndex(std::size_t logicalIndex) const noexcept;
    void PushSegment(const Segment& segment) noexcept;
    void PushPhaseError(double errorMicros) noexcept;
    double MedianPhaseError() const noexcept;
    void ClearPhaseErrors() noexcept;

    std::array<Segment, kHistoryCapacity> segments_{};
    std::size_t segmentHead_ = 0;
    std::size_t segmentCount_ = 0;
    std::array<double, kPhaseErrorWindow> phaseErrors_{};
    std::size_t phaseErrorHead_ = 0;
    std::size_t phaseErrorCount_ = 0;
    double sampleRate_ = 0.0;
    double nominalMicrosPerSample_ = 0.0;
    double filteredPhaseErrorMicros_ = 0.0;
    std::uint64_t outputLookaheadMicros_ = 0;
    std::uint64_t lastObservedSample_ = 0;
    bool prepared_ = false;
    bool anchored_ = false;
    Diagnostics diagnostics_{};
};

struct ClockTimePoint {
    double samplePosition = 0.0;
    double lifetimeQuarterNotes = 0.0;
    double transportQuarterNotes = 0.0;
    ClockTransportState transportState = ClockTransportState::Stopped;
    std::uint64_t transportEpoch = 0;
};

class MasterClock {
public:
    static constexpr std::size_t kPlanHistoryCapacity = 64;
    static constexpr double kDefaultTempoBpm = 120.0;

    bool Prepare(double sampleRate, std::size_t blockSize) noexcept;
    bool IsPrepared() const noexcept { return prepared_; }
    double SampleRate() const noexcept { return sampleRate_; }
    std::size_t BlockSize() const noexcept { return blockSize_; }
    std::uint64_t OutputLatencyMicros() const noexcept { return outputLatencyMicros_; }

    bool SetTempoBpm(double bpm) noexcept;
    double TempoBpm() const noexcept { return activeBpm_; }
    double QuarterNotesPerSample() const noexcept { return pendingQuarterNotesPerSample_; }
    double LifetimeQuarterNotes() const noexcept;
    double TransportQuarterNotes() const noexcept;
    ClockTransportState TransportState() const noexcept { return transportState_; }
    bool IsTransportRunning() const noexcept {
        return transportState_ == ClockTransportState::Running;
    }

    bool ApplySyncConfig(const SyncConfig& config) noexcept;
    const SyncConfig& SyncConfiguration() const noexcept { return syncConfig_; }
    ClockDiagnostics DiagnosticsSnapshot() const noexcept;

    const ClockBlockPlan* CommitBlock(
        std::uint64_t blockStartSample,
        std::size_t frameCount,
        std::uint64_t callbackTimestampMicros) noexcept;
    const ClockBlockPlan* CurrentPlan() const noexcept {
        return hasCurrentPlan_ ? &currentPlan_ : nullptr;
    }

    std::size_t PlanHistorySize() const noexcept { return planHistoryCount_; }
    std::optional<ClockBlockPlan> PlanAtSample(double absoluteOutputSample) const noexcept;
    std::optional<ClockTimePoint> TimeAtSample(double absoluteOutputSample) const noexcept;
    std::optional<ClockTimePoint> TimeAtTimestamp(std::uint64_t timestampMicros) const noexcept;
    std::optional<double> SampleAtTimestamp(std::uint64_t timestampMicros) const noexcept {
        return timeMapper_.SampleAtTimestamp(timestampMicros);
    }
    const AudioSampleTimeMapper& TimeMapper() const noexcept { return timeMapper_; }

private:
    const ClockPlanDescriptor& PlanAtLogicalIndex(std::size_t logicalIndex) const noexcept;
    void PushPlan(const ClockPlanDescriptor& descriptor) noexcept;

    std::array<ClockPlanDescriptor, kPlanHistoryCapacity> planHistory_{};
    std::size_t planHistoryHead_ = 0;
    std::size_t planHistoryCount_ = 0;
    ClockBlockPlan currentPlan_{};
    AudioSampleTimeMapper timeMapper_{};
    SyncConfig syncConfig_{};
    ClockTransportState transportState_ = ClockTransportState::Stopped;
    ClockAcquisitionState acquisitionState_ = ClockAcquisitionState::Internal;
    ClockSource source_ = ClockSource::Internal;
    double sampleRate_ = 0.0;
    double manualBpm_ = kDefaultTempoBpm;
    double activeBpm_ = kDefaultTempoBpm;
    double pendingQuarterNotesPerSample_ = 0.0;
    double nextLifetimeQuarterNotes_ = 0.0;
    double nextTransportQuarterNotes_ = 0.0;
    std::size_t blockSize_ = 0;
    std::uint64_t outputLatencyMicros_ = 0;
    std::uint64_t expectedNextSample_ = 0;
    std::uint64_t transportEpoch_ = 0;
    std::uint64_t planGeneration_ = 1;
    std::uint64_t ignoredInputCount_ = 0;
    std::uint64_t droppedOutputCount_ = 0;
    bool prepared_ = false;
    bool hasCurrentPlan_ = false;
};

} // namespace synth
