## 1. Tests

- [x] 1.1 Add a DSP unit test proving `ScopeReader::Get(0.5)` returns an interpolated value instead of the lower integer sample.
- [x] 1.2 Add a compile-time or focused API test proving `ScopeReader::Get(std::size_t)` is no longer the reader sampling contract.
- [x] 1.3 Add a partial-cycle stitch test covering floating-point reads on both sides of the transfer boundary.
- [x] 1.4 Add a test proving the reader exposes the transfer boundary as the same floating-point coordinate used by sampling.
- [x] 1.5 Add or extend a JUCE/path-drawer test seam so `DrawScopePath` floating-point render coordinates are observably passed to the scope reader.

## 2. Scope Reader

- [x] 2.1 Replace integer `ScopeReader` sampling with `Get(double xSample)`.
- [x] 2.2 Preserve floating-point x-sample coordinates when mapping reader x samples to scope-writer source indices.
- [x] 2.3 Track and expose the transfer boundary as a floating-point x-sample position.
- [x] 2.4 Convert to integer indexes only when selecting adjacent scope-writer buffer samples for linear interpolation.
- [x] 2.5 Clamp floating-point reader inputs and guard degenerate spans without changing scope storage, marker recording, or publish semantics.

## 3. Waveform Rendering

- [x] 3.1 Update `PathDrawer::DrawScopePath` to pass floating-point scope x-sample coordinates into `ScopeReader`.
- [x] 3.2 Update marker drawing to round or clamp the floating-point `TransferXSample()` only at the drawing step.

## 4. Verification

- [x] 4.1 Run `make -C projects/synth test`.
- [x] 4.2 Run any focused miniapp/JUCE geometry or waveform tests that cover `projects/synth/juce`.
- [x] 4.3 Run `openspec status --change "preserve-scope-reader-fractional-samples"` and confirm the change is apply-ready.
