#pragma once

#include "synth/PatchPersistence.hpp"
#include "synth/RuntimePages.hpp"

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>

namespace synth_browser {

// The browser capture states the launcher realm publishes through
// `synth_browser_set_audio_input_source` / `synth_browser_clear_audio_input_source`.
// The numeric order IS the ABI status code and is mirrored by
// `browser/src/audio.ts`, so entries may be appended but never reordered.
//
// `InsecureContext` through `AudioContextUnavailable` were appended after the
// generic `PrerequisiteBlocked` so sbw-10's "report the missing prerequisite by
// name" is answered on the Audio page itself rather than only in a JavaScript
// diagnostic. Appending is deliberately compatible: `negotiateRuntimeVersions`
// requires the module and the launcher runtime to declare the same browser ABI
// version, so a module that predates these codes is never handed one. The
// generic `PrerequisiteBlocked` stays valid for the same reason -- an already
// shipped code is not withdrawn -- even though the host now names its causes.
enum class BrowserAudioInputStatus : std::uint32_t {
    NotRequested,
    Requesting,
    Online,
    PermissionDenied,
    ApiUnavailable,
    PrerequisiteBlocked,
    StreamEnded,
    ChannelCountUnreported,
    InsecureContext,
    PermissionsPolicyBlocked,
    AudioContextUnavailable
};

inline bool BrowserAudioInputStatusCodeValid(std::uint32_t statusCode) noexcept
{
    switch (static_cast<BrowserAudioInputStatus>(statusCode))
    {
        case BrowserAudioInputStatus::NotRequested:
        case BrowserAudioInputStatus::Requesting:
        case BrowserAudioInputStatus::Online:
        case BrowserAudioInputStatus::PermissionDenied:
        case BrowserAudioInputStatus::ApiUnavailable:
        case BrowserAudioInputStatus::PrerequisiteBlocked:
        case BrowserAudioInputStatus::StreamEnded:
        case BrowserAudioInputStatus::ChannelCountUnreported:
        case BrowserAudioInputStatus::InsecureContext:
        case BrowserAudioInputStatus::PermissionsPolicyBlocked:
        case BrowserAudioInputStatus::AudioContextUnavailable:
            return true;
    }
    return false;
}

// What the Audio page knows about browser capture: the application's own
// request, the count the host actually published (already clamped to the
// request), and the last state the launcher realm reported. Every field is
// observable outside the realtime callback only.
struct BrowserAudioInputState
{
    std::size_t requestedChannels = 0;
    std::size_t activeChannels = 0;
    BrowserAudioInputStatus status = BrowserAudioInputStatus::NotRequested;
};

// Capture is feeding the worklet input bus. A live-but-short capture is a
// shortfall, not an outage, so it reports its counts without offering retry.
inline bool BrowserAudioInputCaptureLive(BrowserAudioInputStatus status) noexcept
{
    return status == BrowserAudioInputStatus::Online ||
           status == BrowserAudioInputStatus::ChannelCountUnreported;
}

// Capture is offline and only a user gesture may re-run it (sbw-4, sbw-10):
// there is no automatic or realtime retry, so `Retry Input` is the only way
// back from any of these states. `Requesting` is deliberately excluded -- a
// request already in flight must not offer a second prompt.
inline bool BrowserAudioInputOffline(BrowserAudioInputStatus status) noexcept
{
    switch (status)
    {
        case BrowserAudioInputStatus::NotRequested:
        case BrowserAudioInputStatus::PermissionDenied:
        case BrowserAudioInputStatus::ApiUnavailable:
        case BrowserAudioInputStatus::PrerequisiteBlocked:
        case BrowserAudioInputStatus::StreamEnded:
        case BrowserAudioInputStatus::InsecureContext:
        case BrowserAudioInputStatus::PermissionsPolicyBlocked:
        case BrowserAudioInputStatus::AudioContextUnavailable:
            return true;
        case BrowserAudioInputStatus::Requesting:
        case BrowserAudioInputStatus::Online:
        case BrowserAudioInputStatus::ChannelCountUnreported:
            return false;
    }
    return true;
}

inline std::string BrowserAudioInputStatusText(BrowserAudioInputStatus status)
{
    switch (status)
    {
        case BrowserAudioInputStatus::NotRequested:
            return "microphone capture not started";
        case BrowserAudioInputStatus::Requesting:
            return "requesting microphone access";
        case BrowserAudioInputStatus::Online:
            return {};
        case BrowserAudioInputStatus::PermissionDenied:
            return "microphone permission denied";
        case BrowserAudioInputStatus::ApiUnavailable:
            return "microphone capture unavailable";
        case BrowserAudioInputStatus::PrerequisiteBlocked:
            return "microphone prerequisite unavailable";
        case BrowserAudioInputStatus::StreamEnded:
            return "microphone stream ended";
        case BrowserAudioInputStatus::ChannelCountUnreported:
            return "microphone channel count unreported";
        case BrowserAudioInputStatus::InsecureContext:
            return "microphone requires a secure context";
        case BrowserAudioInputStatus::PermissionsPolicyBlocked:
            return "microphone blocked by permissions policy";
        case BrowserAudioInputStatus::AudioContextUnavailable:
            return "microphone requires the launch-owned AudioContext";
    }
    return {};
}

// The diagnostic half of the status line. Shortfall is orthogonal to the
// capture state -- a device can be online, or online with an unreported count,
// and still supply fewer channels than the application asked for -- so it is
// appended rather than folded into a single state.
inline std::string BrowserAudioInputDetail(const BrowserAudioInputState& input)
{
    // An application that asked for no input makes no input claim at all, so it
    // gets no capture detail either: "capture not started" is only news to an
    // application that wanted capture. Guarding here keeps the page builder and
    // the services status line -- which composes this detail itself -- agreed.
    if (input.requestedChannels == 0)
    {
        return {};
    }
    std::string detail = BrowserAudioInputStatusText(input.status);
    if (BrowserAudioInputCaptureLive(input.status) && input.activeChannels < input.requestedChannels)
    {
        detail = detail.empty() ? "input channel shortfall" : detail + ", input channel shortfall";
    }
    return detail;
}

// The same stable requested/active line the JUCE runtime publishes (sru-3): the
// counts always lead, and whatever diagnostic is current follows them instead of
// displacing them. A zero-input application makes no input claim at all and gets
// exactly the detail it was given.
inline std::string ComposeBrowserAudioStatusLine(const BrowserAudioInputState& input,
                                                 const std::string& detail)
{
    if (input.requestedChannels == 0)
    {
        return detail;
    }
    std::string text = "Input requested " + std::to_string(input.requestedChannels) +
                       " / active " + std::to_string(input.activeChannels);
    if (!detail.empty())
    {
        text += " - " + detail;
    }
    return text;
}

inline synth::runtime_ui::AudioPageSnapshot BuildBrowserAudioSnapshot(
    const synth::AudioDeviceState& state,
    const BrowserAudioInputState& input = {})
{
    synth::runtime_ui::AudioPageSnapshot snapshot;
    snapshot.outputOptions = {{synth::runtime_ui::kSystemDefaultOptionId,
                               synth::runtime_ui::kSystemDefaultOptionLabel}};
    snapshot.selectedOutputId = synth::runtime_ui::kSystemDefaultOptionId;
    snapshot.showInputCombo = input.requestedChannels > 0;
    snapshot.inputOptions.clear();
    if (!snapshot.showInputCombo)
    {
        return snapshot;
    }
    // D6: System Default only. Browser device ids are privacy-scoped, so nothing
    // is enumerated here and a persisted name from another host still resolves to
    // the default rather than to a device this host cannot name.
    snapshot.inputOptions = {{synth::runtime_ui::kSystemDefaultOptionId,
                              synth::runtime_ui::kSystemDefaultOptionLabel}};
    snapshot.selectedInputId = synth::runtime_ui::Layout::SelectedDeviceOptionId(
        state.inputDeviceName, snapshot.inputOptions);
    snapshot.showInputRetry = BrowserAudioInputOffline(input.status);
    snapshot.statusLineText = ComposeBrowserAudioStatusLine(input, BrowserAudioInputDetail(input));
    return snapshot;
}

inline std::string BrowserOutputDeviceName(const std::string& optionId)
{
    if (optionId != synth::runtime_ui::kSystemDefaultOptionId)
    {
        throw std::invalid_argument("browser audio supports only system_default output");
    }
    return {};
}

inline std::string BrowserInputDeviceName(const std::string& optionId)
{
    if (optionId != synth::runtime_ui::kSystemDefaultOptionId)
    {
        throw std::invalid_argument("browser audio supports only system_default input");
    }
    return {};
}

}  // namespace synth_browser
