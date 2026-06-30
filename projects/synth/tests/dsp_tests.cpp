#include "synth/DspFilters.hpp"
#include "synth/DspMath.hpp"
#include "synth/DspNumbers.hpp"
#include "synth/DspOscillators.hpp"
#include "synth/DspScope.hpp"
#include "synth/DspTransferFunction.hpp"
#include "synth/DspWavetable.hpp"

#ifdef JUCE_MAJOR_VERSION
#error "synth DSP tests must not see JUCE headers"
#endif

#include <cmath>
#include <exception>
#include <iostream>
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

void RequireNear(float actual, float expected, float tolerance, const char* expr) {
    if (std::fabs(actual - expected) > tolerance) {
        std::ostringstream oss;
        oss << expr << " expected " << expected << " got " << actual;
        throw std::runtime_error(oss.str());
    }
}

#define REQUIRE_NEAR(actual, expected, tolerance) RequireNear((actual), (expected), (tolerance), #actual)

} // namespace

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
