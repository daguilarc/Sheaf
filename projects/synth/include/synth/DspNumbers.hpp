#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <numeric>

namespace synth {

template<typename T, std::size_t Size>
struct NaryNumber {
    std::array<T, Size> lanes{};

    constexpr T& operator[](std::size_t index) { return lanes[index]; }
    constexpr const T& operator[](std::size_t index) const { return lanes[index]; }
    static constexpr std::size_t Count() { return Size; }

    constexpr NaryNumber& operator+=(const NaryNumber& other) {
        for (std::size_t i = 0; i < Size; ++i) {
            lanes[i] += other.lanes[i];
        }
        return *this;
    }

    constexpr NaryNumber& operator-=(const NaryNumber& other) {
        for (std::size_t i = 0; i < Size; ++i) {
            lanes[i] -= other.lanes[i];
        }
        return *this;
    }

    constexpr NaryNumber& operator*=(const NaryNumber& other) {
        for (std::size_t i = 0; i < Size; ++i) {
            lanes[i] *= other.lanes[i];
        }
        return *this;
    }

    constexpr NaryNumber& operator/=(const NaryNumber& other) {
        for (std::size_t i = 0; i < Size; ++i) {
            lanes[i] /= other.lanes[i];
        }
        return *this;
    }

    constexpr NaryNumber& operator*=(T scalar) {
        for (auto& lane : lanes) {
            lane *= scalar;
        }
        return *this;
    }

    constexpr NaryNumber& operator/=(T scalar) {
        for (auto& lane : lanes) {
            lane /= scalar;
        }
        return *this;
    }

    T Sum() const {
        return std::accumulate(lanes.begin(), lanes.end(), T{});
    }

    T Average() const {
        return Sum() / static_cast<T>(Size);
    }

    NaryNumber ModOne() const {
        NaryNumber result;
        for (std::size_t i = 0; i < Size; ++i) {
            T wrapped = lanes[i] - std::floor(lanes[i]);
            result.lanes[i] = wrapped;
        }
        return result;
    }
};

template<typename T, std::size_t Size>
constexpr NaryNumber<T, Size> operator+(NaryNumber<T, Size> lhs, const NaryNumber<T, Size>& rhs) {
    lhs += rhs;
    return lhs;
}

template<typename T, std::size_t Size>
constexpr NaryNumber<T, Size> operator-(NaryNumber<T, Size> lhs, const NaryNumber<T, Size>& rhs) {
    lhs -= rhs;
    return lhs;
}

template<typename T, std::size_t Size>
constexpr NaryNumber<T, Size> operator*(NaryNumber<T, Size> lhs, const NaryNumber<T, Size>& rhs) {
    lhs *= rhs;
    return lhs;
}

template<typename T, std::size_t Size>
constexpr NaryNumber<T, Size> operator/(NaryNumber<T, Size> lhs, const NaryNumber<T, Size>& rhs) {
    lhs /= rhs;
    return lhs;
}

template<typename T, std::size_t Size>
constexpr NaryNumber<T, Size> operator*(NaryNumber<T, Size> lhs, T scalar) {
    lhs *= scalar;
    return lhs;
}

template<typename T, std::size_t Size>
constexpr NaryNumber<T, Size> operator*(T scalar, NaryNumber<T, Size> rhs) {
    rhs *= scalar;
    return rhs;
}

template<typename T, std::size_t Size>
constexpr NaryNumber<T, Size> operator/(NaryNumber<T, Size> lhs, T scalar) {
    lhs /= scalar;
    return lhs;
}

using StereoFloat = NaryNumber<float, 2>;
using StereoDouble = NaryNumber<double, 2>;
using QuadFloat = NaryNumber<float, 4>;
using QuadDouble = NaryNumber<double, 4>;

} // namespace synth
