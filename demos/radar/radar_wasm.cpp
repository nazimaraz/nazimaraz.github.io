// Browser entry points for the rt-radar-pipeline DSP code.
//
// Everything between the raw ADC words and the detection list is the firmware's own
// source, compiled unchanged from github.com/nazimaraz/rt-radar-pipeline (source/dsp and
// source/app/signal_generator). This file only feeds it blocks and exposes the results.

#include <cmath>
#include <cstddef>
#include <cstdint>

#include "dsp/adc.hpp"
#include "dsp/cfar.hpp"
#include "dsp/fft.hpp"
#include "dsp/spectrum.hpp"
#include "dsp/window.hpp"
#include "signal_generator.hpp"

namespace {

constexpr auto kBlockSamples{dsp::kFftSize};
constexpr auto kFirmwarePfa{1e-6f};
constexpr auto kTwoPi{6.28318530717958647692f};

const dsp::HannWindow kWindow{};
const dsp::Fft kFft{};

sim::SignalGenerator generator{};
std::uint32_t sequence{0};

std::uint16_t raw[kBlockSamples]{};
float decoded[kBlockSamples]{};
dsp::Complex spectrum[kBlockSamples]{};
float power[dsp::kSpectrumBins]{};
float threshold[dsp::kSpectrumBins]{};
dsp::Detection detections[dsp::kMaxDetections]{};

float phases[2]{};
std::uint32_t noiseState{0x2545F491u};

[[nodiscard]] float nextNoise() {
  noiseState ^= noiseState << 13u;
  noiseState ^= noiseState >> 17u;
  noiseState ^= noiseState << 5u;
  return static_cast<float>(static_cast<std::int32_t>(noiseState)) /
         2'147'483'648.0f;
}

// The firmware's processing task, minus the OS calls.
[[nodiscard]] std::uint32_t process(const float falseAlarmProbability) {
  const dsp::CaCfar cfar{falseAlarmProbability};
  dsp::decodeSamples(raw, decoded, kBlockSamples);
  kWindow.apply(decoded, spectrum);
  kFft.forward(spectrum);
  dsp::powerSpectrum(spectrum, power);
  for (auto bin{std::size_t{0}}; bin < dsp::kSpectrumBins; ++bin) {
    threshold[bin] = cfar.threshold(power, bin);
  }
  return cfar.detect(power, detections, dsp::kMaxDetections);
}

} // namespace

extern "C" {

// One block from the firmware's own signal generator, at the firmware's Pfa.
std::uint32_t radar_firmware_block() {
  generator.fill(raw, kBlockSamples, sequence);
  ++sequence;
  return process(kFirmwarePfa);
}

void radar_reset() {
  generator = sim::SignalGenerator{};
  sequence = 0;
}

// One block whose tones, noise and Pfa come from the page's sliders.
std::uint32_t radar_custom_block(const float hzA, const float amplitudeA,
                                 const float hzB, const float amplitudeB,
                                 const float noise, const float pfa) {
  const float steps[2]{kTwoPi * hzA / static_cast<float>(sim::kSampleRateHz),
                       kTwoPi * hzB / static_cast<float>(sim::kSampleRateHz)};
  for (auto& word : raw) {
    word = dsp::encodeSample((amplitudeA * std::sin(phases[0])) +
                             (amplitudeB * std::sin(phases[1])) +
                             (noise * nextNoise()));
    for (auto tone{0}; tone < 2; ++tone) {
      phases[tone] = std::fmod(phases[tone] + steps[tone], kTwoPi);
    }
  }
  return process(pfa);
}

const float* radar_power() { return power; }
const float* radar_threshold() { return threshold; }
const dsp::Detection* radar_detections() { return detections; }
std::uint32_t radar_bins() { return dsp::kSpectrumBins; }
}
