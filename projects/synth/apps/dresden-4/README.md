# Dresden 4

Dresden 4 is a patch-launchable, JUCE-free synthesizer core built around four
wavetable VCO processors, a reusable 4×4 bipolar matrix mixer, and one
16-encoder bank slot.

The audio graph runs parameter processing, oscillator processing, and
matrix-derived audio-rate modulation at `4 * hostSampleRate`. The final stereo
signal is downsampled at the output edge through the shared fixed-ratio FIR
decimation stage based on the Dresden 4 Kaiser low-pass coefficients.

Dresden 4 is a Sheaf Patch-only app. It is registered into the Sheaf Patch
launcher and does not have a standalone `make -C apps/dresden-4` application
target. Build it through the Sheaf Patch host:

```text
make -C projects/synth sheaf-patch
```
