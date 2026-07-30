#pragma once

#include "synth/Color.hpp"
#include "synth/PortableUI.hpp"

namespace synth::pagestyle {

// Seed for Task 11's RuntimePages.hpp producer conversion, recovered from the
// JUCE backend variant palette deleted after cea7fa88.
inline constexpr float kDefaultTextSize = 13.0f;
inline constexpr float kTitleTextSize = 18.0f;

inline constexpr Color kDefaultText = Color::Rgb(255, 255, 255);
inline constexpr Color kDisabledText = Color::Rgb(125, 132, 138);
inline constexpr Color kDangerText = Color::Rgb(255, 160, 148);
inline constexpr Color kMutedText = Color::Rgb(178, 188, 196);
inline constexpr Color kMutedTitleText = Color::Rgb(194, 202, 208);

inline constexpr Color kDefaultButton = Color::Rgb(42, 47, 52);
inline constexpr Color kDisabledButton = Color::Rgb(45, 49, 53);
inline constexpr Color kSelectedButton = Color::Rgb(54, 91, 110);
inline constexpr Color kPrimaryButton = Color::Rgb(57, 106, 127);
inline constexpr Color kListRowButton = Color::Rgb(34, 39, 44);

inline constexpr Color kSelectedPanel = Color::Rgb(53, 80, 96);
inline constexpr Color kListRowPanel = Color::Rgb(34, 39, 44);
inline constexpr Color kDefaultPanel = Color::Rgb(30, 34, 38);

// File-page panel chrome, recovered from the hand-rolled draw commands the page
// carried before its rebuild. Each panel is a fill plus a one-pixel border of
// the matching outline colour.
inline constexpr Color kHeaderPanelFill = Color::Rgb(29, 33, 37);
inline constexpr Color kHeaderPanelBorder = Color::Rgb(54, 61, 68);
inline constexpr Color kBrowserPanelFill = Color::Rgb(24, 28, 32);
inline constexpr Color kBrowserPanelBorder = Color::Rgb(63, 73, 82);
inline constexpr Color kIdlePanelFill = Color::Rgb(23, 26, 29);
inline constexpr Color kIdlePanelBorder = Color::Rgb(48, 55, 62);
inline constexpr float kPanelCornerRadius = 6.0f;
inline constexpr float kPanelBorderWidth = 1.0f;

inline constexpr ui::TextStyle kTitleTextStyle{kTitleTextSize, kDefaultText, ui::TextAlign::Left};
inline constexpr ui::TextStyle kDefaultTextStyle{kDefaultTextSize, kDefaultText, ui::TextAlign::Left};
inline constexpr ui::TextStyle kDisabledTextStyle{kDefaultTextSize, kDisabledText, ui::TextAlign::Left};
inline constexpr ui::TextStyle kDangerTextStyle{kDefaultTextSize, kDangerText, ui::TextAlign::Left};
inline constexpr ui::TextStyle kMutedTextStyle{kDefaultTextSize, kMutedText, ui::TextAlign::Left};
inline constexpr ui::TextStyle kMutedTitleTextStyle{kTitleTextSize, kMutedTitleText, ui::TextAlign::Left};

}  // namespace synth::pagestyle
