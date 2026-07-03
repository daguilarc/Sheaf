#include "synth/MidiConfigBlocks.hpp"

#include <algorithm>
#include <limits>
#include <tuple>

namespace synth {

std::vector<SystemAddressField> SystemAddressSchema(MidiProfileKind kind) {
    switch (kind) {
        case MidiProfileKind::WrldBldr:
            return {SystemAddressField::Channel, SystemAddressField::WrldBldrX, SystemAddressField::WrldBldrY};
        case MidiProfileKind::Launchpad:
            return {SystemAddressField::LaunchpadX, SystemAddressField::LaunchpadY};
        case MidiProfileKind::MfTwister:
            return {SystemAddressField::Button};
        case MidiProfileKind::Generic:
            return {SystemAddressField::Channel, SystemAddressField::Cc};
    }
    return {};
}

namespace {

// MessageIn::Type's declaration order (ParamIncDec .. SetSceneBlend) IS the
// type ordering component of SystemMessageSortKey -- static_cast the enum
// directly rather than maintaining a parallel table that could drift.
int TypeOrder(MessageIn::Type type) {
    return static_cast<int>(type);
}

auto SortKeyTuple(const SystemMessageSortKey& key) {
    return std::tie(key.typeOrder, key.arg1, key.arg2, key.hasBoolValue, key.boolValue, key.addrChannel, key.addrX,
                    key.addrY, key.addrCc);
}

}  // namespace

bool operator<(const SystemMessageSortKey& a, const SystemMessageSortKey& b) {
    return SortKeyTuple(a) < SortKeyTuple(b);
}
bool operator==(const SystemMessageSortKey& a, const SystemMessageSortKey& b) {
    return SortKeyTuple(a) == SortKeyTuple(b);
}

SystemMessageSortKey ComputeSystemMessageSortKey(const MidiControllerSystemMessageAssociation& association,
                                                  MidiProfileKind kind) {
    SystemMessageSortKey key;
    const MessageIn& message = association.press;
    key.typeOrder = TypeOrder(message.type);

    switch (message.type) {
        case MessageIn::Type::SceneSelect:
            key.arg1 = message.sceneIx;
            break;
        case MessageIn::Type::SelectParamBank:
            key.arg1 = message.slotIx;
            key.arg2 = message.bankIx;
            break;
        case MessageIn::Type::ToggleGestureSelect:
            key.arg1 = message.gestureIx;
            break;
        case MessageIn::Type::SetGestureSelect:
            key.arg1 = message.gestureIx;
            key.hasBoolValue = true;
            key.boolValue = message.boolValue;
            break;
        case MessageIn::Type::ToggleReset:
        case MessageIn::Type::ToggleRandom:
        case MessageIn::Type::ToggleRandomMod:
            key.hasBoolValue = message.hasBoolValue;
            key.boolValue = message.boolValue;
            break;
        case MessageIn::Type::ParamIncDec:
        case MessageIn::Type::ParamPush:
            key.arg1 = message.slotIx;
            key.arg2 = message.position;
            break;
        case MessageIn::Type::SetGestureValue:
            key.arg1 = message.gestureIx;
            break;
        case MessageIn::Type::SetSceneBlend:
        case MessageIn::Type::Start:
        case MessageIn::Type::Stop:
        case MessageIn::Type::Clock:
            break;
    }

    // Address tie-break, flattened per-kind. Fields not meaningful for this
    // kind stay 0 -- fine since ties only ever compare within one kind's own
    // associations (a single controller's systemMessages).
    switch (kind) {
        case MidiProfileKind::WrldBldr:
            if (association.control.has_value()) {
                key.addrChannel = association.control->channel;
            }
            if (association.wrldBldrPosition.has_value()) {
                key.addrX = association.wrldBldrPosition->x;
                key.addrY = association.wrldBldrPosition->y;
            }
            break;
        case MidiProfileKind::Launchpad:
            if (association.launchpadPosition.has_value()) {
                // Launchpad coordinates are signed ints (can be -1); store
                // via the unsigned addrX/addrY fields using a fixed offset
                // so ordering stays correct without changing the schema's
                // storage type for the common (WrldBldr) unsigned case.
                key.addrX = static_cast<std::uint8_t>(association.launchpadPosition->x + 1);
                key.addrY = static_cast<std::uint8_t>(association.launchpadPosition->y + 1);
            }
            break;
        case MidiProfileKind::MfTwister:
        case MidiProfileKind::Generic:
            if (association.control.has_value()) {
                key.addrChannel = association.control->channel;
                key.addrCc = association.control->cc;
            }
            break;
    }

    return key;
}

void NormalizeMidiProfileConfig(MidiControllerProfileConfig& config, MidiProfileKind kind) {
    if (config.encoderInput.has_value()) {
        std::stable_sort(config.encoderInput->turns.begin(), config.encoderInput->turns.end(),
                         [](const EncoderMidiMapping& a, const EncoderMidiMapping& b) {
                             return std::tie(a.slotIx, a.position) < std::tie(b.slotIx, b.position);
                         });
        std::stable_sort(config.encoderInput->pushes.begin(), config.encoderInput->pushes.end(),
                         [](const EncoderMidiMapping& a, const EncoderMidiMapping& b) {
                             return std::tie(a.slotIx, a.position) < std::tie(b.slotIx, b.position);
                         });
    }
    if (config.analogInput.has_value()) {
        std::stable_sort(config.analogInput->gestures.begin(), config.analogInput->gestures.end(),
                         [](const AnalogMidiMapping& a, const AnalogMidiMapping& b) {
                             return a.gestureIx < b.gestureIx;
                         });
    }
    std::stable_sort(config.systemMessages.begin(), config.systemMessages.end(),
                     [kind](const MidiControllerSystemMessageAssociation& a,
                            const MidiControllerSystemMessageAssociation& b) {
                         return ComputeSystemMessageSortKey(a, kind) < ComputeSystemMessageSortKey(b, kind);
                     });
}

namespace {

void SetReason(std::string* reason, const char* message) {
    if (reason != nullptr) {
        *reason = message;
    }
}

// Cell count for the 2-D inclusive-rectangle forms: width x height, where
// height counts the rows from startY to endY stepping +-1 (endY may be <
// startY -- the descending-row case, e.g. the default WRLD.Bldr bank grid).
std::size_t RectangleCellCount(int startX, int endX, int startY, int endY) {
    if (endX < startX) {
        return 0;
    }
    const std::size_t width = static_cast<std::size_t>(endX - startX) + 1;
    const std::size_t height =
        (startY <= endY) ? (static_cast<std::size_t>(endY - startY) + 1) : (static_cast<std::size_t>(startY - endY) + 1);
    return width * height;
}

// D3: expansion mirrors the edit rules (ApplyMappingEdit refuses channel
// outside 0-15 for every kind that carries a MIDI channel).
bool ChannelValid(std::uint8_t channel) {
    return channel <= 15;
}

// Finding 3: a block's start argument/position/index plus its cell count
// must stay within a sane domain -- otherwise the per-cell `start + index`
// arithmetic in the Expand* loops below can wrap std::size_t (SIZE_MAX ->
// 0), silently producing a small index instead of failing. Reuses the same
// 2^53 "largest exactly-representable double integer" cap the view model's
// IsNonNegativeInteger applies to every numeric field edit (see
// MidiConfigViewModel.cpp) -- any block field wide enough to reach this cap
// could not have been entered through the numeric field editor anyway, so
// this is not a tighter restriction in practice, just an explicit guard at
// the library boundary for blocks constructed directly (as tests, or a
// future non-UI caller, might).
constexpr std::size_t kMaxBlockDomain = 9007199254740992ULL;  // 2^53

// True when `start + count` would exceed kMaxBlockDomain OR wrap std::size_t
// -- the single check that makes every per-cell `start + index` in the
// Expand* loops below well-defined and within the documented domain cap.
bool StartPlusCountExceedsDomain(std::size_t start, std::size_t count) {
    if (start > kMaxBlockDomain || count > kMaxBlockDomain) {
        return true;
    }
    return kMaxBlockDomain - start < count;
}

// Finding 3: `cur == prev + 1` computed as written wraps std::size_t
// (SIZE_MAX -> 0) when prev == SIZE_MAX, which would make an unrelated
// `cur == 0` cell look like a consecutive successor. Reconstruction must
// treat that as a run break, never a match -- so guard the overflow
// explicitly rather than computing `prev + 1` at all.
bool IsWrapSafeSuccessor(std::size_t prev, std::size_t cur) {
    if (prev == std::numeric_limits<std::size_t>::max()) {
        return false;
    }
    return cur == prev + 1;
}

}  // namespace

std::size_t SystemBlock::CellCount() const {
    if (kind == MidiProfileKind::WrldBldr || kind == MidiProfileKind::Launchpad) {
        return RectangleCellCount(startX, endX, startY, endY);
    }
    if (endCc <= startCc) {
        return 0;
    }
    return static_cast<std::size_t>(endCc) - startCc;
}

bool ExpandEncoderBlock(const EncoderBlock& block, std::vector<EncoderMidiMapping>& out, std::string* reason) {
    if (block.endCc <= block.startCc) {
        SetReason(reason, "encoder block cc range must be non-empty (endCc > startCc)");
        return false;
    }
    if (block.endCc - 1 > 127 || block.startCc > 127) {
        SetReason(reason, "encoder block cc range must fit the 0-127 MIDI CC domain");
        return false;
    }
    if (!ChannelValid(block.channel)) {
        SetReason(reason, "encoder block channel must be an integer 0-15");
        return false;
    }
    if (StartPlusCountExceedsDomain(block.startPosition, static_cast<std::size_t>(block.endCc) - block.startCc)) {
        SetReason(reason, "encoder block start position is too large for its cell count");
        return false;
    }

    std::vector<EncoderMidiMapping> result;
    const std::size_t count = static_cast<std::size_t>(block.endCc) - block.startCc;
    result.reserve(count);
    for (std::size_t ix = 0; ix < count; ++ix) {
        EncoderMidiMapping mapping;
        mapping.control.channel = block.channel;
        mapping.control.cc = static_cast<std::uint8_t>(block.startCc + ix);
        mapping.slotIx = block.slotIx;
        mapping.position = block.startPosition + ix;
        result.push_back(mapping);
    }
    out = std::move(result);
    return true;
}

bool ExpandAnalogBlock(const AnalogBlock& block, std::vector<AnalogMidiMapping>& out, std::string* reason) {
    if (block.endCc <= block.startCc) {
        SetReason(reason, "analog block cc range must be non-empty (endCc > startCc)");
        return false;
    }
    if (block.endCc - 1 > 127 || block.startCc > 127) {
        SetReason(reason, "analog block cc range must fit the 0-127 MIDI CC domain");
        return false;
    }
    if (!ChannelValid(block.channel)) {
        SetReason(reason, "analog block channel must be an integer 0-15");
        return false;
    }
    if (StartPlusCountExceedsDomain(block.startGestureIx, static_cast<std::size_t>(block.endCc) - block.startCc)) {
        SetReason(reason, "analog block start gesture index is too large for its cell count");
        return false;
    }

    std::vector<AnalogMidiMapping> result;
    const std::size_t count = static_cast<std::size_t>(block.endCc) - block.startCc;
    result.reserve(count);
    for (std::size_t ix = 0; ix < count; ++ix) {
        AnalogMidiMapping mapping;
        mapping.control.channel = block.channel;
        mapping.control.cc = static_cast<std::uint8_t>(block.startCc + ix);
        mapping.gestureIx = block.startGestureIx + ix;
        result.push_back(mapping);
    }
    out = std::move(result);
    return true;
}

namespace {

MessageIn PressMessageFor(BlockableMessage message, std::size_t arg, std::size_t bankSlotIx) {
    switch (message) {
        case BlockableMessage::SceneSelect:
            return MessageIn::SceneSelect(0, arg);
        case BlockableMessage::BankSelect:
            return MessageIn::SelectParamBank(0, bankSlotIx, arg);
        case BlockableMessage::GestureSelect:
            return MessageIn::SetGestureSelect(0, arg, true);
    }
    return MessageIn::Clock(0);
}

std::optional<MessageIn> ReleaseMessageFor(BlockableMessage message, std::size_t arg) {
    if (message == BlockableMessage::GestureSelect) {
        return MessageIn::SetGestureSelect(0, arg, false);
    }
    return std::nullopt;
}

// Enumerates the inclusive rectangle [startX,endX] x rows(startY..endY,
// stepping +-1) in row-major (x ascending within a row, rows in traversal
// order) or column-major (y within startY..endY for each x, x ascending)
// order, invoking `visit(x, y, cellIndex)` for each cell.
template <typename Visit>
bool VisitRectangle(int startX, int endX, int startY, int endY, bool rowMajor, Visit&& visit) {
    if (endX < startX) {
        return false;
    }
    const int yDir = (startY <= endY) ? 1 : -1;
    const std::size_t width = static_cast<std::size_t>(endX - startX) + 1;
    const std::size_t height = (startY <= endY) ? (static_cast<std::size_t>(endY - startY) + 1)
                                                 : (static_cast<std::size_t>(startY - endY) + 1);

    std::size_t cellIndex = 0;
    if (rowMajor) {
        for (std::size_t row = 0; row < height; ++row) {
            const int y = startY + static_cast<int>(row) * yDir;
            for (std::size_t col = 0; col < width; ++col) {
                const int x = startX + static_cast<int>(col);
                visit(x, y, cellIndex);
                ++cellIndex;
            }
        }
    } else {
        for (std::size_t col = 0; col < width; ++col) {
            const int x = startX + static_cast<int>(col);
            for (std::size_t row = 0; row < height; ++row) {
                const int y = startY + static_cast<int>(row) * yDir;
                visit(x, y, cellIndex);
                ++cellIndex;
            }
        }
    }
    return true;
}

}  // namespace

bool ExpandSystemBlock(const SystemBlock& block, std::vector<MidiControllerSystemMessageAssociation>& out,
                       std::string* reason) {
    if (block.kind == MidiProfileKind::MfTwister) {
        SetReason(reason, "twister system messages never block (single side buttons only)");
        return false;
    }
    // Finding 2: expansion mirrors the edit rules -- refuse channel > 15
    // all-or-nothing. Launchpad's form carries no channel field at all, so
    // this only applies to WrldBldr and Generic.
    if (block.kind != MidiProfileKind::Launchpad && !ChannelValid(block.channel)) {
        SetReason(reason, "system block channel must be an integer 0-15");
        return false;
    }
    // Finding 3: startArg + cellIndex can wrap std::size_t across the whole
    // cell range -- refuse up front rather than risk a wrapped arg on some
    // interior cell.
    if (StartPlusCountExceedsDomain(block.startArg, block.CellCount())) {
        SetReason(reason, "system block start argument is too large for its cell count");
        return false;
    }

    std::vector<MidiControllerSystemMessageAssociation> result;

    auto buildCell = [&](std::size_t cellIndex) {
        const std::size_t arg = block.startArg + cellIndex;
        MidiControllerSystemMessageAssociation association;
        association.press = PressMessageFor(block.message, arg, block.bankSlotIx);
        association.release = ReleaseMessageFor(block.message, arg);
        association.feedback = association.press;
        association.outputFeedback = block.outputFeedback;
        return association;
    };

    if (block.kind == MidiProfileKind::WrldBldr || block.kind == MidiProfileKind::Launchpad) {
        if (block.endX < block.startX) {
            SetReason(reason, "system block x range must be non-empty (endX >= startX)");
            return false;
        }
        bool coordinatesValid = true;
        bool visited = VisitRectangle(
            block.startX, block.endX, block.startY, block.endY, block.rowMajor,
            [&](int x, int y, std::size_t cellIndex) {
                if (block.kind == MidiProfileKind::WrldBldr) {
                    if (x < 0 || x > 7 || y < 0 || y > 7) {
                        coordinatesValid = false;
                        return;
                    }
                    MidiControllerSystemMessageAssociation association = buildCell(cellIndex);
                    const WrldBldrSystemPosition position{.channel = block.channel,
                                                          .x = static_cast<std::uint8_t>(x),
                                                          .y = static_cast<std::uint8_t>(y)};
                    association.wrldBldrPosition = position;
                    association.control =
                        MidiControlAddress{.channel = block.channel,
                                           .cc = WrldBldrPositionToCC(position.x, position.y)};
                    result.push_back(std::move(association));
                } else {
                    // Finding 4: shape-checked against and stamped with the
                    // block's own launchpadController variant -- previously
                    // hardcoded to LaunchpadX regardless of the block's
                    // actual variant, so e.g. ProMk3-only edge coordinates
                    // (x=-1, or y=-1 at x=8/9) were wrongly rejected for a
                    // ProMk3 block, and a LaunchpadX/MiniMk3 block could
                    // wrongly accept coordinates the slot's real controller
                    // doesn't support.
                    if (!LaunchpadShapeSupports(block.launchpadController, x, y)) {
                        coordinatesValid = false;
                        return;
                    }
                    MidiControllerSystemMessageAssociation association = buildCell(cellIndex);
                    association.launchpadPosition =
                        LaunchpadGridPosition{.controller = block.launchpadController, .x = x, .y = y};
                    result.push_back(std::move(association));
                }
            });
        if (!visited) {
            SetReason(reason, "system block rectangle is empty");
            return false;
        }
        if (!coordinatesValid) {
            SetReason(reason, block.kind == MidiProfileKind::WrldBldr
                                  ? "wrldbldr coordinate is outside the 0-7 grid"
                                  : "launchpad coordinate is outside this controller's grid");
            return false;
        }
    } else {
        // Generic (1-D cc run).
        if (block.endCc <= block.startCc) {
            SetReason(reason, "system block cc range must be non-empty (endCc > startCc)");
            return false;
        }
        if (block.endCc - 1 > 127) {
            SetReason(reason, "system block cc range must fit the 0-127 MIDI CC domain");
            return false;
        }
        const std::size_t count = static_cast<std::size_t>(block.endCc) - block.startCc;
        for (std::size_t ix = 0; ix < count; ++ix) {
            MidiControllerSystemMessageAssociation association = buildCell(ix);
            association.control =
                MidiControlAddress{.channel = block.channel, .cc = static_cast<std::uint8_t>(block.startCc + ix)};
            result.push_back(std::move(association));
        }
    }

    // Duplicate-address rejection within the block (all-or-nothing).
    for (std::size_t ix = 0; ix < result.size(); ++ix) {
        for (std::size_t jx = ix + 1; jx < result.size(); ++jx) {
            const bool sameControl =
                result[ix].control.has_value() && result[jx].control.has_value() &&
                *result[ix].control == *result[jx].control;
            const bool sameLaunchpad =
                result[ix].launchpadPosition.has_value() && result[jx].launchpadPosition.has_value() &&
                *result[ix].launchpadPosition == *result[jx].launchpadPosition;
            if (sameControl || sameLaunchpad) {
                SetReason(reason, "system block would produce duplicate addresses");
                return false;
            }
        }
    }

    out = std::move(result);
    return true;
}

std::vector<ReconstructedEncoderRow> ReconstructEncoderBlocks(const std::vector<EncoderMidiMapping>& mappings,
                                                               bool isPush) {
    std::vector<ReconstructedEncoderRow> rows;
    std::size_t ix = 0;
    while (ix < mappings.size()) {
        // Extend the run while slot/channel stay constant and position/cc
        // advance by exactly +1 from the previous cell (D4: "maximal run
        // where slot is constant, positions consecutive (+1), channel
        // constant, and cc consecutive with constant offset").
        std::size_t runEnd = ix + 1;
        while (runEnd < mappings.size()) {
            const EncoderMidiMapping& prev = mappings[runEnd - 1];
            const EncoderMidiMapping& cur = mappings[runEnd];
            const bool continues = cur.slotIx == prev.slotIx && cur.control.channel == prev.control.channel &&
                                   IsWrapSafeSuccessor(prev.position, cur.position) &&
                                   static_cast<int>(cur.control.cc) == static_cast<int>(prev.control.cc) + 1;
            if (!continues) {
                break;
            }
            ++runEnd;
        }

        const std::size_t runLength = runEnd - ix;
        ReconstructedEncoderRow row;
        if (runLength >= 2) {
            row.isBlock = true;
            row.block.isPush = isPush;
            row.block.channel = mappings[ix].control.channel;
            row.block.startCc = mappings[ix].control.cc;
            row.block.endCc = static_cast<std::uint8_t>(mappings[ix].control.cc + runLength);
            row.block.slotIx = mappings[ix].slotIx;
            row.block.startPosition = mappings[ix].position;
            for (std::size_t k = ix; k < runEnd; ++k) {
                row.indices.push_back(k);
            }
            rows.push_back(std::move(row));
            ix = runEnd;
        } else {
            row.isBlock = false;
            row.indices.push_back(ix);
            rows.push_back(std::move(row));
            ++ix;
        }
    }
    return rows;
}

std::vector<ReconstructedAnalogRow> ReconstructAnalogBlocks(const std::vector<AnalogMidiMapping>& mappings) {
    std::vector<ReconstructedAnalogRow> rows;
    std::size_t ix = 0;
    while (ix < mappings.size()) {
        std::size_t runEnd = ix + 1;
        while (runEnd < mappings.size()) {
            const AnalogMidiMapping& prev = mappings[runEnd - 1];
            const AnalogMidiMapping& cur = mappings[runEnd];
            const bool continues = cur.control.channel == prev.control.channel &&
                                   IsWrapSafeSuccessor(prev.gestureIx, cur.gestureIx) &&
                                   static_cast<int>(cur.control.cc) == static_cast<int>(prev.control.cc) + 1;
            if (!continues) {
                break;
            }
            ++runEnd;
        }

        const std::size_t runLength = runEnd - ix;
        ReconstructedAnalogRow row;
        if (runLength >= 2) {
            row.isBlock = true;
            row.block.channel = mappings[ix].control.channel;
            row.block.startCc = mappings[ix].control.cc;
            row.block.endCc = static_cast<std::uint8_t>(mappings[ix].control.cc + runLength);
            row.block.startGestureIx = mappings[ix].gestureIx;
            for (std::size_t k = ix; k < runEnd; ++k) {
                row.indices.push_back(k);
            }
            rows.push_back(std::move(row));
            ix = runEnd;
        } else {
            row.isBlock = false;
            row.indices.push_back(ix);
            rows.push_back(std::move(row));
            ++ix;
        }
    }
    return rows;
}

namespace {

// The blockable message type this association's press carries, or nullopt
// for anything else (non-blockable types, per sru-10's "mappings fitting no
// block ... including all non-blockable message types").
std::optional<BlockableMessage> ClassifyBlockable(const MidiControllerSystemMessageAssociation& association) {
    switch (association.press.type) {
        case MessageIn::Type::SceneSelect:
            return BlockableMessage::SceneSelect;
        case MessageIn::Type::SelectParamBank:
            return BlockableMessage::BankSelect;
        case MessageIn::Type::SetGestureSelect:
            return BlockableMessage::GestureSelect;
        default:
            return std::nullopt;
    }
}

std::size_t BlockableArg(const MidiControllerSystemMessageAssociation& association, BlockableMessage message) {
    switch (message) {
        case BlockableMessage::SceneSelect:
            return association.press.sceneIx;
        case BlockableMessage::BankSelect:
            return association.press.bankIx;
        case BlockableMessage::GestureSelect:
            return association.press.gestureIx;
    }
    return 0;
}

// True when cell `cur` satisfies the pairwise checks to continue a candidate
// run started by cells classified the same as `prev` (D4 point 1): arg
// exactly +1 from prev's, same bankSlotIx (BankSelect only), and constant
// outputFeedback.
bool ContinuesCandidateRun(const MidiControllerSystemMessageAssociation& prev,
                           const MidiControllerSystemMessageAssociation& cur, BlockableMessage message) {
    const std::size_t prevArg = BlockableArg(prev, message);
    const std::size_t curArg = BlockableArg(cur, message);
    // Finding 3: guard against `prevArg + 1` wrapping std::size_t (this
    // path is unreachable through ReconstructSystemBlocks's own defensive
    // sort, which always places a SIZE_MAX arg last, but the guard keeps
    // this shared helper correct independent of caller sort order).
    if (!IsWrapSafeSuccessor(prevArg, curArg)) {
        return false;
    }
    if (message == BlockableMessage::BankSelect && prev.press.slotIx != cur.press.slotIx) {
        return false;
    }
    if (cur.outputFeedback != prev.outputFeedback) {
        return false;
    }
    return true;
}

// A single cell passes the run-membership checks that don't depend on its
// neighbor: feedback == press, and the release pattern matches its type
// (paired set-false for gesture-select, absent for scene/bank-select).
bool CellSatisfiesRunPattern(const MidiControllerSystemMessageAssociation& association, BlockableMessage message) {
    const MessageIn& press = association.press;
    const MessageIn& feedback = association.feedback;
    if (feedback.type != press.type) {
        return false;
    }
    switch (message) {
        case BlockableMessage::SceneSelect:
            if (feedback.sceneIx != press.sceneIx) {
                return false;
            }
            if (association.release.has_value()) {
                return false;  // scene-select release must be absent
            }
            break;
        case BlockableMessage::BankSelect:
            if (feedback.slotIx != press.slotIx || feedback.bankIx != press.bankIx) {
                return false;
            }
            if (association.release.has_value()) {
                return false;  // bank-select release must be absent
            }
            break;
        case BlockableMessage::GestureSelect:
            if (!press.hasBoolValue || press.boolValue != true) {
                return false;  // press must be the set-TRUE variant
            }
            if (feedback.gestureIx != press.gestureIx || feedback.boolValue != press.boolValue) {
                return false;
            }
            if (!association.release.has_value()) {
                return false;  // gesture-select requires a paired release
            }
            if (association.release->type != MessageIn::Type::SetGestureSelect ||
                association.release->gestureIx != press.gestureIx || association.release->boolValue != false) {
                return false;  // must be the paired set-false variant
            }
            break;
    }
    return true;
}

// Fits maximal consecutive-cc strips on one channel within [runStart, runEnd)
// of `sorted`, emitting one block per strip of length >= 2 (or an individual
// row per single-cell remainder). Used for the generic (1-D) address form.
void FitGenericStrips(const std::vector<MidiControllerSystemMessageAssociation>& sorted, std::size_t runStart,
                      std::size_t runEnd, BlockableMessage message, std::vector<ReconstructedSystemRow>& out) {
    std::size_t ix = runStart;
    while (ix < runEnd) {
        std::size_t stripEnd = ix + 1;
        while (stripEnd < runEnd) {
            const auto& prev = sorted[stripEnd - 1];
            const auto& cur = sorted[stripEnd];
            const bool sameChannel =
                prev.control.has_value() && cur.control.has_value() && prev.control->channel == cur.control->channel;
            const bool ccConsecutive = prev.control.has_value() && cur.control.has_value() &&
                                       static_cast<int>(cur.control->cc) == static_cast<int>(prev.control->cc) + 1;
            if (!sameChannel || !ccConsecutive) {
                break;
            }
            ++stripEnd;
        }

        const std::size_t stripLength = stripEnd - ix;
        ReconstructedSystemRow row;
        if (stripLength >= 2) {
            row.isBlock = true;
            row.block.kind = MidiProfileKind::Generic;
            row.block.message = message;
            row.block.startArg = BlockableArg(sorted[ix], message);
            row.block.bankSlotIx = sorted[ix].press.slotIx;
            row.block.channel = sorted[ix].control->channel;
            row.block.startCc = sorted[ix].control->cc;
            row.block.endCc = static_cast<std::uint8_t>(sorted[ix].control->cc + stripLength);
            row.block.outputFeedback = sorted[ix].outputFeedback;
            for (std::size_t k = ix; k < stripEnd; ++k) {
                row.indices.push_back(k);
            }
            out.push_back(std::move(row));
        } else {
            row.isBlock = false;
            row.indices.push_back(ix);
            out.push_back(std::move(row));
        }
        ix = stripEnd;
    }
}

// Fits greedy rectangles within [runStart, runEnd) of `sorted`, all of which
// share a WrldBldr or Launchpad position (D4 point 2). First groups the run
// into maximal x-ascending-consecutive "physical rows" (constant y and
// channel); a rectangle is then a maximal sequence of such rows with
// identical width/x-start/channel, the second row (if any) fixing the y
// step direction (+-1, so the default WRLD.Bldr bank grid's y=3 -> y=2
// descending pair is handled the same as an ascending one).
void FitRectangles(const std::vector<MidiControllerSystemMessageAssociation>& sorted, std::size_t runStart,
                   std::size_t runEnd, BlockableMessage message, MidiProfileKind kind,
                   std::vector<ReconstructedSystemRow>& out) {
    auto xOf = [&](std::size_t ix) -> int {
        return kind == MidiProfileKind::WrldBldr ? sorted[ix].wrldBldrPosition->x : sorted[ix].launchpadPosition->x;
    };
    auto yOf = [&](std::size_t ix) -> int {
        return kind == MidiProfileKind::WrldBldr ? sorted[ix].wrldBldrPosition->y : sorted[ix].launchpadPosition->y;
    };
    auto channelOf = [&](std::size_t ix) -> std::uint8_t {
        return sorted[ix].control.has_value() ? sorted[ix].control->channel : 0;
    };
    // Finding 4: Launchpad cells also carry a controller variant
    // (LaunchpadGridPosition::controller); a run/rectangle requires it
    // constant throughout, same as x/y/channel -- mixed variants stay
    // individual. Meaningless (always LaunchpadX, ignored) for WrldBldr.
    auto launchpadControllerOf = [&](std::size_t ix) -> LaunchpadController {
        return kind == MidiProfileKind::Launchpad ? sorted[ix].launchpadPosition->controller
                                                  : LaunchpadController::LaunchpadX;
    };

    struct Row {
        std::size_t start;  // index into `sorted`
        std::size_t count;
        int x0;
        int y;
        std::uint8_t channel;
        LaunchpadController launchpadController;
    };
    std::vector<Row> physicalRows;
    {
        std::size_t ix = runStart;
        while (ix < runEnd) {
            std::size_t stripEnd = ix + 1;
            while (stripEnd < runEnd && yOf(stripEnd) == yOf(ix) && channelOf(stripEnd) == channelOf(ix) &&
                  launchpadControllerOf(stripEnd) == launchpadControllerOf(ix) &&
                  xOf(stripEnd) == xOf(stripEnd - 1) + 1) {
                ++stripEnd;
            }
            physicalRows.push_back({ix, stripEnd - ix, xOf(ix), yOf(ix), channelOf(ix), launchpadControllerOf(ix)});
            ix = stripEnd;
        }
    }

    std::size_t rowIx = 0;
    while (rowIx < physicalRows.size()) {
        const Row& first = physicalRows[rowIx];
        std::size_t height = 1;
        int yDir = 0;
        if (rowIx + 1 < physicalRows.size()) {
            const Row& second = physicalRows[rowIx + 1];
            const int delta = static_cast<int>(second.y) - static_cast<int>(first.y);
            if (second.count == first.count && second.x0 == first.x0 && second.channel == first.channel &&
                second.launchpadController == first.launchpadController && (delta == 1 || delta == -1)) {
                yDir = delta;
                height = 2;
                std::size_t nextRowIx = rowIx + 2;
                while (nextRowIx < physicalRows.size()) {
                    const Row& candidate = physicalRows[nextRowIx];
                    const Row& prevRow = physicalRows[nextRowIx - 1];
                    const int candidateDelta = static_cast<int>(candidate.y) - static_cast<int>(prevRow.y);
                    if (candidate.count == first.count && candidate.x0 == first.x0 &&
                        candidate.channel == first.channel &&
                        candidate.launchpadController == first.launchpadController && candidateDelta == yDir) {
                        ++height;
                        ++nextRowIx;
                    } else {
                        break;
                    }
                }
            }
        }

        const std::size_t width = first.count;
        const std::size_t cellCount = width * height;
        if (cellCount >= 2) {
            ReconstructedSystemRow row;
            row.isBlock = true;
            row.block.kind = kind;
            row.block.message = message;
            row.block.startArg = BlockableArg(sorted[first.start], message);
            row.block.bankSlotIx = sorted[first.start].press.slotIx;
            row.block.rowMajor = true;
            row.block.outputFeedback = sorted[first.start].outputFeedback;
            row.block.channel = first.channel;
            row.block.launchpadController = first.launchpadController;
            row.block.startX = first.x0;
            row.block.endX = first.x0 + static_cast<int>(width) - 1;
            row.block.startY = first.y;
            row.block.endY = height == 1 ? first.y : first.y + yDir * static_cast<int>(height - 1);
            for (std::size_t r = 0; r < height; ++r) {
                const Row& physRow = physicalRows[rowIx + r];
                for (std::size_t c = 0; c < physRow.count; ++c) {
                    row.indices.push_back(physRow.start + c);
                }
            }
            out.push_back(std::move(row));
            rowIx += height;
        } else {
            for (std::size_t c = 0; c < first.count; ++c) {
                ReconstructedSystemRow row;
                row.isBlock = false;
                row.indices.push_back(first.start + c);
                out.push_back(std::move(row));
            }
            ++rowIx;
        }
    }
}

}  // namespace

std::vector<ReconstructedSystemRow> ReconstructSystemBlocks(
    const std::vector<MidiControllerSystemMessageAssociation>& associations, MidiProfileKind kind) {
    std::vector<ReconstructedSystemRow> rows;

    // Sort a defensive copy per SystemMessageSortKey (sru-9 "unsorted input
    // still reconstructs") -- indices in the result refer to positions in
    // this sorted view.
    MidiControllerProfileConfig scratch;
    scratch.systemMessages = associations;
    NormalizeMidiProfileConfig(scratch, kind);
    const std::vector<MidiControllerSystemMessageAssociation>& sorted = scratch.systemMessages;

    if (kind == MidiProfileKind::MfTwister) {
        // Twister never blocks (D4 point 3).
        for (std::size_t ix = 0; ix < sorted.size(); ++ix) {
            ReconstructedSystemRow row;
            row.isBlock = false;
            row.indices.push_back(ix);
            rows.push_back(std::move(row));
        }
        return rows;
    }

    // Duplicate-address cells are excluded from candidate runs entirely
    // (checked against every OTHER cell in the whole sorted input, not just
    // within a candidate run) -- "duplicate addresses ... simply fail the
    // run checks and pass through as individual rows" (D4 round-trip note).
    std::vector<bool> hasDuplicateAddress(sorted.size(), false);
    for (std::size_t ix = 0; ix < sorted.size(); ++ix) {
        for (std::size_t jx = ix + 1; jx < sorted.size(); ++jx) {
            bool same = false;
            if (kind == MidiProfileKind::Launchpad) {
                same = sorted[ix].launchpadPosition.has_value() && sorted[jx].launchpadPosition.has_value() &&
                      *sorted[ix].launchpadPosition == *sorted[jx].launchpadPosition;
            } else {
                same = sorted[ix].control.has_value() && sorted[jx].control.has_value() &&
                      *sorted[ix].control == *sorted[jx].control;
            }
            if (same) {
                hasDuplicateAddress[ix] = true;
                hasDuplicateAddress[jx] = true;
            }
        }
    }

    auto hasRequiredAddress = [&](std::size_t ix) {
        if (kind == MidiProfileKind::WrldBldr) {
            return sorted[ix].wrldBldrPosition.has_value();
        }
        if (kind == MidiProfileKind::Launchpad) {
            return sorted[ix].launchpadPosition.has_value();
        }
        return sorted[ix].control.has_value();
    };

    std::size_t ix = 0;
    while (ix < sorted.size()) {
        const std::optional<BlockableMessage> classification = ClassifyBlockable(sorted[ix]);
        const bool eligible = classification.has_value() && !hasDuplicateAddress[ix] && hasRequiredAddress(ix) &&
                              CellSatisfiesRunPattern(sorted[ix], *classification);
        if (!eligible) {
            ReconstructedSystemRow row;
            row.isBlock = false;
            row.indices.push_back(ix);
            rows.push_back(std::move(row));
            ++ix;
            continue;
        }

        std::size_t runEnd = ix + 1;
        while (runEnd < sorted.size()) {
            const std::optional<BlockableMessage> nextClass = ClassifyBlockable(sorted[runEnd]);
            if (nextClass != classification || hasDuplicateAddress[runEnd] || !hasRequiredAddress(runEnd) ||
                !CellSatisfiesRunPattern(sorted[runEnd], *classification) ||
                !ContinuesCandidateRun(sorted[runEnd - 1], sorted[runEnd], *classification)) {
                break;
            }
            ++runEnd;
        }

        if (kind == MidiProfileKind::Generic) {
            FitGenericStrips(sorted, ix, runEnd, *classification, rows);
        } else {
            FitRectangles(sorted, ix, runEnd, *classification, kind, rows);
        }
        ix = runEnd;
    }

    return rows;
}

}  // namespace synth
