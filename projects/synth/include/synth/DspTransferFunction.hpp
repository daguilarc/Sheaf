#pragma once

#include <complex>

namespace synth {

struct TransferFunction {
    virtual ~TransferFunction() = default;
    virtual float FrequencyResponse(float normalizedFrequency) const = 0;
    virtual std::complex<float> TransferFunctionValue(float normalizedFrequency) const = 0;
};

} // namespace synth
