#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace synth {

using ParameterId = std::uint32_t;
using PhysicalEncoderId = std::uint32_t;
using PageOrdinal = std::uint32_t;

struct Color {
    std::uint8_t r = 0;
    std::uint8_t g = 0;
    std::uint8_t b = 0;
};

enum class RangeKind {
    Unipolar,
    Bipolar,
};

float ClampToRange(float value, RangeKind range);

enum class Status {
    Ok,
    InvalidConfig,
    OutOfRange,
    Exhausted,
};

struct SceneState {
    std::size_t leftScene = 0;
    std::size_t rightScene = 0;
    float blend = 0.0f;
};

struct PageDescriptor {
    PageOrdinal ordinal = 0;
    std::string name;
};

class Parameter;

struct Page {
    PageOrdinal ordinal = 0;
    std::string name;
    std::vector<Parameter*> parameters;
};

struct ParameterGroupConfig {
    std::size_t numVoices = 0;
    std::size_t numModulators = 0;
    std::size_t numGestures = 0;
    std::size_t numScenes = 0;
    std::size_t maxParameters = 0;
    float processLiteAlpha = 1.0f;

    bool IsValid() const;
};

struct ModulatorMetadata {
    std::string name;
    Color color;
    bool connected = false;
};

struct GestureMetadata {
    std::string name;
    Color color;
};

struct ParameterConfig {
    std::string name;
    std::string shortName;
    float defaultValue = 0.0f;
    RangeKind range = RangeKind::Unipolar;
};

class Modulators {
public:
    explicit Modulators(std::size_t voices = 0, std::size_t modulators = 0);

    float& Value(std::size_t voiceIx, std::size_t modIx);
    float Value(std::size_t voiceIx, std::size_t modIx) const;
    float Apply(std::size_t voiceIx, std::span<const float> depths) const;

    std::size_t NumVoices() const { return numVoices_; }
    std::size_t NumModulators() const { return numModulators_; }

    ModulatorMetadata& Metadata(std::size_t modIx);
    const ModulatorMetadata& Metadata(std::size_t modIx) const;
    std::span<ModulatorMetadata> Metadata() { return metadata_; }
    std::span<const ModulatorMetadata> Metadata() const { return metadata_; }

private:
    std::size_t Index(std::size_t voiceIx, std::size_t modIx) const;

    std::size_t numVoices_ = 0;
    std::size_t numModulators_ = 0;
    std::vector<float> values_;
    std::vector<ModulatorMetadata> metadata_;
};

class Gestures {
public:
    explicit Gestures(std::size_t gestures = 0);

    float& Value(std::size_t gestureIx);
    float Value(std::size_t gestureIx) const;
    void Select(std::size_t gestureIx, bool selected);
    bool Selected(std::size_t gestureIx) const;
    void ClearSelection();

    std::size_t NumGestures() const { return values_.size(); }

    GestureMetadata& Metadata(std::size_t gestureIx);
    const GestureMetadata& Metadata(std::size_t gestureIx) const;
    std::span<GestureMetadata> Metadata() { return metadata_; }
    std::span<const GestureMetadata> Metadata() const { return metadata_; }

private:
    void CheckIndex(std::size_t gestureIx) const;

    std::vector<float> values_;
    std::vector<bool> selected_;
    std::vector<GestureMetadata> metadata_;
};

class ParameterGroup {
public:
    explicit ParameterGroup(ParameterGroupConfig config);
    ~ParameterGroup();

    const ParameterGroupConfig& Config() const { return config_; }
    Modulators& GetModulators() { return modulators_; }
    Gestures& GetGestures() { return gestures_; }
    const Modulators& GetModulators() const { return modulators_; }
    const Gestures& GetGestures() const { return gestures_; }

    bool CanAllocate() const;
    std::size_t ParameterCount() const { return parameterCount_; }
    void SelectGesture(std::size_t gestureIx);
    void DeselectGesture(std::size_t gestureIx);
    bool GestureSelected(std::size_t gestureIx) const;
    void SetGestureValue(std::size_t gestureIx, float value);
    float GestureValue(std::size_t gestureIx) const;
    void ClearGestureActiveFlagsForActiveSceneSelection(const SceneState& scene, std::size_t gestureIx);

private:
    friend class Parameter;
    friend class ParameterManager;

    // Groups own parameter objects and all same-shaped per-parameter arenas.
    // Parameter instances hold spans into these arenas; callers must not move a
    // group after handing out Parameter references.
    ParameterGroupConfig config_;
    Modulators modulators_;
    Gestures gestures_;
    std::size_t parameterCount_ = 0;
    std::vector<std::unique_ptr<Parameter>> parameters_;
    std::vector<float> currentCenterScaleArena_;
    std::vector<float> targetCenterScaleArena_;
    std::vector<float> currentDepthArena_;
    std::vector<float> targetDepthArena_;
    std::vector<Parameter*> modulationDepthArena_;
    std::vector<float> sceneCenterArena_;
    std::vector<float> gestureValueArena_;
    std::vector<std::uint8_t> gestureActiveArena_;
};

class Parameter {
public:
    Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config, std::size_t slotIx);

    ParameterId Id() const { return id_; }
    const std::string& Name() const { return config_.name; }
    const std::string& ShortName() const { return config_.shortName; }
    RangeKind Range() const { return config_.range; }
    ParameterGroup& Group() { return group_; }
    const ParameterGroup& Group() const { return group_; }

    float Get(std::size_t voiceIx) const;
    void Compute(const SceneState& scene);
    // Audio-rate helper: no graph traversal or allocation.
    void ProcessLite();
    void HandleIncDec(const SceneState& scene, float delta);
    void RevertToDefault(const SceneState& scene);

    bool AssignModulationDepth(std::size_t modIx, Parameter* parameter);
    void ClearModulationDepths();
    Parameter* ModulationDepthParameter(std::size_t modIx) const;

    float& SceneCenter(std::size_t sceneIx);
    float SceneCenter(std::size_t sceneIx) const;
    float& GestureValue(std::size_t sceneIx, std::size_t gestureIx);
    float GestureValue(std::size_t sceneIx, std::size_t gestureIx) const;
    void SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active);
    bool GestureActive(std::size_t sceneIx, std::size_t gestureIx) const;

    std::span<float> CurrentDepths(std::size_t voiceIx);
    std::span<const float> CurrentDepths(std::size_t voiceIx) const;
    std::span<float> TargetDepths(std::size_t voiceIx);
    std::span<const float> TargetDepths(std::size_t voiceIx) const;

    float CurrentCenter() const { return currentCenter_; }
    float TargetCenter() const { return targetCenter_; }
    float CurrentCenterScale(std::size_t voiceIx) const;
    float TargetCenterScale(std::size_t voiceIx) const;
    std::size_t RecursionDepth() const { return recursionDepth_; }

private:
    std::size_t VoiceModIndex(std::size_t voiceIx, std::size_t modIx) const;
    std::size_t SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const;
    void ValidateSceneEndpoints(const SceneState& scene) const;
    float EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const;
    void ActivateGestureForScene(std::size_t sceneIx, std::size_t gestureIx);
    void ResetSceneToDefault(std::size_t sceneIx, float defaultValue);
    float ComputeRawCenter(const SceneState& scene) const;
    void ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth);
    bool WouldCreateCycle(const Parameter* candidate) const;

    ParameterId id_;
    ParameterGroup& group_;
    ParameterConfig config_;
    std::size_t slotIx_ = 0;
    std::size_t recursionDepth_ = 0;
    float currentCenter_ = 0.0f;
    float targetCenter_ = 0.0f;
    std::span<float> currentCenterScales_;
    std::span<float> targetCenterScales_;
    std::span<float> currentDepths_;
    std::span<float> targetDepths_;
    std::span<Parameter*> modulationDepths_;
    std::span<float> sceneCenters_;
    std::span<float> gestureValues_;
    std::span<std::uint8_t> gestureActive_;
};

class ParameterManager;

class Bank {
public:
    explicit Bank(ParameterManager* manager = nullptr);

    // Banks do not own parameters; they map physical controls to manager-owned
    // parameters and transient modulation-depth views.
    void AddMapping(PhysicalEncoderId encoderId, Parameter& parameter);
    bool OwnsVisible(PhysicalEncoderId encoderId) const;
    void HandlePress(PhysicalEncoderId encoderId);
    void HandleShiftPress(PhysicalEncoderId encoderId, const SceneState& scene);
    void HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, float delta);
    void Deselect();
    bool ShowingModulation() const;

    std::size_t VisibleMappingCount() const;
    Parameter* VisibleParameter(PhysicalEncoderId encoderId) const;
    Parameter* SelectedParameter() const { return selected_; }
    Parameter* ReturnParameter() const;

private:
    struct Cell {
        PhysicalEncoderId encoderId = 0;
        Parameter* parameter = nullptr;
        bool returnCell = false;
    };

    Cell* FindVisibleCell(PhysicalEncoderId encoderId);
    const Cell* FindVisibleCell(PhysicalEncoderId encoderId) const;
    Parameter* EnsureModulationDepthParameter(Parameter& parameter, std::size_t modIx);
    void OpenModulationView(Parameter& parameter);

    ParameterManager* manager_ = nullptr;
    std::vector<Cell> topLevel_;
    std::vector<Cell> visible_;
    Parameter* selected_ = nullptr;
};

class BankSlot {
public:
    void SelectBank(Bank* bank);
    bool Owns(PhysicalEncoderId encoderId) const;
    void AddPhysicalEncoder(PhysicalEncoderId encoderId);
    void HandlePress(PhysicalEncoderId encoderId);
    void HandleShiftPress(PhysicalEncoderId encoderId, const SceneState& scene);
    void HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, float delta);
    Bank* SelectedBank() const { return selectedBank_; }

private:
    bool OwnsPhysicalEncoder(PhysicalEncoderId encoderId) const;

    std::vector<PhysicalEncoderId> physicalEncoders_;
    Bank* selectedBank_ = nullptr;
};

class ParameterManager {
public:
    ParameterManager() = default;

    // The manager owns groups, pages, banks, and slots, and assigns global
    // parameter IDs. Parameter lifetime is tied to its owning group.
    ParameterGroup& CreateGroup(ParameterGroupConfig config);
    Parameter& CreateParameter(ParameterGroup& group, ParameterConfig config);
    ParameterId NextParameterId();

    SceneState& Scene() { return scene_; }
    const SceneState& Scene() const { return scene_; }

    std::size_t NumGroups() const { return groups_.size(); }

    Page& CreatePage(std::string name);
    bool AssignParameterToPage(PageOrdinal ordinal, Parameter& parameter);
    bool SelectActivePage(PageOrdinal ordinal);
    void SetActivePage(PageOrdinal ordinal);
    Page* ActivePage();
    const Page* ActivePage() const;
    std::optional<PageOrdinal> ActivePageOrdinal() const;

    Bank& CreateBank();
    BankSlot& CreateBankSlot();
    void HandlePress(PhysicalEncoderId encoderId);
    void HandleShiftPress(PhysicalEncoderId encoderId);
    void HandleTick(PhysicalEncoderId encoderId, float delta);

    void SelectGesture(ParameterGroup& group, std::size_t gestureIx);
    void DeselectGesture(ParameterGroup& group, std::size_t gestureIx);
    bool GestureSelected(const ParameterGroup& group, std::size_t gestureIx) const;
    void SetGestureValue(ParameterGroup& group, std::size_t gestureIx, float value);
    float GestureValue(const ParameterGroup& group, std::size_t gestureIx) const;
    void ClearGestureActiveFlagsForActiveSceneSelection(ParameterGroup& group, std::size_t gestureIx);

private:
    Page* FindPage(PageOrdinal ordinal);
    const Page* FindPage(PageOrdinal ordinal) const;

    ParameterId nextId_ = 1;
    SceneState scene_;
    std::vector<std::unique_ptr<ParameterGroup>> groups_;
    std::vector<std::unique_ptr<Page>> pages_;
    std::optional<PageOrdinal> activePageOrdinal_;
    std::vector<std::unique_ptr<Bank>> banks_;
    std::vector<std::unique_ptr<BankSlot>> slots_;
};

} // namespace synth
