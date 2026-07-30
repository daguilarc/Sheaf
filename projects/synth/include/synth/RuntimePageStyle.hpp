#pragma once

#include "synth/Color.hpp"

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

}  // namespace synth::pagestyle
