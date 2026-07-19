#include "synth/MasterClock.hpp"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <limits>

namespace synth {

namespace {

bool IsFinitePositive(double value) noexcept {
    return std::isfinite(value) && value > 0.0;
}

} // namespace

bool ClockPlanDescriptor::Contains(double absoluteOutputSample) const noexcept {
    return std::isfinite(absoluteOutputSample) &&
           absoluteOutputSample >= static_cast<double>(startSample) &&
           absoluteOutputSample < static_cast<double>(endSample);
}

double ClockPlanDescriptor::LifetimeQuarterNotesAt(double absoluteOutputSample) const noexcept {
    return lifetimeStartQuarterNotes +
           (absoluteOutputSample - static_cast<double>(startSample)) * quarterNotesPerSample;
}

double ClockPlanDescriptor::TransportQuarterNotesAt(double absoluteOutputSample) const noexcept {
    if (transportState != ClockTransportState::Running) {
        return 0.0;
    }
    return transportStartQuarterNotes +
           (absoluteOutputSample - static_cast<double>(startSample)) * quarterNotesPerSample;
}

double ClockPlanDescriptor::LifetimeEndQuarterNotes() const noexcept {
    return LifetimeQuarterNotesAt(static_cast<double>(endSample));
}

double ClockPlanDescriptor::TransportEndQuarterNotes() const noexcept {
    if (transportState != ClockTransportState::Running) {
        return 0.0;
    }
    return TransportQuarterNotesAt(static_cast<double>(endSample));
}

bool ClockBlockPlan::Contains(double absoluteOutputSample) const noexcept {
    return descriptor_.Contains(absoluteOutputSample);
}

double ClockBlockPlan::LifetimeQuarterNotesAt(double absoluteOutputSample) const noexcept {
    assert(Contains(absoluteOutputSample));
    return descriptor_.LifetimeQuarterNotesAt(absoluteOutputSample);
}

double ClockBlockPlan::TransportQuarterNotesAt(double absoluteOutputSample) const noexcept {
    assert(Contains(absoluteOutputSample));
    return descriptor_.TransportQuarterNotesAt(absoluteOutputSample);
}

std::optional<double> ClockBlockPlan::TryLifetimeQuarterNotesAt(
    double absoluteOutputSample) const noexcept {
    if (!Contains(absoluteOutputSample)) {
        return std::nullopt;
    }
    return descriptor_.LifetimeQuarterNotesAt(absoluteOutputSample);
}

std::optional<double> ClockBlockPlan::TryTransportQuarterNotesAt(
    double absoluteOutputSample) const noexcept {
    if (!Contains(absoluteOutputSample)) {
        return std::nullopt;
    }
    return descriptor_.TransportQuarterNotesAt(absoluteOutputSample);
}

double ClockBlockPlan::LifetimeEndQuarterNotes() const noexcept {
    return descriptor_.LifetimeEndQuarterNotes();
}

double ClockBlockPlan::TransportEndQuarterNotes() const noexcept {
    return descriptor_.TransportEndQuarterNotes();
}

bool AudioSampleTimeMapper::Prepare(
    double sampleRate,
    std::uint64_t outputLookaheadMicros) noexcept {
    if (!IsFinitePositive(sampleRate) || outputLookaheadMicros == 0) {
        return false;
    }

    sampleRate_ = sampleRate;
    nominalMicrosPerSample_ = 1'000'000.0 / sampleRate;
    outputLookaheadMicros_ = outputLookaheadMicros;
    segmentHead_ = 0;
    segmentCount_ = 0;
    lastObservedSample_ = 0;
    prepared_ = true;
    anchored_ = false;
    ClearPhaseErrors();
    diagnostics_ = {};
    diagnostics_.currentMicrosPerSample = nominalMicrosPerSample_;
    return true;
}

MapperObservationResult AudioSampleTimeMapper::ObserveBlock(
    std::uint64_t blockStartSample,
    std::uint64_t callbackTimestampMicros) noexcept {
    if (!prepared_ || (anchored_ && blockStartSample <= lastObservedSample_)) {
        ++diagnostics_.ignoredObservationCount;
        return MapperObservationResult::Rejected;
    }

    if (!anchored_) {
        diagnostics_.generation = 1;
        PushSegment(Segment{
            .startSample = static_cast<double>(blockStartSample),
            .startTimeMicros = static_cast<double>(callbackTimestampMicros),
            .microsPerSample = nominalMicrosPerSample_,
            .generation = diagnostics_.generation,
        });
        lastObservedSample_ = blockStartSample;
        anchored_ = true;
        diagnostics_.anchored = true;
        diagnostics_.currentMicrosPerSample = nominalMicrosPerSample_;
        return MapperObservationResult::Anchored;
    }

    const auto predictedValue = TimeMicrosAt(static_cast<double>(blockStartSample));
    if (!predictedValue.has_value()) {
        ++diagnostics_.ignoredObservationCount;
        return MapperObservationResult::Rejected;
    }
    const double predicted = *predictedValue;
    const double observed = static_cast<double>(callbackTimestampMicros);
    const double error = observed - predicted;
    diagnostics_.latestPhaseErrorMicros = error;

    if (std::fabs(error) > static_cast<double>(outputLookaheadMicros_)) {
        ClearPhaseErrors();
        diagnostics_.latestPhaseErrorMicros = error;
        ++diagnostics_.generation;
        ++diagnostics_.discontinuityCount;
        ++diagnostics_.lateEventCount;
        const double resetTime = std::max(observed, predicted);
        PushSegment(Segment{
            .startSample = static_cast<double>(blockStartSample),
            .startTimeMicros = resetTime,
            .microsPerSample = nominalMicrosPerSample_,
            .generation = diagnostics_.generation,
        });
        diagnostics_.currentMicrosPerSample = nominalMicrosPerSample_;
        lastObservedSample_ = blockStartSample;
        return MapperObservationResult::Discontinuity;
    }

    PushPhaseError(error);
    const double median = MedianPhaseError();
    filteredPhaseErrorMicros_ +=
        (median - filteredPhaseErrorMicros_) * kPhaseErrorEwmaGain;
    const double sampleDelta = static_cast<double>(blockStartSample - lastObservedSample_);
    const double maximumAdjustment = nominalMicrosPerSample_ * kMaximumSlewPpm / 1'000'000.0;
    const double desiredAdjustment = filteredPhaseErrorMicros_ / sampleDelta;
    const double nextSlope = nominalMicrosPerSample_ +
        std::clamp(desiredAdjustment, -maximumAdjustment, maximumAdjustment);

    PushSegment(Segment{
        .startSample = static_cast<double>(blockStartSample),
        .startTimeMicros = predicted,
        .microsPerSample = nextSlope,
        .generation = diagnostics_.generation,
    });
    diagnostics_.medianPhaseErrorMicros = median;
    diagnostics_.filteredPhaseErrorMicros = filteredPhaseErrorMicros_;
    diagnostics_.currentMicrosPerSample = nextSlope;
    diagnostics_.phaseErrorCount = phaseErrorCount_;
    lastObservedSample_ = blockStartSample;
    return MapperObservationResult::Continuous;
}

std::optional<double> AudioSampleTimeMapper::TimeMicrosAt(
    double absoluteOutputSample) const noexcept {
    if (!prepared_ || !anchored_ || !std::isfinite(absoluteOutputSample)) {
        return std::nullopt;
    }
    const Segment* segment = SegmentAtSample(absoluteOutputSample);
    if (segment == nullptr) {
        return std::nullopt;
    }
    const double value = segment->startTimeMicros +
        (absoluteOutputSample - segment->startSample) * segment->microsPerSample;
    if (!std::isfinite(value) || value < 0.0) {
        return std::nullopt;
    }
    return value;
}

std::optional<std::uint64_t> AudioSampleTimeMapper::TimestampMicrosAt(
    double absoluteOutputSample) const noexcept {
    const auto value = TimeMicrosAt(absoluteOutputSample);
    if (!value.has_value()) {
        return std::nullopt;
    }
    const long double rounded = std::floor(static_cast<long double>(*value) + 0.5L);
    if (rounded < 0.0L ||
        rounded > static_cast<long double>(std::numeric_limits<std::uint64_t>::max())) {
        return std::nullopt;
    }
    return static_cast<std::uint64_t>(rounded);
}

std::optional<double> AudioSampleTimeMapper::SampleAtTimestamp(
    std::uint64_t timestampMicros) const noexcept {
    if (!prepared_ || !anchored_) {
        return std::nullopt;
    }
    double endSample = 0.0;
    const double timestamp = static_cast<double>(timestampMicros);
    const Segment* segment = SegmentAtTimestamp(timestamp, endSample);
    if (segment == nullptr) {
        return std::nullopt;
    }
    const double sample = segment->startSample +
        (timestamp - segment->startTimeMicros) / segment->microsPerSample;
    if (!std::isfinite(sample) || sample < segment->startSample || sample >= endSample) {
        return std::nullopt;
    }
    return sample;
}

const AudioSampleTimeMapper::Segment* AudioSampleTimeMapper::SegmentAtSample(
    double absoluteOutputSample) const noexcept {
    for (std::size_t logical = segmentCount_; logical > 0; --logical) {
        const Segment& segment = SegmentAtLogicalIndex(logical - 1);
        if (absoluteOutputSample >= segment.startSample) {
            return &segment;
        }
    }
    return nullptr;
}

const AudioSampleTimeMapper::Segment* AudioSampleTimeMapper::SegmentAtTimestamp(
    double timestampMicros,
    double& endSample) const noexcept {
    for (std::size_t logical = segmentCount_; logical > 0; --logical) {
        const std::size_t index = logical - 1;
        const Segment& segment = SegmentAtLogicalIndex(index);
        if (timestampMicros < segment.startTimeMicros) {
            continue;
        }
        endSample = index + 1 < segmentCount_
            ? SegmentAtLogicalIndex(index + 1).startSample
            : std::numeric_limits<double>::infinity();
        const double sample = segment.startSample +
            (timestampMicros - segment.startTimeMicros) / segment.microsPerSample;
        if (sample < endSample) {
            return &segment;
        }
    }
    return nullptr;
}

const AudioSampleTimeMapper::Segment& AudioSampleTimeMapper::SegmentAtLogicalIndex(
    std::size_t logicalIndex) const noexcept {
    return segments_[(segmentHead_ + logicalIndex) % kHistoryCapacity];
}

void AudioSampleTimeMapper::PushSegment(const Segment& segment) noexcept {
    if (segmentCount_ < kHistoryCapacity) {
        segments_[(segmentHead_ + segmentCount_) % kHistoryCapacity] = segment;
        ++segmentCount_;
        return;
    }
    segments_[segmentHead_] = segment;
    segmentHead_ = (segmentHead_ + 1) % kHistoryCapacity;
}

void AudioSampleTimeMapper::PushPhaseError(double errorMicros) noexcept {
    if (phaseErrorCount_ < kPhaseErrorWindow) {
        phaseErrors_[(phaseErrorHead_ + phaseErrorCount_) % kPhaseErrorWindow] = errorMicros;
        ++phaseErrorCount_;
        return;
    }
    phaseErrors_[phaseErrorHead_] = errorMicros;
    phaseErrorHead_ = (phaseErrorHead_ + 1) % kPhaseErrorWindow;
}

double AudioSampleTimeMapper::MedianPhaseError() const noexcept {
    std::array<double, kPhaseErrorWindow> sorted{};
    for (std::size_t index = 0; index < phaseErrorCount_; ++index) {
        sorted[index] = phaseErrors_[(phaseErrorHead_ + index) % kPhaseErrorWindow];
    }
    std::sort(sorted.begin(), sorted.begin() + static_cast<std::ptrdiff_t>(phaseErrorCount_));
    if ((phaseErrorCount_ % 2) != 0) {
        return sorted[phaseErrorCount_ / 2];
    }
    const std::size_t upper = phaseErrorCount_ / 2;
    return (sorted[upper - 1] + sorted[upper]) * 0.5;
}

void AudioSampleTimeMapper::ClearPhaseErrors() noexcept {
    phaseErrors_.fill(0.0);
    phaseErrorHead_ = 0;
    phaseErrorCount_ = 0;
    filteredPhaseErrorMicros_ = 0.0;
    diagnostics_.phaseErrorCount = 0;
    diagnostics_.latestPhaseErrorMicros = 0.0;
    diagnostics_.medianPhaseErrorMicros = 0.0;
    diagnostics_.filteredPhaseErrorMicros = 0.0;
}

bool MasterClock::Prepare(double sampleRate, std::size_t blockSize) noexcept {
    if (!IsFinitePositive(sampleRate) || blockSize == 0) {
        return false;
    }

    const double blockDurationMicros =
        static_cast<double>(blockSize) * 1'000'000.0 / sampleRate;
    const double latency = std::max(2.0 * blockDurationMicros, 5000.0);
    if (!std::isfinite(latency) ||
        latency > static_cast<double>(std::numeric_limits<std::uint64_t>::max())) {
        return false;
    }
    const auto outputLatencyMicros = static_cast<std::uint64_t>(std::ceil(latency));
    const double quarterNotesPerSample = manualBpm_ / (60.0 * sampleRate);
    if (!IsFinitePositive(quarterNotesPerSample)) {
        return false;
    }

    AudioSampleTimeMapper mapper;
    if (!mapper.Prepare(sampleRate, outputLatencyMicros)) {
        return false;
    }

    sampleRate_ = sampleRate;
    blockSize_ = blockSize;
    outputLatencyMicros_ = outputLatencyMicros;
    activeBpm_ = manualBpm_;
    pendingQuarterNotesPerSample_ = quarterNotesPerSample;
    nextLifetimeQuarterNotes_ = 0.0;
    nextTransportQuarterNotes_ = 0.0;
    transportState_ = ClockTransportState::Stopped;
    transportEpoch_ = 0;
    planGeneration_ = 1;
    expectedNextSample_ = 0;
    planHistoryHead_ = 0;
    planHistoryCount_ = 0;
    currentPlan_ = ClockBlockPlan{};
    hasCurrentPlan_ = false;
    timeMapper_ = mapper;
    ignoredInputCount_ = 0;
    droppedOutputCount_ = 0;
    prepared_ = true;
    acquisitionState_ = syncConfig_.receiveClock
        ? ClockAcquisitionState::Acquiring
        : ClockAcquisitionState::Internal;
    source_ = syncConfig_.receiveClock ? ClockSource::ExternalMidi : ClockSource::Internal;
    return true;
}

bool MasterClock::SetTempoBpm(double bpm) noexcept {
    if (!IsFinitePositive(bpm) || syncConfig_.receiveClock) {
        return false;
    }
    double nextQuarterNotesPerSample = pendingQuarterNotesPerSample_;
    if (prepared_) {
        nextQuarterNotesPerSample = bpm / (60.0 * sampleRate_);
        if (!IsFinitePositive(nextQuarterNotesPerSample)) {
            return false;
        }
    }
    manualBpm_ = bpm;
    activeBpm_ = bpm;
    if (prepared_) {
        pendingQuarterNotesPerSample_ = nextQuarterNotesPerSample;
    }
    return true;
}

double MasterClock::LifetimeQuarterNotes() const noexcept {
    return hasCurrentPlan_ ? currentPlan_.LifetimeStartQuarterNotes() : nextLifetimeQuarterNotes_;
}

double MasterClock::TransportQuarterNotes() const noexcept {
    return hasCurrentPlan_ ? currentPlan_.TransportStartQuarterNotes() : 0.0;
}

bool MasterClock::ApplySyncConfig(const SyncConfig& config) noexcept {
    if (!config.IsValid()) {
        return false;
    }
    const bool receiveChanged = config.receiveClock != syncConfig_.receiveClock;
    double restoredQuarterNotesPerSample = pendingQuarterNotesPerSample_;
    if (receiveChanged && !config.receiveClock && prepared_) {
        restoredQuarterNotesPerSample = manualBpm_ / (60.0 * sampleRate_);
        if (!IsFinitePositive(restoredQuarterNotesPerSample)) {
            return false;
        }
    }
    syncConfig_ = config;
    if (receiveChanged && syncConfig_.receiveClock) {
        acquisitionState_ = ClockAcquisitionState::Acquiring;
        source_ = ClockSource::ExternalMidi;
    } else if (receiveChanged) {
        acquisitionState_ = ClockAcquisitionState::Internal;
        source_ = ClockSource::Internal;
        activeBpm_ = manualBpm_;
        if (prepared_) {
            pendingQuarterNotesPerSample_ = restoredQuarterNotesPerSample;
        }
    }
    return true;
}

ClockDiagnostics MasterClock::DiagnosticsSnapshot() const noexcept {
    const auto mapperDiagnostics = timeMapper_.DiagnosticsSnapshot();
    return ClockDiagnostics{
        .acquisition = acquisitionState_,
        .source = source_,
        .hasActiveExternalSource = false,
        .activeExternalSourceSlot = 0,
        .currentBpm = activeBpm_,
        .outputLatencyMicros = outputLatencyMicros_,
        .ignoredInputCount = ignoredInputCount_,
        .mapperIgnoredObservationCount = mapperDiagnostics.ignoredObservationCount,
        .lateEventCount = mapperDiagnostics.lateEventCount,
        .droppedOutputCount = droppedOutputCount_,
        .mapperDiscontinuityCount = mapperDiagnostics.discontinuityCount,
        .mapperGeneration = mapperDiagnostics.generation,
    };
}

const ClockBlockPlan* MasterClock::CommitBlock(
    std::uint64_t blockStartSample,
    std::size_t frameCount,
    std::uint64_t callbackTimestampMicros) noexcept {
    if (!prepared_ || frameCount == 0 ||
        frameCount > std::numeric_limits<std::uint64_t>::max() - blockStartSample ||
        (hasCurrentPlan_ && blockStartSample != expectedNextSample_) ||
        !IsFinitePositive(pendingQuarterNotesPerSample_)) {
        return nullptr;
    }
    const std::uint64_t endSample = blockStartSample + static_cast<std::uint64_t>(frameCount);
    const MapperObservationResult observation =
        timeMapper_.ObserveBlock(blockStartSample, callbackTimestampMicros);
    if (observation == MapperObservationResult::Rejected) {
        return nullptr;
    }

    const ClockPlanDescriptor descriptor{
        .startSample = blockStartSample,
        .endSample = endSample,
        .lifetimeStartQuarterNotes = nextLifetimeQuarterNotes_,
        .transportStartQuarterNotes = nextTransportQuarterNotes_,
        .quarterNotesPerSample = pendingQuarterNotesPerSample_,
        .transportState = transportState_,
        .transportEpoch = transportEpoch_,
        .generation = planGeneration_,
    };
    currentPlan_ = ClockBlockPlan{descriptor};
    hasCurrentPlan_ = true;
    PushPlan(descriptor);
    nextLifetimeQuarterNotes_ = descriptor.LifetimeEndQuarterNotes();
    nextTransportQuarterNotes_ = descriptor.TransportEndQuarterNotes();
    expectedNextSample_ = endSample;
    return &currentPlan_;
}

std::optional<ClockBlockPlan> MasterClock::PlanAtSample(
    double absoluteOutputSample) const noexcept {
    if (!std::isfinite(absoluteOutputSample)) {
        return std::nullopt;
    }
    for (std::size_t logical = planHistoryCount_; logical > 0; --logical) {
        const ClockPlanDescriptor& descriptor = PlanAtLogicalIndex(logical - 1);
        if (descriptor.Contains(absoluteOutputSample)) {
            return ClockBlockPlan{descriptor};
        }
    }
    return std::nullopt;
}

std::optional<ClockTimePoint> MasterClock::TimeAtSample(
    double absoluteOutputSample) const noexcept {
    const auto plan = PlanAtSample(absoluteOutputSample);
    if (!plan.has_value()) {
        return std::nullopt;
    }
    return ClockTimePoint{
        .samplePosition = absoluteOutputSample,
        .lifetimeQuarterNotes = plan->LifetimeQuarterNotesAt(absoluteOutputSample),
        .transportQuarterNotes = plan->TransportQuarterNotesAt(absoluteOutputSample),
        .transportState = plan->TransportState(),
        .transportEpoch = plan->TransportEpoch(),
    };
}

std::optional<ClockTimePoint> MasterClock::TimeAtTimestamp(
    std::uint64_t timestampMicros) const noexcept {
    const auto sample = timeMapper_.SampleAtTimestamp(timestampMicros);
    if (!sample.has_value()) {
        return std::nullopt;
    }
    return TimeAtSample(*sample);
}

const ClockPlanDescriptor& MasterClock::PlanAtLogicalIndex(
    std::size_t logicalIndex) const noexcept {
    return planHistory_[(planHistoryHead_ + logicalIndex) % kPlanHistoryCapacity];
}

void MasterClock::PushPlan(const ClockPlanDescriptor& descriptor) noexcept {
    if (planHistoryCount_ < kPlanHistoryCapacity) {
        planHistory_[(planHistoryHead_ + planHistoryCount_) % kPlanHistoryCapacity] = descriptor;
        ++planHistoryCount_;
        return;
    }
    planHistory_[planHistoryHead_] = descriptor;
    planHistoryHead_ = (planHistoryHead_ + 1) % kPlanHistoryCapacity;
}

} // namespace synth
