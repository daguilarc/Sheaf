#pragma once

#include <cstddef>
#include <cstdint>
#include <atomic>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

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
    std::size_t switchValues = 0;
    Color color = Color::Grey;
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
    ParameterGroup(ParameterGroupConfig config, ParameterManager& manager, std::size_t gestureCount);
    ~ParameterGroup();

    const ParameterGroupConfig& Config() const { return config_; }
    Modulators& GetModulators() { return modulators_; }
    const Modulators& GetModulators() const { return modulators_; }
    ParameterManager& Manager() { return *manager_; }
    const ParameterManager& Manager() const { return *manager_; }

    bool CanAllocate() const;
    std::size_t ParameterCount() const { return parameterCount_; }
    std::size_t GestureCount() const { return gestureCount_; }
    Color VoiceIndicatorColor(std::size_t voiceIx) const;
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
    ParameterManager* manager_ = nullptr;
    std::size_t gestureCount_ = 0;
    std::vector<Color> voiceIndicatorColors_;
    Modulators modulators_;
    std::size_t parameterCount_ = 0;
    std::vector<std::unique_ptr<Parameter>> parameters_;
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
    float CurrentNormalizationOffset(std::size_t voiceIx) const;
    float TargetNormalizationOffset(std::size_t voiceIx) const;
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
    float TargetValue(std::size_t voiceIx) const;
    std::uint32_t ModulatorsAffectingMask() const;
    std::uint32_t GesturesAffectingMask() const;

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
    bool OwnsVisible(PhysicalEncoderId encoderId) const;
    void HandlePress(PhysicalEncoderId encoderId);
    void HandleShiftPress(PhysicalEncoderId encoderId, const SceneState& scene);
    void HandleTick(PhysicalEncoderId encoderId, const SceneState& scene, float delta);
    void Deselect();
    bool ShowingModulation() const;

    std::size_t VisibleMappingCount() const;
    Parameter* VisibleParameter(PhysicalEncoderId encoderId) const;
    VisibleCell VisibleCellFor(PhysicalEncoderId encoderId) const;
    Parameter* SelectedParameter() const { return selected_; }
    Parameter* TargetParameter() const;

private:
    struct Cell {
        PhysicalEncoderId encoderId = 0;
        Parameter* parameter = nullptr;
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
    void HandleShiftPress(PhysicalEncoderId encoderId, const SceneState& scene);
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
    };

    struct UIState {
        UIState() = default;
        UIState(const UIState&) = delete;
        UIState& operator=(const UIState&) = delete;

        void Configure(std::size_t slotCapacity, std::size_t cellCapacity, std::size_t voiceCapacity,
                       std::size_t gestureCapacity);

        std::atomic<std::size_t> leftScene{0};
        std::atomic<std::size_t> rightScene{0};
        std::atomic<float> sceneBlend{0.0f};
        std::atomic<bool> shiftHeld{false};
        std::size_t slotCapacity = 0;
        std::unique_ptr<BankSlot::UIState[]> slots;
        GestureManagerUIState gestures;
    };

    // The manager owns groups, pages, banks, and slots, and assigns global
    // parameter IDs. Parameter lifetime is tied to its owning group.
    bool SetGestureCount(std::size_t count);
    std::size_t GestureCount() const { return gestures_.NumGestures(); }
    ParameterGroup& CreateGroup(ParameterGroupConfig config);
    Parameter& CreateParameter(ParameterGroup& group, ParameterConfig config);
    ParameterId NextParameterId();

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
    void HandleShiftPress(PhysicalEncoderId encoderId);
    void HandleTick(PhysicalEncoderId encoderId, float delta);
    void HandlePress(std::size_t slotIx, std::size_t position);
    void HandleShiftPress(std::size_t slotIx, std::size_t position);
    void HandleTick(std::size_t slotIx, std::size_t position, float delta);
    bool SelectBankForSlot(std::size_t slotIx, std::size_t bankIx);

    bool ShiftHeld() const { return shiftHeld_; }
    void SetShiftHeld(bool held) { shiftHeld_ = held; }
    void ToggleShiftHeld() { shiftHeld_ = !shiftHeld_; }

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

private:
    Page* FindPage(PageOrdinal ordinal);
    const Page* FindPage(PageOrdinal ordinal) const;
    bool SceneEndpointsValid(std::size_t leftScene, std::size_t rightScene) const;
    std::size_t MaxVoiceCount() const;
    std::size_t MaxSlotCellCount() const;

    ParameterId nextId_ = 1;
    SceneState scene_;
    Gestures gestures_;
    bool shiftHeld_ = false;
    std::vector<std::unique_ptr<ParameterGroup>> groups_;
    std::vector<std::unique_ptr<Page>> pages_;
    std::optional<PageOrdinal> activePageOrdinal_;
    std::vector<std::unique_ptr<Bank>> banks_;
    std::vector<std::unique_ptr<BankSlot>> slots_;
};

struct MessageIn {
    enum class Type {
        ParamIncDec,
        ParamPush,
        ToggleShift,
        ToggleGestureSelect,
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
    static MessageIn ToggleShift(std::uint64_t timestamp);
    static MessageIn SetShift(std::uint64_t timestamp, bool held);
    static MessageIn ToggleGestureSelect(std::uint64_t timestamp, std::size_t gestureIx);
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
