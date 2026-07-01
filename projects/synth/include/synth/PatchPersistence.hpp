#pragma once

#include "synth/MidiController.hpp"

#include <atomic>
#include <chrono>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace synth {

struct MidiEndpointState {
    std::string inputIdentifier;
    std::string outputIdentifier;
};

JSON ToJSON(JsonArena& arena, const MidiEndpointState& endpoints);
bool FromJSON(JSON json, MidiEndpointState& endpoints);

JSON BuildPatchJSON(JsonArena& arena, std::string_view patchName,
                    const ParameterManager& manager,
                    const MidiControllerProfileConfig& midiProfile,
                    const MidiEndpointState& endpoints = {});
bool LoadPatchJSON(JSON root, ParameterManager& manager,
                   MidiControllerProfileConfig& midiProfile,
                   MidiEndpointState* endpoints = nullptr);
bool ValidatePatchJSON(JSON root);

std::string TimestampPatchFilename(std::chrono::system_clock::time_point now);
std::filesystem::path PatchDirectory(const std::filesystem::path& patchesRoot, std::string_view patchName);
std::filesystem::path SavePatchVersion(const std::filesystem::path& patchesRoot, std::string_view patchName,
                                       const std::string& jsonText,
                                       std::chrono::system_clock::time_point now = std::chrono::system_clock::now());
std::filesystem::path SavePatchVersionInDirectory(
    const std::filesystem::path& patchDir, const std::string& jsonText,
    std::chrono::system_clock::time_point now = std::chrono::system_clock::now());
std::optional<std::filesystem::path> LatestPatchVersion(const std::filesystem::path& patchDir);
std::string LoadPatchVersionText(const std::filesystem::path& versionFile);

struct JsonDocument {
    std::shared_ptr<JsonArena> arena;
    JSON root;

    bool IsNull() const { return root.IsNull(); }
};

struct PatchMessageIn {
    enum class Type {
        LoadFromJSON,
        RevertAllToDefault,
        SerializeToJSON,
    };

    Type type = Type::RevertAllToDefault;
    std::uint64_t requestId = 0;
    std::string patchName;
    JsonDocument document;

    static PatchMessageIn LoadFromJSON(JsonDocument document);
    static PatchMessageIn RevertAllToDefault();
    static PatchMessageIn SerializeToJSON(std::uint64_t requestId, std::string patchName);
};

struct MessageOut {
    enum class Type {
        SerializedJSON,
    };

    Type type = Type::SerializedJSON;
    std::uint64_t requestId = 0;
    JsonDocument document;

    static MessageOut SerializedJSON(std::uint64_t requestId, JsonDocument document);
};

class PatchMessageInBus {
public:
    explicit PatchMessageInBus(std::size_t capacity = 64);

    bool Push(const PatchMessageIn& message);
    bool Pop(PatchMessageIn& message);
    std::size_t Size() const { return size_.load(std::memory_order_acquire); }
    std::size_t Capacity() const { return queue_.size(); }

private:
    std::vector<PatchMessageIn> queue_;
    std::atomic<std::size_t> head_{0};
    std::atomic<std::size_t> tail_{0};
    std::atomic<std::size_t> size_{0};
};

class MessageOutBus {
public:
    explicit MessageOutBus(std::size_t capacity = 64);

    bool Push(const MessageOut& message);
    bool Pop(MessageOut& message);
    std::size_t Size() const { return size_.load(std::memory_order_acquire); }
    std::size_t Capacity() const { return queue_.size(); }

private:
    std::vector<MessageOut> queue_;
    std::atomic<std::size_t> head_{0};
    std::atomic<std::size_t> tail_{0};
    std::atomic<std::size_t> size_{0};
};

struct PatchSerializationContext {
    std::size_t initialArenaCapacity = 256 * 1024;
    std::size_t maxArenaCapacity = 8 * 1024 * 1024;
};

enum class PatchApplyStatus {
    Applied,
    Reverted,
    Serialized,
    InvalidJSON,
    OutputQueueFull,
    ArenaExhausted,
};

PatchApplyStatus ApplyPatchMessage(
    const PatchMessageIn& message, ParameterManager& manager,
    MidiControllerProfileConfig& midiProfile, const MidiControllerProfileConfig& defaultMidiProfile,
    MidiEndpointState& endpoints, const MidiEndpointState& defaultEndpoints,
    MessageOutBus& outputBus, PatchSerializationContext context = {});

enum class PatchCommandStatus {
    Ok,
    Pending,
    NoCompletion,
    Written,
    NeedsSaveAsPath,
    Busy,
    AlreadyExists,
    NotFound,
    InvalidPatch,
    QueueFull,
    IOError,
};

struct PatchCommandResult {
    PatchCommandStatus status = PatchCommandStatus::Ok;
    std::uint64_t requestId = 0;
    std::filesystem::path path;
};

class PatchManager {
public:
    explicit PatchManager(PatchMessageInBus* inputBus = nullptr, MessageOutBus* outputBus = nullptr,
                          std::size_t initialArenaCapacity = 256 * 1024);

    void SetBuses(PatchMessageInBus* inputBus, MessageOutBus* outputBus);
    const std::optional<std::filesystem::path>& CurrentPatchDirectory() const { return currentPatchDirectory_; }
    bool HasPendingSave() const { return pendingSave_.has_value(); }

    PatchCommandResult NewPatch();
    PatchCommandResult SavePatch();
    PatchCommandResult SavePatchAs(const std::filesystem::path& patchDir);
    PatchCommandResult LoadPatch(const std::filesystem::path& path);
    PatchCommandResult RevertPatch();
    PatchCommandResult ProcessResponses(std::chrono::system_clock::time_point now = std::chrono::system_clock::now());

private:
    struct PendingSave {
        enum class Kind {
            Save,
            SaveAs,
        };
        Kind kind = Kind::Save;
        std::uint64_t requestId = 0;
        std::filesystem::path patchDir;
    };

    PatchCommandResult DispatchSerialize(PendingSave::Kind kind, const std::filesystem::path& patchDir);
    PatchCommandResult LoadPatchVersion(const std::filesystem::path& versionFile,
                                        const std::filesystem::path& currentPatchDirectory);
    JsonDocument ParsePatchText(const std::string& text) const;
    std::string PatchNameForDirectory(const std::filesystem::path& patchDir) const;

    PatchMessageInBus* inputBus_ = nullptr;
    MessageOutBus* outputBus_ = nullptr;
    std::optional<std::filesystem::path> currentPatchDirectory_;
    std::optional<PendingSave> pendingSave_;
    std::uint64_t nextRequestId_ = 1;
    std::size_t initialArenaCapacity_ = 256 * 1024;
};

} // namespace synth
