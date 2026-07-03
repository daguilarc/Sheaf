#pragma once

#include <cstddef>
#include <cstdint>
#include <atomic>
#include <functional>
#include <memory>
#include <optional>
#include <random>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "synth/Json.hpp"

namespace synth {

using ParameterId = std::uint32_t;
using PhysicalEncoderId = std::uint32_t;
using PageOrdinal = std::uint32_t;

struct Color {
    std::uint8_t r = 0;
    std::uint8_t g = 0;
    std::uint8_t b = 0;
    std::uint8_t a = 255;

    bool operator==(const Color& other) const = default;

    std::uint32_t Packed() const;
    Color AdjustBrightness(float scale) const;

    static Color FromPacked(std::uint32_t packed);
    static Color FromHSV(float h, float s, float v);

    static const Color Off;
    static const Color White;
    static const Color Red;
    static const Color Orange;
    static const Color Yellow;
    static const Color Green;
    static const Color Cyan;
    static const Color Blue;
    static const Color Indigo;
    static const Color Grey;
};

static_assert(sizeof(Color) == sizeof(std::uint32_t));

struct HSV {
    float h = 0.0f;
    float s = 0.0f;
    float v = 0.0f;
};

HSV ToHSV(Color color);

struct AtomicColor {
    AtomicColor() = default;
    explicit AtomicColor(Color color) { Store(color); }
    AtomicColor(const AtomicColor&) = delete;
    AtomicColor& operator=(const AtomicColor&) = delete;

    void Store(Color color, std::memory_order order = std::memory_order_relaxed) {
        value.store(color.Packed(), order);
    }
    Color Load(std::memory_order order = std::memory_order_relaxed) const {
        return Color::FromPacked(value.load(order));
    }
    bool IsLockFree() const { return value.is_lock_free(); }

    std::atomic<std::uint32_t> value{0};
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

enum class Modifier {
    None,
    Reset,
    Random,
    RandomMod,
};

using ParameterRandomFloat = std::function<float()>;
using ParameterRandomIndex = std::function<std::size_t(std::size_t)>;

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
class ParameterManager;
class BankSlot;
struct ParameterStorageBatch;

struct Page {
    PageOrdinal ordinal = 0;
    std::string name;
    std::vector<Parameter*> parameters;
};

struct ParameterGroupConfig {
    std::size_t numVoices = 0;
    std::size_t numModulators = 0;
    std::size_t numScenes = 0;
    std::size_t maxParameters = 0;
    float processLiteAlpha = 1.0f;
    std::vector<Color> voiceIndicatorColors;

    bool IsValid() const;
};

struct ParameterStorageBatch {
    ParameterStorageBatch(const ParameterGroupConfig& config, std::size_t gestureCount, std::size_t capacity);
    ~ParameterStorageBatch();

    bool Compatible(const ParameterGroupConfig& config, std::size_t liveGestureCount) const;
    std::size_t Available() const { return capacity - allocated; }

    std::size_t numVoices = 0;
    std::size_t numModulators = 0;
    std::size_t numScenes = 0;
    std::size_t gestureCount = 0;
    std::size_t capacity = 0;
    std::size_t allocated = 0;
    std::vector<std::unique_ptr<Parameter>> parameters;
    std::vector<float> currentCenterScaleArena;
    std::vector<float> targetCenterScaleArena;
    std::vector<float> currentNormalizationOffsetArena;
    std::vector<float> targetNormalizationOffsetArena;
    std::vector<float> currentMinValueArena;
    std::vector<float> targetMinValueArena;
    std::vector<float> currentMaxValueArena;
    std::vector<float> targetMaxValueArena;
    std::vector<float> currentDepthArena;
    std::vector<float> targetDepthArena;
    std::vector<Parameter*> modulationDepthArena;
    std::vector<float> sceneCenterArena;
    std::vector<float> gestureValueArena;
    std::vector<std::uint8_t> gestureActiveArena;
};

std::unique_ptr<ParameterStorageBatch> MakeParameterStorageBatch(const ParameterGroupConfig& config,
                                                                 std::size_t gestureCount,
                                                                 std::size_t capacity);

struct ModulatorMetadata {
    std::string name;
    std::string shortName;
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
    std::size_t switchValues = 0;
    Color color = Color::Grey;
};

class Modulators {
public:
    explicit Modulators(std::size_t voices = 0, std::size_t modulators = 0);

    float& Value(std::size_t voiceIx, std::size_t modIx);
    float Value(std::size_t voiceIx, std::size_t modIx) const;
    float Apply(std::size_t voiceIx, std::span<const float> depths) const;
    // Source pointers are caller-owned and must remain address-stable while registered.
    void SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
                             ModulatorMetadata metadata);
    void UpdateModValues();

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
    std::vector<float*> sourcePointers_;
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
    ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount);
    ~ParameterGroup();

    const ParameterGroupConfig& Config() const { return config_; }
    Modulators& GetModulators() { return modulators_; }
    const Modulators& GetModulators() const { return modulators_; }
    ParameterManager& Manager() { return *manager_; }
    const ParameterManager& Manager() const { return *manager_; }

    bool CanAllocate() const;
    std::size_t AvailableParameterSlots() const;
    void AddParameterStorageBatch(std::unique_ptr<ParameterStorageBatch> batch);
    std::size_t ParameterCount() const { return parameterCount_; }
    Parameter& ParameterByLocalIndex(std::size_t localIx);
    const Parameter& ParameterByLocalIndex(std::size_t localIx) const;
    std::size_t GestureCount() const { return gestureCount_; }
    Color VoiceIndicatorColor(std::size_t voiceIx) const;
    void SetModulationSource(std::size_t modIx, std::span<float* const> sourcePointers,
                             ModulatorMetadata metadata);
    void UpdateModValues();
    void SelectGesture(std::size_t gestureIx);
    void DeselectGesture(std::size_t gestureIx);
    bool GestureSelected(std::size_t gestureIx) const;
    void SetGestureValue(std::size_t gestureIx, float value);
    float GestureValue(std::size_t gestureIx) const;
    void ClearGestureActiveFlagsForActiveSceneSelection(const SceneState& scene, std::size_t gestureIx);

private:
    friend class Parameter;
    friend class ParameterManager;
    friend class Bank;

    Parameter& CreateLocalParameter(ParameterConfig config, ParameterId id);
    void RequestParameterStorageBatch(std::size_t minimumAdditionalParameters);
    void RequestParameterStorageBatchIfLow();

    // Groups own parameter objects and all same-shaped per-parameter arenas.
    // Parameter instances hold spans into these arenas; callers must not move a
    // group after handing out Parameter references.
    ParameterGroupConfig config_;
    ParameterManager* manager_ = nullptr;
    std::size_t gestureCount_ = 0;
    std::vector<Color> voiceIndicatorColors_;
    Modulators modulators_;
    std::size_t parameterCount_ = 0;
    std::vector<std::unique_ptr<Parameter>> parameters_;
    std::vector<std::unique_ptr<ParameterStorageBatch>> extraStorageBatches_;
    bool storageRequestPending_ = false;
    std::vector<float> currentCenterScaleArena_;
    std::vector<float> targetCenterScaleArena_;
    std::vector<float> currentNormalizationOffsetArena_;
    std::vector<float> targetNormalizationOffsetArena_;
    std::vector<float> currentMinValueArena_;
    std::vector<float> targetMinValueArena_;
    std::vector<float> currentMaxValueArena_;
    std::vector<float> targetMaxValueArena_;
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
    Parameter(ParameterId id, ParameterGroup& group, ParameterConfig config,
              ParameterStorageBatch& storageBatch, std::size_t slotIx);

    struct UIState {
        UIState() = default;
        explicit UIState(std::size_t voiceCapacity) { Configure(voiceCapacity); }
        UIState(const UIState&) = delete;
        UIState& operator=(const UIState&) = delete;

        void Configure(std::size_t voiceCapacity);
        void SetDisconnected();

        std::atomic<std::uint32_t> revision{0};
        std::atomic<bool> connected{false};
        std::atomic<bool> bipolar{false};
        std::atomic<std::size_t> switchValues{0};
        std::atomic<std::uint32_t> modulatorsAffectingMask{0};
        std::atomic<std::uint32_t> gesturesAffectingMask{0};
        AtomicColor color;
        std::atomic<float> brightness{0.0f};
        std::atomic<const char*> shortName{nullptr};
        std::atomic<std::size_t> voiceCount{0};
        std::size_t voiceCapacity = 0;
        std::unique_ptr<std::atomic<float>[]> values;
        std::unique_ptr<std::atomic<float>[]> minValues;
        std::unique_ptr<std::atomic<float>[]> maxValues;
        std::unique_ptr<std::atomic<std::size_t>[]> switchValue;
        std::unique_ptr<AtomicColor[]> indicatorColors;
    };

    ParameterId Id() const { return id_; }
    const std::string& Name() const { return config_.name; }
    const std::string& ShortName() const { return config_.shortName; }
    RangeKind Range() const { return config_.range; }
    Color ParamColor() const { return config_.color; }
    std::size_t SwitchValues() const;
    bool IsSwitch() const;
    ParameterGroup& Group() { return group_; }
    const ParameterGroup& Group() const { return group_; }

    float Get(std::size_t voiceIx) const;
    std::size_t GetSwitchVal(std::size_t voiceIx) const;
    void PopulateUIState(UIState& state) const;
    void Compute(const SceneState& scene);
    // Audio-rate helper: no graph traversal or allocation.
    void ProcessLite();
    void HandleIncDec(const SceneState& scene, float delta);
    void RandomizeVisibleValue(const SceneState& scene, float normalized);
    void RevertToDefault(const SceneState& scene);
    void RevertAllToDefault();

    bool AssignModulationDepth(std::size_t modIx, Parameter* parameter);
    Parameter* EnsureModulationDepth(std::size_t modIx);
    Parameter& EnsureModulationDepth(std::size_t modIx, ParameterConfig config);
    void ClearModulationDepths();
    Parameter* ModulationDepthParameter(std::size_t modIx) const;

    float& SceneCenter(std::size_t sceneIx);
    float SceneCenter(std::size_t sceneIx) const;
    float& GestureValue(std::size_t sceneIx, std::size_t gestureIx);
    float GestureValue(std::size_t sceneIx, std::size_t gestureIx) const;
    void SetGestureActive(std::size_t sceneIx, std::size_t gestureIx, bool active);
    bool GestureActive(std::size_t sceneIx, std::size_t gestureIx) const;
    std::uint32_t GesturesAffectingMask() const;

    std::span<float> CurrentDepths(std::size_t voiceIx);
    std::span<const float> CurrentDepths(std::size_t voiceIx) const;
    std::span<float> TargetDepths(std::size_t voiceIx);
    std::span<const float> TargetDepths(std::size_t voiceIx) const;

    float CurrentCenter() const { return currentCenter_; }
    float TargetCenter() const { return targetCenter_; }
    float CurrentCenterScale(std::size_t voiceIx) const;
    float TargetCenterScale(std::size_t voiceIx) const;
    float CurrentNormalizationOffset(std::size_t voiceIx) const;
    float TargetNormalizationOffset(std::size_t voiceIx) const;
    std::size_t RecursionDepth() const { return recursionDepth_; }
    JSON ToValueJSON(JsonArena& arena) const;
    bool LoadValuesFromJSON(JSON json);

private:
    friend class ParameterManager;

    std::size_t VoiceModIndex(std::size_t voiceIx, std::size_t modIx) const;
    std::size_t SceneGestureIndex(std::size_t sceneIx, std::size_t gestureIx) const;
    void ValidateSceneEndpoints(const SceneState& scene) const;
    float EffectiveGestureWeight(const SceneState& scene, std::size_t gestureIx, float blend) const;
    void ResetSceneToDefault(std::size_t sceneIx, float defaultValue);
    void ResetModulationDepthToNeutral(const SceneState& scene);
    float ComputeRawCenter(const SceneState& scene) const;
    void ComputeAtDepth(const SceneState& scene, std::size_t recursionDepth);
    void SnapCurrentToTarget();
    bool WouldCreateCycle(const Parameter* candidate) const;
    ParameterConfig ModulationDepthConfig(std::size_t modIx) const;
    float TargetValue(std::size_t voiceIx) const;
    std::uint32_t ModulatorsAffectingMask() const;
    bool HasNonDefaultState() const;
    bool HasNonZeroState() const;

    ParameterId id_;
    ParameterGroup& group_;
    ParameterConfig config_;
    std::size_t slotIx_ = 0;
    std::size_t recursionDepth_ = 0;
    float currentCenter_ = 0.0f;
    float targetCenter_ = 0.0f;
    std::span<float> currentCenterScales_;
    std::span<float> targetCenterScales_;
    std::span<float> currentNormalizationOffsets_;
    std::span<float> targetNormalizationOffsets_;
    std::span<float> currentMinValues_;
    std::span<float> targetMinValues_;
    std::span<float> currentMaxValues_;
    std::span<float> targetMaxValues_;
    std::span<float> currentDepths_;
    std::span<float> targetDepths_;
    std::span<Parameter*> modulationDepths_;
    std::span<float> sceneCenters_;
    std::span<float> gestureValues_;
    std::span<std::uint8_t> gestureActive_;
};

class Bank {
public:
    explicit Bank(ParameterManager* manager = nullptr);

    struct VisibleCell {
        Parameter* parameter = nullptr;
    };

    // Banks do not own parameters; they map physical controls to manager-owned
    // parameters and transient modulation-depth views.
    void AddMapping(PhysicalEncoderId encoderId, Parameter& parameter);
    void RegisterParameters(std::span<Parameter* const> parameters, std::size_t offset);
    std::size_t SlotCapacity() const;
    BankSlot* AssociatedSlot() const { return slot_; }
    bool OwnsVisible(PhysicalEncoderId encoderId) const;
    void HandlePress(PhysicalEncoderId encoderId);
    void HandlePress(PhysicalEncoderId encoderId, std::span<const PhysicalEncoderId> physicalLayout);
    void HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, float delta);
    void ApplyModifierToTopLevel(Modifier modifier, const SceneState& scene);
    void Deselect();
    bool ShowingModulation() const;
    void SetColor(Color color) { color_ = color; }
    Color GetColor() const { return color_; }

    std::size_t VisibleMappingCount() const;
    Parameter* VisibleParameter(PhysicalEncoderId encoderId) const;
    VisibleCell VisibleCellFor(PhysicalEncoderId encoderId) const;
    Parameter* SelectedParameter() const { return selected_; }
    Parameter* TargetParameter() const;
    std::uint32_t GesturesAffectingMask() const;

private:
    friend class BankSlot;

    struct Cell {
        PhysicalEncoderId encoderId = 0;
        Parameter* parameter = nullptr;
    };

    void AssociateSlot(BankSlot& slot);
    Cell* FindVisibleCell(PhysicalEncoderId encoderId);
    const Cell* FindVisibleCell(PhysicalEncoderId encoderId) const;
    Parameter* EnsureModulationDepthParameter(Parameter& parameter, std::size_t modIx);
    bool CanOpenModulationView(const Parameter& parameter) const;
    std::size_t MissingModulationDepthCount(const Parameter& parameter) const;
    void OpenModulationView(Parameter& parameter, std::span<const PhysicalEncoderId> physicalLayout);
    void ApplyModifierToParameter(Parameter& parameter, Modifier modifier, const SceneState& scene);
    void RandomizeModulationDepths(Parameter& parameter, const SceneState& scene);
    std::vector<PhysicalEncoderId> CompactPhysicalLayout() const;

    ParameterManager* manager_ = nullptr;
    BankSlot* slot_ = nullptr;
    Color color_ = Color::Grey;
    std::vector<Cell> topLevel_;
    std::vector<Cell> visible_;
    Parameter* selected_ = nullptr;
};

class BankSlot {
public:
    struct UIState {
        UIState() = default;
        UIState(std::size_t cellCapacity, std::size_t voiceCapacity) { Configure(cellCapacity, voiceCapacity); }
        UIState(const UIState&) = delete;
        UIState& operator=(const UIState&) = delete;

        void Configure(std::size_t cellCapacity, std::size_t voiceCapacity);

        std::atomic<bool> connected{false};
        std::atomic<bool> showingModulationView{false};
        std::size_t cellCapacity = 0;
        std::unique_ptr<Parameter::UIState[]> cells;
    };

    void SelectBank(Bank* bank);
    bool Owns(PhysicalEncoderId encoderId) const;
    void AddPhysicalEncoder(PhysicalEncoderId encoderId);
    void HandlePress(PhysicalEncoderId encoderId);
    void HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, float delta);
    Bank* SelectedBank() const { return selectedBank_; }
    std::span<const PhysicalEncoderId> PhysicalEncoders() const { return physicalEncoders_; }
    bool ResolvePosition(std::size_t position, PhysicalEncoderId& encoderId) const;
    void PopulateUIState(UIState& state) const;

private:
    bool OwnsPhysicalEncoder(PhysicalEncoderId encoderId) const;

    std::vector<PhysicalEncoderId> physicalEncoders_;
    Bank* selectedBank_ = nullptr;
};

struct ParameterMessageOut {
    enum class Type {
        ParameterStorageBatchNeeded,
    };

    Type type = Type::ParameterStorageBatchNeeded;
    ParameterGroup* group = nullptr;
    std::size_t minimumAdditionalParameters = 0;
    std::size_t requestedParameters = 0;

    static ParameterMessageOut ParameterStorageBatchNeeded(ParameterGroup& group,
                                                           std::size_t minimumAdditionalParameters,
                                                           std::size_t requestedParameters);
};

class ParameterMessageOutBus {
public:
    explicit ParameterMessageOutBus(std::size_t capacity = 64);

    bool Push(const ParameterMessageOut& message);
    bool Pop(ParameterMessageOut& message);
    std::size_t Size() const { return size_.load(std::memory_order_acquire); }
    std::size_t Capacity() const { return queue_.size(); }

private:
    std::vector<ParameterMessageOut> queue_;
    std::atomic<std::size_t> head_{0};
    std::atomic<std::size_t> tail_{0};
    std::atomic<std::size_t> size_{0};
};

class ParameterManager {
public:
    ParameterManager() = default;

    struct GestureManagerUIState {
        GestureManagerUIState() = default;
        explicit GestureManagerUIState(std::size_t gestureCapacity) { Configure(gestureCapacity); }
        GestureManagerUIState(const GestureManagerUIState&) = delete;
        GestureManagerUIState& operator=(const GestureManagerUIState&) = delete;

        void Configure(std::size_t gestureCapacity);

        std::size_t gestureCapacity = 0;
        std::unique_ptr<std::atomic<float>[]> values;
        std::unique_ptr<std::atomic<bool>[]> selected;
        std::unique_ptr<AtomicColor[]> colors;
        std::unique_ptr<std::atomic<bool>[]> connected;
        std::unique_ptr<std::atomic<std::uint32_t>[]> bankAffectingMask;
        std::unique_ptr<std::atomic<std::size_t>[]> bankAffectingCount;
    };

    struct BankUIState {
        std::atomic<bool> connected{false};
        std::atomic<bool> selected{false};
        AtomicColor color;
    };

    struct UIState {
        UIState() = default;
        UIState(const UIState&) = delete;
        UIState& operator=(const UIState&) = delete;

        void Configure(std::size_t slotCapacity, std::size_t cellCapacity, std::size_t voiceCapacity,
                       std::size_t gestureCapacity, std::size_t bankCapacity = 0);

        std::atomic<std::size_t> leftScene{0};
        std::atomic<std::size_t> rightScene{0};
        std::atomic<float> sceneBlend{0.0f};
        std::atomic<bool> resetHeld{false};
        std::atomic<bool> randomHeld{false};
        std::atomic<bool> randomModHeld{false};
        std::size_t sceneCapacity = 0;
        std::size_t slotCapacity = 0;
        std::size_t bankCapacity = 0;
        std::unique_ptr<BankSlot::UIState[]> slots;
        std::unique_ptr<BankUIState[]> banks;
        GestureManagerUIState gestures;
    };

    // The manager owns groups, pages, banks, and slots, and assigns global
    // parameter IDs. Parameter lifetime is tied to its owning group.
    bool SetGestureCount(std::size_t count);
    std::size_t GestureCount() const { return gestures_.NumGestures(); }
    ParameterGroup& CreateGroup(ParameterGroupConfig config);
    ParameterId RegisterParameter(ParameterGroup& group, ParameterConfig config);
    Parameter& CreateParameter(ParameterGroup& group, ParameterConfig config);
    Parameter& ParameterById(ParameterId id);
    const Parameter& ParameterById(ParameterId id) const;
    std::size_t ParameterCount() const { return parameters_.size(); }
    Parameter* FindParameterByName(std::string_view name);
    const Parameter* FindParameterByName(std::string_view name) const;
    JSON ParameterValuesToJSON(JsonArena& arena) const;
    bool LoadParameterValuesFromJSON(JSON json);
    void ComputeAllParameters();
    // Control-rate target computation for the steady-state audio pump:
    // Compute() every parameter without snapping current values, so
    // ProcessLite() slewing stays audible (sar-6). Use ComputeAllParameters()
    // only for non-steady-state moments (init, patch load, revert).
    void ComputeAllTargets();
    void CaptureDefaultControlState();
    void RevertAllToDefaults();

    float GetLinear(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const;
    float GetExponential(float minValue, float maxValue, std::size_t voiceIx, ParameterId id) const;
    float GetZeroBasedExponential(float maxValue, float midpointValue, std::size_t voiceIx, ParameterId id) const;
    float GetBipolarLinear(float maxAbsValue, std::size_t voiceIx, ParameterId id) const;
    float GetBipolarExponential(float minAbsValue, float maxAbsValue, std::size_t voiceIx, ParameterId id) const;
    float GetBipolarZeroBasedExponential(float maxAbsValue, float midpointAbsValue, std::size_t voiceIx,
                                         ParameterId id) const;
    void UpdateModValues(ParameterGroup& group);
    void UpdateModValues();

    SceneState& Scene() { return scene_; }
    const SceneState& Scene() const { return scene_; }
    bool SetSceneEndpoints(std::size_t leftScene, std::size_t rightScene);
    bool SetLessSelectedScene(std::size_t sceneIx);
    void SetSceneBlend(float blend);

    std::size_t NumGroups() const { return groups_.size(); }

    Page& CreatePage(std::string name);
    bool AssignParameterToPage(PageOrdinal ordinal, Parameter& parameter);
    bool SelectActivePage(PageOrdinal ordinal);
    void SetActivePage(PageOrdinal ordinal);
    Page* ActivePage();
    const Page* ActivePage() const;
    std::optional<PageOrdinal> ActivePageOrdinal() const;

    Bank& CreateBank();
    Bank* BankAt(std::size_t bankIx);
    const Bank* BankAt(std::size_t bankIx) const;
    BankSlot& CreateBankSlot();
    BankSlot* BankSlotAt(std::size_t slotIx);
    const BankSlot* BankSlotAt(std::size_t slotIx) const;
    void HandlePress(PhysicalEncoderId encoderId);
    void HandleTick(PhysicalEncoderId encoderId, float delta);
    void HandlePress(std::size_t slotIx, std::size_t position);
    void HandleTick(std::size_t slotIx, std::size_t position, float delta);
    bool SelectBankForSlot(std::size_t slotIx, std::size_t bankIx);

    Modifier GetCurrentModifier() const;

    bool ResetHeld() const { return resetHeld_; }
    void SetResetHeld(bool held) { resetHeld_ = held; }
    void ToggleResetHeld() { resetHeld_ = !resetHeld_; }

    bool RandomHeld() const { return randomHeld_; }
    void SetRandomHeld(bool held) { randomHeld_ = held; }
    void ToggleRandomHeld() { randomHeld_ = !randomHeld_; }

    bool RandomModHeld() const { return randomModHeld_; }
    void SetRandomModHeld(bool held) { randomModHeld_ = held; }
    void ToggleRandomModHeld() { randomModHeld_ = !randomModHeld_; }

    void SetRandomSource(ParameterRandomFloat valueSource, ParameterRandomFloat coinSource,
                         ParameterRandomIndex indexSource);
    float NextRandomValue();
    float NextRandomCoin();
    std::size_t NextRandomIndex(std::size_t exclusiveMax);

    void SelectGesture(std::size_t gestureIx);
    void DeselectGesture(std::size_t gestureIx);
    void ToggleGestureSelected(std::size_t gestureIx);
    bool GestureSelected(std::size_t gestureIx) const;
    void SetGestureValue(std::size_t gestureIx, float value);
    float GestureValue(std::size_t gestureIx) const;
    GestureMetadata& GestureMetadataAt(std::size_t gestureIx);
    const GestureMetadata& GestureMetadataAt(std::size_t gestureIx) const;
    void ClearGestureActiveFlagsForActiveSceneSelection(std::size_t gestureIx);

    std::unique_ptr<UIState> CreateUIState() const;
    void PopulateUIState(UIState& state) const;
    void SetParameterMessageOutBus(ParameterMessageOutBus* bus) { parameterMessageOutBus_ = bus; }
    bool RequestParameterStorageBatch(ParameterGroup& group, std::size_t minimumAdditionalParameters);

private:
    Page* FindPage(PageOrdinal ordinal);
    const Page* FindPage(PageOrdinal ordinal) const;
    bool SceneEndpointsValid(std::size_t leftScene, std::size_t rightScene) const;
    bool OwnsGroup(const ParameterGroup& group) const;
    std::size_t SceneCapacity() const;
    std::size_t MaxVoiceCount() const;
    std::size_t MaxSlotCellCount() const;

    struct DefaultControlState {
        SceneState scene;
        bool resetHeld = false;
        bool randomHeld = false;
        bool randomModHeld = false;
        std::vector<float> gestureValues;
        std::vector<bool> gestureSelected;
        std::optional<PageOrdinal> activePageOrdinal;
    };

    SceneState scene_;
    DefaultControlState defaultControlState_;
    Gestures gestures_;
    bool resetHeld_ = false;
    bool randomHeld_ = false;
    bool randomModHeld_ = false;
    ParameterRandomFloat randomValueSource_;
    ParameterRandomFloat randomCoinSource_;
    ParameterRandomIndex randomIndexSource_;
    std::mt19937 randomEngine_{0x51EA5EEDu};
    std::vector<Parameter*> parameters_;
    std::vector<std::string> parameterNames_;
    std::vector<std::unique_ptr<ParameterGroup>> groups_;
    std::vector<std::unique_ptr<Page>> pages_;
    std::optional<PageOrdinal> activePageOrdinal_;
    std::vector<std::unique_ptr<Bank>> banks_;
    std::vector<std::unique_ptr<BankSlot>> slots_;
    ParameterMessageOutBus* parameterMessageOutBus_ = nullptr;
};

struct MessageIn {
    enum class Type {
        ParamIncDec,
        ParamPush,
        ToggleReset,
        ToggleRandom,
        ToggleRandomMod,
        ToggleGestureSelect,
        SetGestureSelect,
        SelectParamBank,
        Start,
        Stop,
        Clock,
        SetGestureValue,
        SceneSelect,
        SetSceneBlend,
    };

    std::uint64_t timestamp = 0;
    Type type = Type::Clock;
    std::size_t slotIx = 0;
    std::size_t position = 0;
    std::size_t gestureIx = 0;
    std::size_t bankIx = 0;
    std::size_t sceneIx = 0;
    float value = 0.0f;
    float delta = 0.0f;
    bool boolValue = false;
    bool hasBoolValue = false;

    static MessageIn ParamIncDec(std::uint64_t timestamp, std::size_t slotIx, std::size_t position, float delta);
    static MessageIn ParamPush(std::uint64_t timestamp, std::size_t slotIx, std::size_t position);
    static MessageIn ToggleReset(std::uint64_t timestamp);
    static MessageIn SetReset(std::uint64_t timestamp, bool held);
    static MessageIn ToggleRandom(std::uint64_t timestamp);
    static MessageIn SetRandom(std::uint64_t timestamp, bool held);
    static MessageIn ToggleRandomMod(std::uint64_t timestamp);
    static MessageIn SetRandomMod(std::uint64_t timestamp, bool held);
    static MessageIn ToggleGestureSelect(std::uint64_t timestamp, std::size_t gestureIx);
    static MessageIn SetGestureSelect(std::uint64_t timestamp, std::size_t gestureIx, bool selected);
    static MessageIn SelectParamBank(std::uint64_t timestamp, std::size_t slotIx, std::size_t bankIx);
    static MessageIn Start(std::uint64_t timestamp);
    static MessageIn Stop(std::uint64_t timestamp);
    static MessageIn Clock(std::uint64_t timestamp);
    static MessageIn SetGestureValue(std::uint64_t timestamp, std::size_t gestureIx, float value);
    static MessageIn SceneSelect(std::uint64_t timestamp, std::size_t sceneIx);
    static MessageIn SetSceneBlend(std::uint64_t timestamp, float blend);
};

class MessageInBus {
public:
    explicit MessageInBus(ParameterManager* manager = nullptr, std::size_t capacity = 16384);

    void SetManager(ParameterManager* manager) { manager_ = manager; }
    bool Push(const MessageIn& message);
    bool Pop(MessageIn& message, std::uint64_t timestamp);
    void Apply(const MessageIn& message);
    void Process(std::uint64_t timestamp);
    std::size_t Size() const { return size_; }
    std::size_t Capacity() const { return queue_.size(); }

private:
    ParameterManager* manager_ = nullptr;
    std::vector<MessageIn> queue_;
    std::atomic<std::size_t> head_{0};
    std::atomic<std::size_t> tail_{0};
    std::atomic<std::size_t> size_{0};
};

} // namespace synth
