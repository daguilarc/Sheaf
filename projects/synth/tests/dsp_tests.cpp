#include "synth/DspBuffers.hpp"
#include "synth/DspDegrade.hpp"
#include "synth/DspFilters.hpp"
#include "synth/DspMath.hpp"
#include "synth/DspMetering.hpp"
#include "synth/DspNumbers.hpp"
#include "synth/DspOla.hpp"
#include "synth/DspOscillators.hpp"
#include "synth/DspResynthesis.hpp"
#include "synth/DspScope.hpp"
#include "synth/DspSpectral.hpp"
#include "synth/DspTransferFunction.hpp"
#include "synth/DspWavetable.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth DSP tests must not see JUCE headers"
#endif

#include <algorithm>
#include <cmath>
#include <complex>
#include <cstdint>
#include <exception>
#include <iostream>
#include <numbers>
#include <sstream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <vector>

namespace {

struct TestCase {
    const char* name;
    void (*fn)();
};

std::vector<TestCase>& Registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Register {
    Register(const char* name, void (*fn)()) {
        Registry().push_back({name, fn});
    }
};

#define TEST_CASE(name) \
    void name(); \
    Register reg_##name(#name, &name); \
    void name()

#define REQUIRE_TRUE(expr) \
    do { \
        if (!(expr)) { \
            std::ostringstream oss; \
            oss << __FILE__ << ":" << __LINE__ << " requirement failed: " #expr; \
            throw std::runtime_error(oss.str()); \
        } \
    } while (false)

void RequireNear(double actual, double expected, double tolerance, const char* expr) {
    if (std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

void RequireComplexNear(
    std::complex<float> actual,
    std::complex<float> expected,
    float tolerance,
    const char* expr) {
    RequireNear(actual.real(), expected.real(), tolerance, expr);
    RequireNear(actual.imag(), expected.imag(), tolerance, expr);
}

void RequireFinite(float actual, const char* expr) {
    if (!std::isfinite(actual)) {
        std::ostringstream oss;
        oss << expr << " expected finite value got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

} // namespace

TEST_CASE(smartgrid_dsp_public_headers_are_dependency_clean) {
    #ifdef JUCE_MAJOR_VERSION
    throw std::runtime_error("DSP headers must not include JUCE");
    #endif
    REQUIRE_TRUE(std::is_default_constructible_v<synth::BoundedAudioBuffer>);
    REQUIRE_TRUE(std::is_default_constructible_v<synth::BitCrusher>);
    REQUIRE_TRUE(std::is_default_constructible_v<synth::Meter>);
    REQUIRE_TRUE(std::is_default_constructible_v<synth::Ola<12>>);
}

TEST_CASE(bounded_audio_buffer_reads_fractional_midpoints_and_normalized_positions) {
    synth::BoundedAudioBuffer buffer;
    buffer.samples = {0.0f, 10.0f, 20.0f};

    REQUIRE_NEAR(buffer.ReadRealTime(0.5), 5.0f, 0.0001f);
    REQUIRE_NEAR(buffer.ReadRealTime(1.5), 15.0f, 0.0001f);
    REQUIRE_NEAR(buffer.ReadNormalized(0.25), 5.0f, 0.0001f);
    REQUIRE_NEAR(buffer.ReadNormalized(1.0), 20.0f, 0.0001f);
}

TEST_CASE(bounded_audio_buffer_computes_section_extrema_and_clears) {
    synth::BoundedAudioBuffer buffer;
    buffer.samples.resize(synth::BoundedAudioBuffer::kNumSections * 2, 0.0f);
    buffer.samples[0] = -0.25f;
    buffer.samples[1] = 0.5f;
    buffer.samples[buffer.samples.size() - 2] = -0.75f;
    buffer.samples[buffer.samples.size() - 1] = 0.25f;

    buffer.ComputeSectionExtrema();

    REQUIRE_NEAR(buffer.sectionMinimums[0], -0.25f, 0.0001f);
    REQUIRE_NEAR(buffer.sectionMaximums[0], 0.5f, 0.0001f);
    REQUIRE_NEAR(buffer.sectionMinimums[synth::BoundedAudioBuffer::kNumSections - 1], -0.75f, 0.0001f);
    REQUIRE_NEAR(buffer.sectionMaximums[synth::BoundedAudioBuffer::kNumSections - 1], 0.25f, 0.0001f);

    buffer.Clear();
    REQUIRE_TRUE(buffer.samples.empty());
    REQUIRE_NEAR(buffer.sectionMinimums[0], 0.0f, 0.0001f);
    REQUIRE_NEAR(buffer.sectionMaximums[0], 0.0f, 0.0001f);
}

TEST_CASE(rolling_buffer_reports_min_and_max_over_ring_storage) {
    synth::RollingBuffer<4> buffer;
    buffer.Write(1.0f);
    buffer.Write(-2.0f);
    buffer.Write(3.0f);
    buffer.Write(4.0f);

    REQUIRE_NEAR(buffer.Min(), -2.0f, 0.0001f);
    REQUIRE_NEAR(buffer.Max(), 4.0f, 0.0001f);

    buffer.Write(-5.0f);
    REQUIRE_NEAR(buffer.Min(), -5.0f, 0.0001f);
    REQUIRE_NEAR(buffer.Max(), 4.0f, 0.0001f);
}

TEST_CASE(buffer_resampler_copies_when_rates_match) {
    const std::vector<float> input{0.0f, 0.25f, -0.5f, 0.75f};
    std::vector<float> output(input.size(), 0.0f);
    std::size_t written = 0;

    REQUIRE_TRUE(synth::BufferResampler::OutputFrameCount(input.size(), 48000.0, 48000.0) == input.size());
    REQUIRE_TRUE(synth::BufferResampler::ResampleToRate(
        input.data(), input.size(), 48000.0, 48000.0, output.data(), output.size(), &written));

    REQUIRE_TRUE(written == input.size());
    for (std::size_t i = 0; i < input.size(); ++i) {
        REQUIRE_NEAR(output[i], input[i], 0.0001f);
    }
}

TEST_CASE(buffer_resampler_downsampling_attenuates_high_frequency_content) {
    auto downsampleRms = [](float normalizedFrequency) {
        constexpr std::size_t kInputSize = 4096;
        std::vector<float> input(kInputSize, 0.0f);
        for (std::size_t i = 0; i < input.size(); ++i) {
            input[i] = synth::DefaultDspMath::Sin2Pi(normalizedFrequency * static_cast<float>(i));
        }

        const std::size_t outputCount = synth::BufferResampler::OutputFrameCount(input.size(), 48000.0, 12000.0);
        std::vector<float> output(outputCount, 0.0f);
        std::size_t written = 0;
        REQUIRE_TRUE(synth::BufferResampler::ResampleToRate(
            input.data(), input.size(), 48000.0, 12000.0, output.data(), output.size(), &written));
        REQUIRE_TRUE(written == outputCount);

        double energy = 0.0;
        std::size_t measured = 0;
        for (std::size_t i = 128; i < output.size(); ++i) {
            energy += static_cast<double>(output[i]) * static_cast<double>(output[i]);
            ++measured;
        }
        return std::sqrt(energy / static_cast<double>(measured));
    };

    const double lowFrequencyRms = downsampleRms(0.02f);
    const double highFrequencyRms = downsampleRms(0.35f);
    REQUIRE_TRUE(lowFrequencyRms > highFrequencyRms * 8.0);
}

TEST_CASE(bit_crusher_passes_zero_amount_and_quantizes_at_full_amount) {
    synth::BitCrusher crusher;

    REQUIRE_NEAR(crusher.Process({.value = 0.375f, .amount = 0.0f}), 0.375f, 0.0001f);
    REQUIRE_NEAR(crusher.Process({.value = 0.25f, .amount = 1.0f}), 1.0f, 0.0001f);
    REQUIRE_NEAR(crusher.Process({.value = -0.25f, .amount = 1.0f}), -1.0f, 0.0001f);
}

TEST_CASE(sample_rate_reducer_holds_until_phase_wraps) {
    synth::SampleRateReducer reducer;

    REQUIRE_NEAR(reducer.Process({.value = 1.0f, .freq = 0.5f}), 0.0f, 0.0001f);
    REQUIRE_NEAR(reducer.Process({.value = 0.25f, .freq = 0.5f}), 0.25f, 0.0001f);
    REQUIRE_NEAR(reducer.Process({.value = 0.75f, .freq = 0.5f}), 0.25f, 0.0001f);
    REQUIRE_NEAR(reducer.Process({.value = -0.5f, .freq = 1.0f}), -0.5f, 0.0001f);
}

TEST_CASE(meter_tracks_rms_peak_snapshots_and_gain_reduction) {
    synth::Meter meter;

    meter.Process(0.5f);
    meter.Process(-1.0f);
    const synth::MeterSnapshot snapshot = meter.Snapshot();
    REQUIRE_TRUE(snapshot.rms > 0.0f);
    REQUIRE_NEAR(snapshot.peak, 1.0f, 0.0001f);

    const float output = meter.ProcessAndSaturate(2.0f);
    const float expectedOutput = std::atan(2.0f * std::numbers::pi_v<float> * 0.5f) / (std::numbers::pi_v<float> * 0.5f);
    const synth::MeterSnapshot saturatedSnapshot = meter.Snapshot();
    REQUIRE_NEAR(output, expectedOutput, 0.0001f);
    REQUIRE_NEAR(saturatedSnapshot.reduction, std::abs(expectedOutput) / 2.0f, 0.0001f);
}

TEST_CASE(meter_snapshot_rms_is_linear_amplitude_and_db_helpers_use_linear_inputs) {
    synth::Meter meter;

    meter.Process(0.5f);
    const float expectedMeanSquare = 0.25f * synth::Meter::kSmoothingAlphaUp;
    const synth::MeterSnapshot snapshot = meter.Snapshot();

    REQUIRE_NEAR(snapshot.rms, std::sqrt(expectedMeanSquare), 0.0001f);
    REQUIRE_NEAR(synth::Meter::RmsDbFS(0.5f), -6.0206f, 0.001f);
    REQUIRE_NEAR(synth::Meter::PeakDbFS(0.5f), -6.0206f, 0.001f);
}

TEST_CASE(nary_meter_processes_channels_and_publishes_snapshots) {
    synth::NaryMeter<2> meter;
    synth::StereoFloat input{{0.25f, -0.75f}};

    meter.Process(input);
    const synth::NaryMeterSnapshot<2> snapshot = meter.Snapshot();

    REQUIRE_TRUE(snapshot.meters[0].rms > 0.0f);
    REQUIRE_TRUE(snapshot.meters[1].rms > snapshot.meters[0].rms);
    REQUIRE_NEAR(snapshot.meters[0].peak, 0.25f, 0.0001f);
    REQUIRE_NEAR(snapshot.meters[1].peak, 0.75f, 0.0001f);
}

TEST_CASE(math_supports_multiple_precisions_and_periodic_trig) {
    REQUIRE_TRUE(synth::DspMath<8>::kTableSize == 256);
    REQUIRE_TRUE(synth::DspMath<12>::kTableSize == 4096);
    REQUIRE_NEAR(synth::DspMath<10>::Sin2Pi(0.125f), synth::DspMath<10>::Sin2Pi(1.125f), 0.0001f);
    REQUIRE_NEAR(synth::DspMath<10>::Cos2Pi(0.25f), 0.0f, 0.002f);
    REQUIRE_NEAR(synth::DspMath<10>::TanPi(0.25f), 1.0f, 0.004f);
    const auto polar = synth::DspMath<10>::Polar2Pi(2.0f, 0.0f);
    REQUIRE_NEAR(polar.real(), 2.0f, 0.0001f);
    REQUIRE_NEAR(std::abs(synth::DspMath<10>::RootOfUnityByIndex(0)), 1.0f, 0.0001f);
    REQUIRE_NEAR(synth::DspMath<10>::HannKernel(0.0f).real(), 0.5f, 0.001f);
}

TEST_CASE(nary_numbers_are_elementwise_and_have_aliases) {
    synth::StereoFloat a{{1.25f, -0.25f}};
    synth::StereoFloat b{{0.75f, 0.5f}};
    const auto sum = a + b;
    REQUIRE_NEAR(sum[0], 2.0f, 0.0001f);
    REQUIRE_NEAR(sum[1], 0.25f, 0.0001f);
    const auto scaled = sum * 2.0f;
    REQUIRE_NEAR(scaled.Average(), 2.25f, 0.0001f);
    const auto wrapped = a.ModOne();
    REQUIRE_NEAR(wrapped[0], 0.25f, 0.0001f);
    REQUIRE_NEAR(wrapped[1], 0.75f, 0.0001f);
    REQUIRE_TRUE(synth::QuadDouble::Count() == 4);
}

TEST_CASE(classic_svf_blend_selects_low_band_and_high_outputs) {
    auto process = [](float blend) {
        synth::ClassicStateVariableFilter filter;
        filter.Process({.value = 0.75f, .cutoff = 0.05f, .resonance = 0.9f, .blend = blend});
        return filter;
    };

    const auto low = process(-1.0f);
    REQUIRE_NEAR(low.m_output, low.m_low, 0.0001f);

    const auto band = process(0.0f);
    REQUIRE_NEAR(band.m_output, band.m_band, 0.0001f);

    const auto high = process(1.0f);
    REQUIRE_NEAR(high.m_output, high.m_high, 0.0001f);

    const auto lowBlend = process(-0.6f);
    REQUIRE_NEAR(lowBlend.m_output, lowBlend.m_low * 0.6f + lowBlend.m_band * 0.8f, 0.0001f);

    const auto highBlend = process(0.8f);
    REQUIRE_NEAR(highBlend.m_output, highBlend.m_high * 0.8f + highBlend.m_band * 0.6f, 0.0001f);
}

TEST_CASE(classic_svf_low_pass_converges_and_high_resonance_stays_finite) {
    synth::ClassicStateVariableFilter lowPass;
    for (int i = 0; i < 2048; ++i) {
        lowPass.Process({.value = 1.0f, .cutoff = 1000.0f / 48000.0f, .resonance = 0.707f, .blend = -1.0f});
    }
    REQUIRE_NEAR(lowPass.m_output, 1.0f, 0.01f);

    for (const float cutoff : {20.0f / 48000.0f, 20000.0f / 48000.0f}) {
        synth::ClassicStateVariableFilter filter;
        for (int i = 0; i < 256; ++i) {
            filter.Process({.value = 0.25f, .cutoff = cutoff, .resonance = 5.5f, .blend = 0.35f});
            REQUIRE_TRUE(std::isfinite(filter.m_low));
            REQUIRE_TRUE(std::isfinite(filter.m_band));
            REQUIRE_TRUE(std::isfinite(filter.m_high));
            REQUIRE_TRUE(std::isfinite(filter.m_output));
        }
    }
}

TEST_CASE(classic_svf_ui_state_publishes_finite_blended_transfer_function) {
    synth::ClassicStateVariableFilter filter;
    filter.Process({.value = 0.5f, .cutoff = 440.0f / 48000.0f, .resonance = 1.25f, .blend = -0.25f});

    synth::ClassicStateVariableFilter::UIState ui;
    filter.PopulateUIState(ui);
    REQUIRE_NEAR(ui.cutoff.load(), filter.m_cutoff, 0.0001f);
    REQUIRE_NEAR(ui.resonance.load(), filter.m_resonance, 0.0001f);
    REQUIRE_NEAR(ui.blend.load(), filter.m_blend, 0.0001f);

    for (const float frequency : {0.0f, 0.01f, 0.125f, 0.45f}) {
        const float response = ui.FrequencyResponse(frequency);
        const auto transfer = ui.TransferFunctionValue(frequency);
        REQUIRE_TRUE(std::isfinite(response));
        REQUIRE_TRUE(std::isfinite(transfer.real()));
        REQUIRE_TRUE(std::isfinite(transfer.imag()));
    }
}

TEST_CASE(biquad_section_reset_clears_delayed_state) {
    synth::BiquadSection section;
    section.SetLowPassCoefficients(0.08f, 0.70710678f);

    section.Process({.value = 1.0f});
    const float ringingOutput = section.Process({.value = 0.0f});
    REQUIRE_TRUE(std::abs(ringingOutput) > 0.0001f);

    section.Reset();
    REQUIRE_NEAR(section.m_x1, 0.0f, 0.0001f);
    REQUIRE_NEAR(section.m_x2, 0.0f, 0.0001f);
    REQUIRE_NEAR(section.m_y1, 0.0f, 0.0001f);
    REQUIRE_NEAR(section.m_y2, 0.0f, 0.0001f);
    REQUIRE_NEAR(section.Process({.value = 0.0f}), 0.0f, 0.0001f);
}

TEST_CASE(butterworth_filter_attenuates_above_cutoff_more_than_below_cutoff) {
    auto outputRms = [](float frequency) {
        synth::ButterworthFilter filter;
        filter.SetCutoff(0.08f);

        double energy = 0.0;
        int measured = 0;
        for (int i = 0; i < 2048; ++i) {
            const float sample = synth::DefaultDspMath::Sin2Pi(frequency * static_cast<float>(i));
            const float output = filter.Process({.value = sample, .cutoff = 0.08f});
            if (i >= 512) {
                energy += static_cast<double>(output) * static_cast<double>(output);
                ++measured;
            }
        }
        return std::sqrt(energy / static_cast<double>(measured));
    };

    const double lowFrequencyRms = outputRms(0.02f);
    const double highFrequencyRms = outputRms(0.30f);
    REQUIRE_TRUE(lowFrequencyRms > highFrequencyRms * 20.0);
}

TEST_CASE(linkwitz_riley_crossover_transfer_function_recombines_to_unity) {
    for (const float frequency : {0.01f, 0.05f, 0.10f, 0.20f, 0.40f}) {
        const auto transfer = synth::LinkwitzRileyCrossover::TransferFunction(0.10f, frequency);
        REQUIRE_TRUE(std::isfinite(transfer.lowPass.real()));
        REQUIRE_TRUE(std::isfinite(transfer.lowPass.imag()));
        REQUIRE_TRUE(std::isfinite(transfer.highPass.real()));
        REQUIRE_TRUE(std::isfinite(transfer.highPass.imag()));
        REQUIRE_NEAR(std::abs(transfer.lowPass + transfer.highPass), 1.0f, 0.015f);
    }
}

TEST_CASE(one_pole_filters_and_tanh_follow_dsp_contract) {
    synth::OnePoleLowPass lp;
    synth::OnePoleLowPass::Input lpInput{.value = 1.0f, .cutoff = 0.05f};
    float previous = 0.0f;
    for (int i = 0; i < 32; ++i) {
        const float next = lp.Process(lpInput);
        REQUIRE_TRUE(next >= previous);
        previous = next;
    }
    REQUIRE_TRUE(lp.m_output > 0.9f);

    synth::OnePoleHighPass hp;
    synth::OnePoleHighPass::Input hpInput{.value = 1.0f, .cutoff = 0.05f};
    for (int i = 0; i < 128; ++i) {
        hp.Process(hpInput);
    }
    REQUIRE_NEAR(hp.m_output, 0.0f, 0.002f);

    synth::OnePoleLowPass::UIState ui;
    lp.PopulateUIState(ui);
    REQUIRE_TRUE(ui.FrequencyResponse(0.0f) > ui.FrequencyResponse(0.45f));

    synth::TanhSaturator<> tanh;
    REQUIRE_NEAR(synth::TanhSaturator<>::RawApprox(0.5f), 0.5f * (27.0f + 0.25f) / (27.0f + 2.25f), 0.0001f);
    REQUIRE_NEAR(tanh.Process({.value = 100.0f, .gain = 1.0f}), 1.0f, 0.0001f);
    REQUIRE_NEAR(tanh.Process({.value = -100.0f, .gain = 1.0f}), -1.0f, 0.0001f);
}

TEST_CASE(scope_reserves_flat_channels_and_publishes_stable_readers) {
    synth::ScopeWriter writer(4, 16);
    auto first = writer.ReserveChans(2);
    auto second = writer.ReserveChans(2);
    REQUIRE_TRUE(first.BaseChan() == 0);
    REQUIRE_TRUE(second.BaseChan() == 2);

    first.Write(1, 0.25f);
    writer.AdvanceIndex();
    first.Write(1, 0.5f);
    writer.Publish();
    writer.AdvanceIndex();
    first.Write(1, 1.0f);

    REQUIRE_NEAR(writer.ReadSample(first.FlatChan(1), 0), 0.25f, 0.0001f);
    REQUIRE_TRUE(writer.PublishedIndex() == 1);

    second.RecordStart(0);
    second.Write(0, -0.5f);
    writer.AdvanceIndex();
    second.Write(0, 0.5f);
    second.RecordEnd(0);
    writer.Publish();
    synth::ScopeReader reader(&writer, second.FlatChan(), 8);
    REQUIRE_TRUE(!reader.Empty());
    REQUIRE_NEAR(reader.Get(0), -0.5f, 0.0001f);
    REQUIRE_TRUE(reader.TransferXSample() <= reader.NumXSamples());
}

TEST_CASE(scope_reader_uses_floating_point_sample_coordinates) {
    synth::ScopeWriter writer(1, 32);
    auto holder = writer.ReserveChans(1);

    holder.RecordStart();
    holder.Write(0.0f);
    writer.AdvanceIndex();
    holder.Write(10.0f);
    writer.AdvanceIndex();
    holder.Write(20.0f);
    writer.AdvanceIndex();
    holder.RecordEnd();
    writer.Publish();

    synth::ScopeReader reader(&writer, holder.FlatChan(), 3);
    REQUIRE_TRUE(!reader.Empty());
    REQUIRE_NEAR(reader.Get(0.5), 5.0f, 0.0001f);
    REQUIRE_NEAR(reader.Get(1.5), 15.0f, 0.0001f);
}

TEST_CASE(scope_reader_exposes_floating_point_sampling_api) {
    static_assert(std::is_same_v<decltype(&synth::ScopeReader::Get), float (synth::ScopeReader::*)(double) const>);
    static_assert(std::is_same_v<decltype(std::declval<const synth::ScopeReader&>().TransferXSample()), double>);
}

TEST_CASE(scope_reader_stitches_previous_cycle_after_latest_partial_cycle) {
    synth::ScopeWriter writer(1, 64);
    auto holder = writer.ReserveChans(1);

    holder.RecordStart();
    for (std::size_t ix = 0; ix < 10; ++ix) {
        holder.Write(static_cast<float>(ix));
        writer.AdvanceIndex();
    }

    holder.RecordStart();
    for (std::size_t ix = 10; ix < 15; ++ix) {
        holder.Write(static_cast<float>(ix));
        writer.AdvanceIndex();
    }
    writer.Publish();

    synth::ScopeReader reader(&writer, holder.FlatChan(), 10);
    REQUIRE_TRUE(!reader.Empty());
    REQUIRE_NEAR(reader.TransferXSample(), 4.0f, 0.0001f);
    REQUIRE_NEAR(reader.Get(0), 10.0f, 0.0001f);
    REQUIRE_NEAR(reader.Get(3.5), 13.5f, 0.0001f);
    REQUIRE_NEAR(reader.Get(4.5), 4.5f, 0.0001f);
    REQUIRE_NEAR(reader.Get(9), 9.0f, 0.0001f);
}

TEST_CASE(scope_reader_aligns_fractional_start_markers) {
    synth::ScopeWriter writer(1, 64);
    auto holder = writer.ReserveChans(1);

    holder.RecordStart(0, 0.25);
    for (std::size_t ix = 0; ix < 10; ++ix) {
        holder.Write(static_cast<float>(ix));
        writer.AdvanceIndex();
    }

    holder.RecordStart(0, 0.25);
    for (std::size_t ix = 10; ix < 15; ++ix) {
        holder.Write(static_cast<float>(ix));
        writer.AdvanceIndex();
    }
    writer.Publish();

    synth::ScopeReader reader(&writer, holder.FlatChan(), 10);
    REQUIRE_TRUE(!reader.Empty());
    REQUIRE_NEAR(reader.Get(0), 10.25f, 0.0001f);
    REQUIRE_NEAR(reader.Get(4.0), 4.25f, 0.0001f);
}

TEST_CASE(wavetables_wrap_adapt_morph_and_provide_defaults) {
    synth::BasicWavetable<8> table;
    table.Write(0, 1.0f);
    table.Write(1, 0.0f);
    REQUIRE_NEAR(table.Evaluate(0.0f), table.Evaluate(1.0f), 0.0001f);

    auto sine = synth::MakeAdaptiveWavetable(synth::BasicWavetable<8>::Sine());
    REQUIRE_NEAR(sine.Evaluate(0.0f, 0.01f, 0.5f), 0.0f, 0.02f);

    synth::MorphingWavetable<8> morph;
    morph.Add(synth::MakeAdaptiveWavetable(synth::BasicWavetable<8>::Sine()));
    morph.Add(synth::MakeAdaptiveWavetable(synth::BasicWavetable<8>::Square()));
    REQUIRE_TRUE(morph.Size() == 2);
    const float left = morph.Evaluate(0.25f, 0.01f, 0.5f, 0.0f);
    const float right = morph.Evaluate(0.25f, 0.01f, 0.5f, 1.0f);
    const float middle = morph.Evaluate(0.25f, 0.01f, 0.5f, 0.5f);
    REQUIRE_NEAR(middle, (left + right) * 0.5f, 0.02f);

    const auto defaultMorph = synth::MakeDefaultMorphingWavetable<8>();
    REQUIRE_TRUE(defaultMorph.Size() == 4);
}

TEST_CASE(discrete_fourier_transform_normalizes_aligned_cosine_bins) {
    synth::BasicWavetable<10> table;
    for (std::size_t i = 0; i < synth::DspMath<10>::kTableSize; ++i) {
        const float phase = 8.0f * static_cast<float>(i) / static_cast<float>(synth::DspMath<10>::kTableSize);
        table.Write(i, synth::DspMath<10>::Cos2Pi(phase));
    }

    synth::DiscreteFourierTransform<10> dft;
    dft.Transform(table);

    REQUIRE_TRUE(dft.kTableSize == synth::DspMath<10>::kTableSize);
    REQUIRE_TRUE(dft.kMaxComponents == synth::DspMath<10>::kTableSize / 2);
    RequireComplexNear(dft.m_components[8], {0.5f, 0.0f}, 0.002f, "dft.m_components[8]");
    RequireNear(std::abs(dft.m_components[8]), 0.5f, 0.002f, "std::abs(dft.m_components[8])");
}

TEST_CASE(discrete_fourier_transform_inverse_reconstructs_aligned_cosine) {
    synth::BasicWavetable<10> source;
    for (std::size_t i = 0; i < synth::DspMath<10>::kTableSize; ++i) {
        const float phase = 8.0f * static_cast<float>(i) / static_cast<float>(synth::DspMath<10>::kTableSize);
        source.Write(i, synth::DspMath<10>::Cos2Pi(phase));
    }

    synth::DiscreteFourierTransform<10> dft;
    dft.Init();
    dft.Transform(source);

    synth::BasicWavetable<10> reconstructed;
    dft.InverseTransform(reconstructed, 8);

    for (const std::size_t index : {std::size_t{0}, std::size_t{17}, std::size_t{128}, std::size_t{511}}) {
        RequireNear(reconstructed.m_table[index], source.m_table[index], 0.002f, "reconstructed cosine sample");
        RequireFinite(reconstructed.m_table[index], "reconstructed cosine sample");
    }
}

TEST_CASE(discrete_fourier_transform_writes_windowed_partial_at_exact_bin) {
    synth::DiscreteFourierTransform<10> dft;
    dft.Init();
    dft.WriteWindowedPartial(0.0f, 1.0f, 8.0f / static_cast<float>(synth::DspMath<10>::kTableSize));

    RequireComplexNear(dft.m_components[8], {0.5f, 0.0f}, 0.002f, "dft.m_components[8]");

    synth::BasicWavetable<10> table;
    dft.InverseTransform(table, dft.kMaxComponents);
    RequireFinite(table.m_table[0], "table.m_table[0]");
}

TEST_CASE(ola_overlap_add_outputs_finite_frame_and_clears_samples_after_read) {
    synth::DiscreteFourierTransform<8> dft;
    dft.Init();
    dft.m_components[4] = {0.5f, 0.0f};

    synth::Ola<8> ola;
    ola.Write(dft);

    REQUIRE_TRUE(synth::Ola<8>::kHopDenom == 4);
    REQUIRE_TRUE(synth::Ola<8>::kTableSize == synth::DspMath<8>::kTableSize);
    REQUIRE_TRUE(synth::Ola<8>::kHopSize == synth::Ola<8>::kTableSize / 4);
    REQUIRE_NEAR(ola.Process(), 1.0f, 0.002f);
    REQUIRE_NEAR(ola.Process(), synth::DspMath<8>::Cos2Pi(4.0f / static_cast<float>(synth::Ola<8>::kTableSize)), 0.002f);

    for (std::size_t i = 2; i < synth::Ola<8>::kTableSize; ++i) {
        RequireFinite(ola.Process(), "ola.Process()");
    }
    REQUIRE_NEAR(ola.Process(), 0.0f, 0.0001f);
}

TEST_CASE(nary_ola_preserves_channel_independence) {
    synth::NaryDftFrame<8, 4> frame;
    frame.Init();
    frame.AddComponent(4, {0.5f, 0.0f}, synth::QuadFloat{{1.0f, 0.0f, 0.5f, -1.0f}});

    synth::NaryOla<8, 4> ola;
    ola.Write(frame);
    const auto output = ola.Process();

    REQUIRE_NEAR(output[0], 1.0f, 0.002f);
    REQUIRE_NEAR(output[1], 0.0f, 0.002f);
    REQUIRE_NEAR(output[2], 0.5f, 0.002f);
    REQUIRE_NEAR(output[3], -1.0f, 0.002f);
}

TEST_CASE(ola_resynthesizer_primes_finite_analysis_state) {
    synth::BasicWavetable<8> previousFrame;
    previousFrame.Write(0, 1.0f);
    previousFrame.Write(1, 0.5f);

    synth::OlaResynthesizer<8> resynth;
    resynth.PrimeAnalysis(previousFrame);

    REQUIRE_TRUE(synth::OlaResynthesizer<8>::kHopDenom == 4);
    REQUIRE_TRUE(synth::OlaResynthesizer<8>::kHopSize == synth::Ola<8>::kHopSize);
    for (std::size_t bin = 1; bin < synth::OlaResynthesizer<8>::kMaxComponents; ++bin) {
        RequireFinite(resynth.m_prevAnalysisMagnitudes[bin], "resynth.m_prevAnalysisMagnitudes[bin]");
        RequireFinite(resynth.m_prevAnalysisPhases[bin], "resynth.m_prevAnalysisPhases[bin]");
    }
}

TEST_CASE(ola_resynthesizer_process_hop_writes_ola_frame) {
    auto makeFrame = [](std::size_t bin) {
        synth::DiscreteFourierTransform<8> dft;
        dft.Init();
        dft.m_components[bin] = {0.5f, 0.0f};
        synth::BasicWavetable<8> frame;
        dft.InverseTransform(frame, dft.kMaxComponents);
        return frame;
    };

    synth::OlaResynthesizer<8> resynth;
    synth::OlaResynthesizer<8>::Input input;
    input.m_slewUpAlpha = 1.0f;
    input.m_slewDownAlpha = 1.0f;
    resynth.PrimeAnalysis(makeFrame(8));
    resynth.ProcessHop(makeFrame(8), input);

    REQUIRE_TRUE(std::abs(resynth.Process()) > 0.1f);
    for (std::size_t i = 1; i < synth::OlaResynthesizer<8>::kTableSize; ++i) {
        RequireFinite(resynth.Process(), "resynth.Process()");
    }
}

TEST_CASE(ola_resynthesizer_uses_pitch_ratio_directly) {
    auto makeFrame = [] {
        synth::DiscreteFourierTransform<8> dft;
        dft.Init();
        dft.m_components[8] = {0.5f, 0.0f};
        synth::BasicWavetable<8> frame;
        dft.InverseTransform(frame, dft.kMaxComponents);
        return frame;
    };

    synth::OlaResynthesizer<8> resynth;
    synth::OlaResynthesizer<8>::Input input;
    input.m_pitchRatio = 2.0f;
    input.m_slewUpAlpha = 1.0f;
    input.m_slewDownAlpha = 1.0f;
    resynth.PrimeAnalysis(makeFrame());
    resynth.ProcessHop(makeFrame(), input);

    REQUIRE_TRUE(std::abs(resynth.m_lastSynthesisDft.m_components[16]) > 0.4f);
    REQUIRE_TRUE(std::abs(resynth.m_lastSynthesisDft.m_components[8]) < 0.05f);
}

TEST_CASE(ola_resynthesizer_unison_outputs_remain_finite_with_gain) {
    synth::BasicWavetable<8> frame = synth::BasicWavetable<8>::Sine();

    synth::OlaResynthesizer<8> resynth;
    synth::OlaResynthesizer<8>::Input input;
    input.m_unisonGain = 0.75f;
    input.m_unisonDetune = 1.01f;
    input.m_slewUpAlpha = 1.0f;
    input.m_slewDownAlpha = 1.0f;
    resynth.PrimeAnalysis(frame);
    resynth.ProcessHop(frame, input);

    for (std::size_t i = 0; i < synth::OlaResynthesizer<8>::kHopSize * 2; ++i) {
        RequireFinite(resynth.Process(), "resynth.Process()");
    }
}

TEST_CASE(ola_resynthesizer_slews_magnitude_motion) {
    auto makeFrame = [](float magnitude) {
        synth::DiscreteFourierTransform<8> dft;
        dft.Init();
        dft.m_components[8] = {magnitude, 0.0f};
        synth::BasicWavetable<8> frame;
        dft.InverseTransform(frame, dft.kMaxComponents);
        return frame;
    };

    synth::OlaResynthesizer<8> resynth;
    synth::OlaResynthesizer<8>::Input input;
    input.m_slewUpAlpha = 0.25f;
    input.m_slewDownAlpha = 0.5f;

    resynth.PrimeAnalysis(makeFrame(0.0f));
    resynth.ProcessHop(makeFrame(0.5f), input);
    REQUIRE_NEAR(resynth.m_synthesisMagnitudes[8], 0.125f, 0.01f);

    resynth.ProcessHop(makeFrame(0.0f), input);
    REQUIRE_NEAR(resynth.m_synthesisMagnitudes[8], 0.0625f, 0.01f);
}

TEST_CASE(ola_resynthesizer_spectral_distortion_outputs_finite_frame) {
    synth::DiscreteFourierTransform<8> dft;
    dft.Init();
    dft.m_components[8] = {0.5f, 0.0f};
    dft.m_components[16] = {0.25f, 0.0f};
    synth::BasicWavetable<8> frame;
    dft.InverseTransform(frame, dft.kMaxComponents);

    synth::OlaResynthesizer<8> resynth;
    synth::OlaResynthesizer<8>::Input input;
    input.m_slewUpAlpha = 1.0f;
    input.m_slewDownAlpha = 1.0f;
    input.m_useSpectralDistortion = true;
    input.m_spectralThreshold = 0.01f;
    input.m_spectralQuiet = 0.5f;
    input.m_spectralLoud = 0.5f;
    input.m_spectralShiftAmount = 0.5f;
    input.m_spectralShiftPitchRatio = 1.5f;
    resynth.PrimeAnalysis(frame);
    resynth.ProcessHop(frame, input);

    for (std::size_t i = 0; i < synth::OlaResynthesizer<8>::kTableSize; ++i) {
        RequireFinite(resynth.Process(), "resynth.Process()");
    }
}

TEST_CASE(ola_resynthesizer_public_api_has_no_grain_dependencies) {
    using Resynth = synth::OlaResynthesizer<8>;
    static_assert(std::is_same_v<decltype(&Resynth::PrimeAnalysis), void (Resynth::*)(const synth::BasicWavetable<8>&)>);
    static_assert(std::is_same_v<decltype(&Resynth::ProcessHop), void (Resynth::*)(const synth::BasicWavetable<8>&, const Resynth::Input&)>);
    static_assert(std::is_same_v<decltype(&Resynth::Process), float (Resynth::*)()>);
    REQUIRE_TRUE(std::is_default_constructible_v<Resynth::Input>);
}

TEST_CASE(spectral_model_extracts_local_maxima_as_tracked_atoms) {
    synth::DiscreteFourierTransform<8> dft;
    dft.Init();
    dft.m_components[7] = {0.08f, 0.0f};
    dft.m_components[8] = {0.5f, 0.0f};
    dft.m_components[9] = {0.10f, 0.0f};
    synth::BasicWavetable<8> table;
    dft.InverseTransform(table, dft.kMaxComponents);

    synth::SpectralModel<8> model;
    synth::SpectralModel<8>::Input input;
    input.m_gainThreshold = 0.05f;
    input.m_numAtoms = 8;
    input.m_slewUpAlpha = 1.0f;
    input.m_slewDownAlpha = 1.0f;
    input.m_omegaPortamentoAlpha = 1.0f;

    model.ExtractAtoms(table, input);

    REQUIRE_TRUE(!model.m_atoms.empty());
    REQUIRE_NEAR(model.m_atoms.front().m_analysisOmega, 8.0f / static_cast<float>(synth::SpectralModel<8>::kTableSize), 0.001f);
    REQUIRE_TRUE(model.m_atoms.front().m_analysisMagnitude > 0.45f);
    REQUIRE_NEAR(model.m_atoms.front().m_synthesisMagnitude, model.m_atoms.front().m_analysisMagnitude, 0.0001f);
}

TEST_CASE(spectral_model_tracks_atoms_with_slew_and_portamento_alphas) {
    synth::SpectralModel<8> model;
    synth::SpectralModel<8>::Input input;
    input.m_gainThreshold = 0.01f;
    input.m_numAtoms = 4;
    input.m_slewUpAlpha = 1.0f;
    input.m_slewDownAlpha = 0.25f;
    input.m_omegaPortamentoAlpha = 0.5f;
    input.m_omegaDensity = 4.0f / static_cast<float>(synth::SpectralModel<8>::kTableSize);

    auto makeFrame = [](std::size_t bin, float magnitude) {
        synth::DiscreteFourierTransform<8> dft;
        dft.Init();
        dft.m_components[bin] = {magnitude, 0.0f};
        synth::BasicWavetable<8> table;
        dft.InverseTransform(table, dft.kMaxComponents);
        return table;
    };

    model.ExtractAtoms(makeFrame(8, 0.5f), input);
    REQUIRE_TRUE(!model.m_atoms.empty());
    const float firstOmega = model.m_atoms.front().m_synthesisOmega;
    model.ExtractAtoms(makeFrame(9, 0.25f), input);

    REQUIRE_TRUE(model.m_atoms.size() == 1);
    REQUIRE_NEAR(model.m_atoms.front().m_synthesisMagnitude, 0.4375f, 0.02f);
    REQUIRE_TRUE(model.m_atoms.front().m_synthesisOmega > firstOmega);
    REQUIRE_TRUE(model.m_atoms.front().m_synthesisOmega < 9.0f / static_cast<float>(synth::SpectralModel<8>::kTableSize));
}

TEST_CASE(spectral_model_adds_synthetic_harmonics_when_enabled) {
    synth::DiscreteFourierTransform<8> dft;
    dft.Init();
    dft.m_components[6] = {0.5f, 0.0f};
    synth::BasicWavetable<8> table;
    dft.InverseTransform(table, dft.kMaxComponents);

    synth::SpectralModel<8> model;
    synth::SpectralModel<8>::Input input;
    input.m_gainThreshold = 0.01f;
    input.m_numAtoms = 8;
    input.m_slewUpAlpha = 1.0f;
    input.m_useSyntheticHarmonics = true;
    input.m_syntheticHarmonics[0] = 0.5f;

    model.ExtractAtoms(table, input);

    bool sawSynthetic = false;
    for (const auto& atom : model.m_atoms) {
        if (atom.m_isSynthetic) {
            sawSynthetic = true;
            REQUIRE_NEAR(atom.m_analysisOmega, 12.0f / static_cast<float>(synth::SpectralModel<8>::kTableSize), 0.001f);
            REQUIRE_TRUE(atom.m_analysisMagnitude > 0.20f);
        }
    }
    REQUIRE_TRUE(sawSynthetic);
}

TEST_CASE(spectral_model_extracts_residual_after_canceling_detected_atoms) {
    synth::DiscreteFourierTransform<8> dft;
    dft.Init();
    dft.m_components[8] = {0.5f, 0.0f};
    dft.m_components[20] = {0.125f, 0.0f};
    synth::BasicWavetable<8> table;
    dft.InverseTransform(table, dft.kMaxComponents);

    synth::SpectralModel<8> model;
    synth::SpectralModel<8>::Input input;
    input.m_gainThreshold = 0.25f;
    input.m_numAtoms = 4;
    input.m_slewUpAlpha = 1.0f;
    input.m_slewDownAlpha = 1.0f;

    model.ExtractAtomsAndResidual(table, input);

    REQUIRE_TRUE(!model.m_atoms.empty());
    REQUIRE_TRUE(model.m_residualModel.GetEnvelope(8) < 0.05f);
    REQUIRE_TRUE(model.m_residualModel.GetEnvelope(20) > 0.10f);
    RequireFinite(model.m_residualModel.GetEnvelope(20), "residual envelope");
}

TEST_CASE(incrementer_accumulates_total_phase_and_reports_top) {
    synth::Incrementer incrementer;
    incrementer.Process({.freq = 0.75});
    REQUIRE_NEAR(static_cast<float>(incrementer.m_phase), 0.75f, 0.0001f);
    REQUIRE_TRUE(!incrementer.m_top);
    incrementer.Process({.freq = 0.5});
    REQUIRE_NEAR(static_cast<float>(incrementer.m_phase), 1.25f, 0.0001f);
    REQUIRE_NEAR(static_cast<float>(incrementer.m_wrappedPhase), 0.25f, 0.0001f);
    REQUIRE_TRUE(incrementer.m_top);
}

TEST_CASE(incrementer_reports_fractional_top_offset) {
    synth::Incrementer incrementer;
    incrementer.m_phase = 0.75;

    incrementer.Process({.freq = 0.5});

    REQUIRE_TRUE(incrementer.m_top);
    REQUIRE_NEAR(static_cast<float>(incrementer.m_topOffset), 0.5f, 0.0001f);
}

TEST_CASE(lfo_shape_processes_triangle_shape_phase_distortion_wrap_and_exponent) {
    REQUIRE_NEAR(synth::LFOShape::Tri(0.0f), 0.0f, 0.0001f);
    REQUIRE_NEAR(synth::LFOShape::Tri(0.5f), 1.0f, 0.0001f);
    REQUIRE_NEAR(synth::LFOShape::Tri(1.0f), 0.0f, 0.0001f);

    const float curved = synth::LFOShape::Shape(0.0f, 0.5f);
    REQUIRE_NEAR(curved, std::sin(3.14159265358979323846f * 0.25f), 0.0001f);
    REQUIRE_NEAR(synth::LFOShape::Shape(0.5f, 0.25f), 0.25f, 0.0001f);
    REQUIRE_NEAR(synth::LFOShape::Shape(0.999f, 0.25f), 0.0f, 0.0001f);
    REQUIRE_NEAR(synth::LFOShape::Shape(0.999f, 0.75f), 1.0f, 0.0001f);

    REQUIRE_NEAR(synth::LFOShape::PD(0.5f, 0.25f), 0.25f, 0.0001f);
    const float earlyPeak = synth::LFOShape::Process({
        .inPhase = 0.25f,
        .shape = 0.5f,
        .phaseOffset = 0.0f,
        .skew = 0.25f,
        .exponent = 1.0f,
    });
    REQUIRE_NEAR(earlyPeak, 1.0f, 0.0001f);

    const float wrappedNegative = synth::LFOShape::Process({
        .inPhase = -0.25f,
        .shape = 0.5f,
        .phaseOffset = 0.0f,
        .skew = 0.5f,
        .exponent = 1.0f,
    });
    REQUIRE_NEAR(wrappedNegative, 0.5f, 0.0001f);

    const float squared = synth::LFOShape::Process({
        .inPhase = 0.125f,
        .shape = 0.5f,
        .phaseOffset = 0.0f,
        .skew = 0.5f,
        .exponent = 2.0f,
    });
    REQUIRE_NEAR(squared, 0.0625f, 0.0001f);
}

TEST_CASE(basic_lfo_processor_advances_writes_scope_markers_and_publishes_ui_state) {
    synth::ScopeWriter writer(1, 32);
    auto holder = writer.ReserveChans(1);
    synth::BasicLFOProcessor lfo;
    lfo.SetScopeWriterHolder(&holder);
    lfo.SetColor(synth::Color::Yellow);

    synth::BasicLFOProcessor::Input input{
        .frequency = 0.25,
        .shape = {
            .inPhase = 0.0f,
            .shape = 0.5f,
            .phaseOffset = 0.0f,
            .skew = 0.5f,
            .exponent = 1.0f,
        },
    };

    REQUIRE_NEAR(lfo.Process(input), 0.5f, 0.0001f);
    REQUIRE_NEAR(writer.ReadSample(holder.FlatChan(), 0), 0.5f, 0.0001f);
    writer.AdvanceIndex();
    REQUIRE_NEAR(lfo.Process(input), 1.0f, 0.0001f);
    writer.AdvanceIndex();
    REQUIRE_NEAR(lfo.Process(input), 0.5f, 0.0001f);
    writer.AdvanceIndex();
    REQUIRE_NEAR(lfo.Process(input), 0.0f, 0.0001f);

    double latestStart = -1.0;
    REQUIRE_TRUE(writer.LatestStart(holder.FlatChan(), latestStart));
    REQUIRE_NEAR(static_cast<float>(latestStart), 3.0f, 0.0001f);

    synth::BasicLFOProcessor::UIState ui;
    lfo.PopulateUIState(ui);
    REQUIRE_TRUE(ui.connected.load());
    REQUIRE_TRUE(ui.scope.load() == &writer);
    REQUIRE_TRUE(ui.scopeChannel.load() == holder.FlatChan());
    REQUIRE_TRUE(ui.color.Load() == synth::Color::Yellow);
}

TEST_CASE(wavetable_vco_records_top_marker_at_true_cycle_boundary) {
    synth::ScopeWriter writer(2, 32);
    auto holder = writer.ReserveChans(1);
    synth::WavetableVco<8> vco;
    vco.SetScopeWriterHolder(&holder);

    vco.m_incrementer.m_phase = 0.7;
    vco.Process({.freq = 0.2, .phaseOffset = 0.0f, .wavetablePosition = 0.0f, .maxFreq = 0.5f});
    writer.AdvanceIndex();
    vco.Process({.freq = 0.2, .phaseOffset = 0.0f, .wavetablePosition = 0.0f, .maxFreq = 0.5f});
    writer.AdvanceIndex();
    vco.Process({.freq = 0.2, .phaseOffset = 0.0f, .wavetablePosition = 0.0f, .maxFreq = 0.5f});
    writer.AdvanceIndex();
    writer.Publish();

    synth::ScopeReader reader(&writer, holder.FlatChan(), 4);
    REQUIRE_TRUE(!reader.Empty());
    REQUIRE_NEAR(reader.Get(0), 0.0f, 0.05f);
}

TEST_CASE(wavetable_vco_uses_position_scope_and_ui_state) {
    synth::ScopeWriter writer(2, 32);
    auto holder = writer.ReserveChans(1);
    synth::WavetableVco<8> vco;
    vco.SetScopeWriterHolder(&holder);
    vco.SetColor(synth::Color::Orange);

    synth::WavetableVco<8>::Input input{.freq = 0.25, .phaseOffset = 0.0f, .wavetablePosition = 0.0f, .maxFreq = 0.5f};
    const float first = vco.Process(input);
    writer.AdvanceIndex();
    input.wavetablePosition = 1.0f;
    const float second = vco.Process(input);
    REQUIRE_TRUE(std::abs(first - second) > 0.01f);
    REQUIRE_NEAR(writer.ReadSample(holder.FlatChan(), 0), first, 0.0001f);

    synth::WavetableVco<8>::UIState ui;
    vco.PopulateUIState(ui);
    REQUIRE_TRUE(ui.connected.load());
    REQUIRE_TRUE(ui.scope.load() == &writer);
    REQUIRE_TRUE(ui.scopeChannel.load() == holder.FlatChan());
    REQUIRE_TRUE(ui.color.Load() == synth::Color::Orange);
}

TEST_CASE(fir_decimator_factor_four_cadence_survives_block_splits) {
    constexpr std::array<double, 1> coefficients{1.0};
    synth::FirDecimator<4, 1, coefficients.size()> decimator(coefficients);

    const std::array<std::size_t, 4> blockSizes{1, 3, 2, 4};
    std::vector<float> emitted;
    std::size_t inputIndex = 0;
    for (const std::size_t blockSize : blockSizes) {
        for (std::size_t i = 0; i < blockSize; ++i) {
            const std::array<float, 1> input{static_cast<float>(inputIndex + 1)};
            std::array<float, 1> output{0.0f};
            if (decimator.ProcessFrame(input, output)) {
                emitted.push_back(output[0]);
            }
            ++inputIndex;
        }
    }

    REQUIRE_TRUE(emitted.size() == 2);
    REQUIRE_NEAR(emitted[0], 4.0f, 0.0001f);
    REQUIRE_NEAR(emitted[1], 8.0f, 0.0001f);
}

TEST_CASE(fir_decimator_stereo_history_is_independent_and_reset_deterministic) {
    constexpr std::array<double, 3> previousSampleCoefficients{0.0, 1.0, 0.0};
    synth::FirDecimator<2, 2, previousSampleCoefficients.size()> decimator(previousSampleCoefficients);

    auto runSequence = [&decimator] {
        std::vector<std::array<float, 2>> emitted;
        for (std::size_t i = 0; i < 6; ++i) {
            const std::array<float, 2> input{
                10.0f + static_cast<float>(i),
                -100.0f - static_cast<float>(i),
            };
            std::array<float, 2> output{0.0f, 0.0f};
            if (decimator.ProcessFrame(input, output)) {
                emitted.push_back(output);
            }
        }
        return emitted;
    };

    const auto firstRun = runSequence();
    REQUIRE_TRUE(firstRun.size() == 3);
    REQUIRE_NEAR(firstRun[0][0], 10.0f, 0.0001f);
    REQUIRE_NEAR(firstRun[0][1], -100.0f, 0.0001f);
    REQUIRE_NEAR(firstRun[1][0], 12.0f, 0.0001f);
    REQUIRE_NEAR(firstRun[1][1], -102.0f, 0.0001f);
    REQUIRE_NEAR(firstRun[2][0], 14.0f, 0.0001f);
    REQUIRE_NEAR(firstRun[2][1], -104.0f, 0.0001f);

    decimator.Reset();
    const auto secondRun = runSequence();
    REQUIRE_TRUE(secondRun == firstRun);
}

TEST_CASE(fir_decimator_dresden_coefficients_are_symmetric_with_expected_group_delay) {
    const auto coefficients = synth::Dresden4DecimatorCoefficients();
    REQUIRE_TRUE(coefficients.size() == 287);

    double dcGain = 0.0;
    for (std::size_t i = 0; i < coefficients.size(); ++i) {
        REQUIRE_NEAR(coefficients[i], coefficients[coefficients.size() - 1 - i], 1.0e-14);
        dcGain += coefficients[i];
    }

    REQUIRE_NEAR(dcGain, 1.0, 1.0e-12);
    REQUIRE_TRUE((coefficients.size() - 1) / 2 == 143);
}

TEST_CASE(fir_decimator_dresden_frequency_response_meets_spec) {
    const auto coefficients = synth::Dresden4DecimatorCoefficients();
    REQUIRE_TRUE(coefficients.size() == 287);

    auto responseMagnitude = [coefficients](double normalizedFrequency) {
        std::complex<double> response{0.0, 0.0};
        for (std::size_t i = 0; i < coefficients.size(); ++i) {
            const double phase = -2.0 * std::numbers::pi * normalizedFrequency * static_cast<double>(i);
            response += coefficients[i] * std::complex<double>{std::cos(phase), std::sin(phase)};
        }
        return std::abs(response);
    };

    const double dcMagnitude = responseMagnitude(0.0);
    double minPassbandDb = 0.0;
    double maxPassbandDb = 0.0;
    constexpr std::size_t kPassbandSamples = 256;
    for (std::size_t i = 0; i <= kPassbandSamples; ++i) {
        const double normalizedFrequency = (5.0 / 48.0) * static_cast<double>(i) / kPassbandSamples;
        const double db = 20.0 * std::log10(responseMagnitude(normalizedFrequency) / dcMagnitude);
        minPassbandDb = std::min(minPassbandDb, db);
        maxPassbandDb = std::max(maxPassbandDb, db);
    }

    double maxStopbandDb = -1000.0;
    constexpr std::size_t kStopbandSamples = 512;
    for (std::size_t i = 0; i <= kStopbandSamples; ++i) {
        const double normalizedFrequency = (1.0 / 8.0)
            + (0.5 - (1.0 / 8.0)) * static_cast<double>(i) / kStopbandSamples;
        const double magnitude = std::max(responseMagnitude(normalizedFrequency), 1.0e-300);
        maxStopbandDb = std::max(maxStopbandDb, 20.0 * std::log10(magnitude / dcMagnitude));
    }

    REQUIRE_TRUE(maxPassbandDb - minPassbandDb <= 0.1);
    REQUIRE_TRUE(maxStopbandDb <= -90.0);
}

TEST_CASE(oversampled_output_stage_calls_generator_with_exact_internal_indices) {
    constexpr std::array<double, 1> coefficients{1.0};
    using Decimator = synth::FirDecimator<4, 2, coefficients.size()>;
    synth::OversampledOutputStage<4, 2, Decimator> outputStage{Decimator{coefficients}};

    std::vector<std::uint64_t> visitedIndices;
    const auto output = outputStage.ProcessHostFrame(7, [&visitedIndices](std::uint64_t internalIndex) {
        visitedIndices.push_back(internalIndex);
        return std::array<float, 2>{
            static_cast<float>(internalIndex),
            -static_cast<float>(internalIndex),
        };
    });

    REQUIRE_TRUE((visitedIndices == std::vector<std::uint64_t>{28, 29, 30, 31}));
    REQUIRE_NEAR(output[0], 31.0f, 0.0001f);
    REQUIRE_NEAR(output[1], -31.0f, 0.0001f);
}

TEST_CASE(oversampled_output_stage_preserves_decimator_state_across_host_blocks) {
    constexpr std::array<double, 5> fourSamplesAgoCoefficients{0.0, 0.0, 0.0, 0.0, 1.0};
    using Decimator = synth::FirDecimator<4, 1, fourSamplesAgoCoefficients.size()>;
    synth::OversampledOutputStage<4, 1, Decimator> outputStage{Decimator{fourSamplesAgoCoefficients}};

    auto generator = [](std::uint64_t internalIndex) {
        return std::array<float, 1>{static_cast<float>(internalIndex + 1)};
    };

    const auto first = outputStage.ProcessHostFrame(0, generator);
    const auto second = outputStage.ProcessHostFrame(1, generator);

    REQUIRE_NEAR(first[0], 0.0f, 0.0001f);
    REQUIRE_NEAR(second[0], 4.0f, 0.0001f);
}

int main() {
    int failed = 0;
    for (const auto& test : Registry()) {
        try {
            test.fn();
            std::cout << "[PASS] " << test.name << "\n";
        } catch (const std::exception& ex) {
            ++failed;
            std::cerr << "[FAIL] " << test.name << ": " << ex.what() << "\n";
        }
    }
    return failed == 0 ? 0 : 1;
}
