## Context

`ScopeWriter::Read(channel, double index)` already supports interpolation between adjacent physical samples. The value becomes coarser one layer up: `ScopeReader::Get` accepts only `std::size_t xSample`, and `PathDrawer::DrawScopePath` computes a fractional render sample but truncates it before calling `Get`.

The scope reader also computes its transfer boundary as an integer x sample. That boundary should become a floating-point position too: the UI can round only at the final drawing primitive if needed, while reads near the stitch point avoid integer-division bias.

## Goals / Non-Goals

**Goals:**

- Make `ScopeReader` callers request floating-point x samples and get interpolated values from the aligned scope span.
- Remove the existing integer `ScopeReader::Get(std::size_t)` API rather than keeping a forwarding compatibility path.
- Update waveform drawing so render-point x coordinates stay fractional until `ScopeWriter::Read`.
- Add focused tests that fail on truncation and pass when interpolation is preserved.

**Non-Goals:**

- Change scope storage, marker recording, channel reservation, or publish semantics.
- Add smoothing filters or temporal averaging beyond preserving the existing interpolation path.
- Keep integer-valued reader or transfer-coordinate APIs.

## Decisions

1. Replace integer reader sampling with floating-point sampling.

   `ScopeReader` should expose `Get(double xSample)` as the sampling API and remove `Get(std::size_t xSample)`. The caller-facing coordinate is a continuous reader-space x position; the only integer conversion should happen inside the final source-buffer interpolation path. Keeping the old integer API would make it too easy for render code to keep quantizing the path before the reader.

2. Store and expose a floating-point transfer boundary.

   `TransferXSample()` should return a floating-point position, with any integer conversion deferred to drawing code that truly needs a pixel/sample bucket. Read segmentation should compare against the floating-point boundary and use floating-point denominators. An alternative would be to keep the public transfer sample integer-valued while using a private double, but that preserves a second quantized API around the same continuous coordinate system.

3. Let `PathDrawer` pass fractional samples to the reader.

   `DrawScopePath` should compute its scope x coordinate in `[0, NumXSamples - 1]` or an equivalent clamped span and call the floating-point reader directly. It should not cast the value to `std::size_t` before reading. An alternative would be oversampling the path at more integer points; that costs more work and still does not align arbitrary UI widths with scope samples.

## Risks / Trade-offs

- Fractional reads can expose interpolation around a cycle stitch point differently than integer reads -> add tests for both pre-transfer and post-transfer reads, and intentionally update callers to the continuous coordinate API.
- Very small spans can divide by zero or read beyond the available adjacent sample -> clamp floating-point x samples and use existing defensive denominator guards before calling `ScopeWriter::Read`.
- Marker placement can change if `TransferXSample()` becomes floating point -> defer rounding to marker drawing only, so value sampling and marker placement share the same continuous source coordinate.
