#pragma once

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <limits>
#include <stdexcept>
#include <vector>

namespace synth {

class ScopeWriter;

class ScopeWriterHolder {
public:
    ScopeWriterHolder() = default;
    ScopeWriterHolder(ScopeWriter* writer, std::size_t baseChan, std::size_t numChans)
        : writer_(writer), baseChan_(baseChan), numChans_(numChans) {}

    explicit operator bool() const { return writer_ != nullptr; }
    ScopeWriter* Writer() const { return writer_; }
    std::size_t BaseChan() const { return baseChan_; }
    std::size_t NumChans() const { return numChans_; }
    std::size_t FlatChan(std::size_t relativeChan = 0) const;

    void Write(float value) { Write(0, value); }
    void Write(std::size_t relativeChan, float value);
    void WriteAt(std::size_t relativeChan, std::size_t uBlockIndex, float value);
    void RecordStart(std::size_t relativeChan = 0, std::size_t uBlockIndex = 0);
    void RecordEnd(std::size_t relativeChan = 0, std::size_t uBlockIndex = 0);

private:
    ScopeWriter* writer_ = nullptr;
    std::size_t baseChan_ = 0;
    std::size_t numChans_ = 0;
};

class ScopeReader {
public:
    ScopeReader() = default;
    ScopeReader(const ScopeWriter* writer, std::size_t channel, std::size_t numXSamples, std::size_t numCycles = 1);

    bool Empty() const { return empty_; }
    float Get(std::size_t xSample) const;
    std::size_t TransferXSample() const { return transferXSample_; }
    std::size_t NumXSamples() const { return numXSamples_; }

private:
    const ScopeWriter* writer_ = nullptr;
    std::size_t channel_ = 0;
    std::size_t numXSamples_ = 0;
    std::size_t startIndex_ = 0;
    std::size_t endIndex_ = 0;
    std::size_t postTransferIndex_ = 0;
    std::size_t transferXSample_ = 0;
    bool hasPostTransfer_ = false;
    bool empty_ = true;
};

class ScopeReaderFactory {
public:
    ScopeReaderFactory() = default;
    ScopeReaderFactory(const ScopeWriter* writer, std::size_t channel, std::size_t numXSamples, std::size_t numCycles = 1)
        : writer_(writer), channel_(channel), numXSamples_(numXSamples), numCycles_(numCycles) {}

    ScopeReader Create() const { return ScopeReader(writer_, channel_, numXSamples_, numCycles_); }

private:
    const ScopeWriter* writer_ = nullptr;
    std::size_t channel_ = 0;
    std::size_t numXSamples_ = 0;
    std::size_t numCycles_ = 1;
};

class ScopeWriter {
public:
    static constexpr std::size_t kNumMarkerIndices = 256;

    explicit ScopeWriter(std::size_t maxChannels = 16, std::size_t maxFrames = 4096)
        : maxChannels_(maxChannels),
          maxFrames_(maxFrames),
          buffer_(maxChannels * maxFrames, 0.0f),
          startMarkers_(maxChannels, std::vector<std::size_t>(kNumMarkerIndices, 0)),
          endMarkers_(maxChannels, std::vector<std::size_t>(kNumMarkerIndices, std::numeric_limits<std::size_t>::max())),
          markerWriteIndices_(maxChannels) {}

    ScopeWriterHolder ReserveChans(std::size_t numChans) {
        if (numChans == 0 || reservedChannels_ + numChans > maxChannels_) {
            throw std::out_of_range("scope channel reservation exceeds capacity");
        }
        const std::size_t base = reservedChannels_;
        reservedChannels_ += numChans;
        return ScopeWriterHolder(this, base, numChans);
    }

    std::size_t ReservedChannels() const { return reservedChannels_; }
    std::size_t MaxChannels() const { return maxChannels_; }
    std::size_t MaxFrames() const { return maxFrames_; }
    std::size_t CurrentIndex() const { return index_; }
    std::size_t PublishedIndex() const { return publishedIndex_.load(); }

    void Write(std::size_t channel, float value) {
        WriteAt(channel, 0, value);
    }

    void WriteAt(std::size_t channel, std::size_t uBlockIndex, float value) {
        CheckChannel(channel);
        buffer_[PhysicalIndex(channel, index_ + uBlockIndex)] = value;
    }

    float ReadSample(std::size_t channel, std::size_t index) const {
        CheckChannel(channel);
        return buffer_[PhysicalIndex(channel, index)];
    }

    float Read(std::size_t channel, double index) const {
        const auto lower = static_cast<std::size_t>(std::floor(index));
        const double frac = index - std::floor(index);
        const float a = ReadSample(channel, lower);
        const float b = ReadSample(channel, lower + 1);
        return static_cast<float>(static_cast<double>(a) * (1.0 - frac) + static_cast<double>(b) * frac);
    }

    void AdvanceIndex(std::size_t amount = 1) {
        index_ += amount;
    }

    void Publish() {
        publishedIndex_.store(index_);
    }

    void RecordStart(std::size_t channel, std::size_t uBlockIndex = 0) {
        CheckChannel(channel);
        const std::size_t count = markerWriteIndices_[channel].load();
        const std::size_t markerIndex = count % kNumMarkerIndices;
        startMarkers_[channel][markerIndex] = index_ + uBlockIndex;
        endMarkers_[channel][markerIndex] = std::numeric_limits<std::size_t>::max();
        markerWriteIndices_[channel].store(count + 1);
    }

    void RecordEnd(std::size_t channel, std::size_t uBlockIndex = 0) {
        CheckChannel(channel);
        const std::size_t count = markerWriteIndices_[channel].load();
        if (count == 0) {
            return;
        }
        endMarkers_[channel][(count - 1) % kNumMarkerIndices] = index_ + uBlockIndex;
    }

    bool LatestStart(std::size_t channel, std::size_t& start) const {
        CheckChannel(channel);
        const std::size_t markerCount = markerWriteIndices_[channel].load();
        if (markerCount == 0) {
            return false;
        }
        start = startMarkers_[channel][(markerCount - 1) % kNumMarkerIndices];
        return true;
    }

    bool PreviousStart(std::size_t channel, std::size_t& start) const {
        CheckChannel(channel);
        const std::size_t markerCount = markerWriteIndices_[channel].load();
        if (markerCount < 2) {
            return false;
        }
        start = startMarkers_[channel][(markerCount - 2) % kNumMarkerIndices];
        return true;
    }

    bool LatestEnd(std::size_t channel, std::size_t& end) const {
        CheckChannel(channel);
        const std::size_t markerCount = markerWriteIndices_[channel].load();
        if (markerCount == 0) {
            return false;
        }
        end = endMarkers_[channel][(markerCount - 1) % kNumMarkerIndices];
        return end != std::numeric_limits<std::size_t>::max();
    }

private:
    friend class ScopeWriterHolder;
    friend class ScopeReader;

    void CheckChannel(std::size_t channel) const {
        if (channel >= maxChannels_) {
            throw std::out_of_range("scope channel out of range");
        }
    }

    std::size_t PhysicalIndex(std::size_t channel, std::size_t index) const {
        return (index % maxFrames_) * maxChannels_ + channel;
    }

    std::size_t maxChannels_ = 0;
    std::size_t maxFrames_ = 0;
    std::size_t reservedChannels_ = 0;
    std::size_t index_ = 0;
    std::atomic<std::size_t> publishedIndex_{0};
    std::vector<float> buffer_;
    std::vector<std::vector<std::size_t>> startMarkers_;
    std::vector<std::vector<std::size_t>> endMarkers_;
    std::vector<std::atomic<std::size_t>> markerWriteIndices_;
};

inline std::size_t ScopeWriterHolder::FlatChan(std::size_t relativeChan) const {
    if (!writer_ || relativeChan >= numChans_) {
        throw std::out_of_range("relative scope channel out of range");
    }
    return baseChan_ + relativeChan;
}

inline void ScopeWriterHolder::Write(std::size_t relativeChan, float value) {
    if (writer_) {
        writer_->Write(FlatChan(relativeChan), value);
    }
}

inline void ScopeWriterHolder::WriteAt(std::size_t relativeChan, std::size_t uBlockIndex, float value) {
    if (writer_) {
        writer_->WriteAt(FlatChan(relativeChan), uBlockIndex, value);
    }
}

inline void ScopeWriterHolder::RecordStart(std::size_t relativeChan, std::size_t uBlockIndex) {
    if (writer_) {
        writer_->RecordStart(FlatChan(relativeChan), uBlockIndex);
    }
}

inline void ScopeWriterHolder::RecordEnd(std::size_t relativeChan, std::size_t uBlockIndex) {
    if (writer_) {
        writer_->RecordEnd(FlatChan(relativeChan), uBlockIndex);
    }
}

inline ScopeReader::ScopeReader(const ScopeWriter* writer, std::size_t channel, std::size_t numXSamples, std::size_t numCycles)
    : writer_(writer), channel_(channel), numXSamples_(numXSamples) {
    if (!writer_ || numXSamples_ == 0) {
        return;
    }

    std::size_t latestStart = 0;
    std::size_t previousStart = 0;
    if (!writer_->LatestStart(channel_, latestStart)) {
        const std::size_t publishedIndex = writer_->PublishedIndex();
        endIndex_ = publishedIndex > 0 ? publishedIndex - 1 : 0;
        startIndex_ = endIndex_ > numXSamples_ ? endIndex_ - numXSamples_ : 0;
        transferXSample_ = numXSamples_;
        hasPostTransfer_ = false;
        empty_ = endIndex_ <= startIndex_;
        return;
    }

    startIndex_ = latestStart;
    std::size_t latestEnd = 0;
    if (writer_->LatestEnd(channel_, latestEnd) && latestEnd > latestStart) {
        endIndex_ = latestEnd;
    } else {
        const std::size_t publishedIndex = writer_->PublishedIndex();
        endIndex_ = publishedIndex > 0 ? publishedIndex - 1 : 0;
    }

    if (writer_->PreviousStart(channel_, previousStart) && previousStart < latestStart) {
        const std::size_t cycleLength = std::max<std::size_t>(1, latestStart - previousStart);
        const std::size_t elapsed = endIndex_ > latestStart ? endIndex_ - latestStart : 0;
        transferXSample_ = std::min(numXSamples_, elapsed * numXSamples_ / (cycleLength * std::max<std::size_t>(1, numCycles)));
        postTransferIndex_ = previousStart + std::min(elapsed, cycleLength);
        hasPostTransfer_ = transferXSample_ < numXSamples_;
    } else {
        transferXSample_ = numXSamples_;
        hasPostTransfer_ = false;
    }
    empty_ = endIndex_ <= startIndex_;
}

inline float ScopeReader::Get(std::size_t xSample) const {
    if (empty_ || !writer_ || numXSamples_ == 0) {
        return 0.0f;
    }
    const std::size_t clampedSample = std::min(xSample, numXSamples_ - 1);
    double readIndex = static_cast<double>(startIndex_);
    if (!hasPostTransfer_ || clampedSample < transferXSample_) {
        const double denominator = static_cast<double>(std::max<std::size_t>(1, transferXSample_));
        const double wayThrough = static_cast<double>(clampedSample) / denominator;
        readIndex = static_cast<double>(startIndex_) + wayThrough * static_cast<double>(endIndex_ - startIndex_);
    } else {
        const double denominator = static_cast<double>(std::max<std::size_t>(1, numXSamples_ - transferXSample_));
        const double wayThrough = static_cast<double>(clampedSample - transferXSample_) / denominator;
        readIndex = static_cast<double>(postTransferIndex_)
            + wayThrough * static_cast<double>(startIndex_ - postTransferIndex_);
    }
    return writer_->Read(channel_, readIndex);
}

} // namespace synth
