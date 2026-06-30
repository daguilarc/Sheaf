## 1. Tests

- [x] 1.1 Add an incrementer test proving top offset is fractional for a crossing inside a sample.
- [x] 1.2 Add a scope writer/reader test proving fractional start markers affect reader alignment.
- [x] 1.3 Add a VCO scope test proving top crossings record fractional marker offsets.

## 2. Implementation

- [x] 2.1 Add a floating-point top-crossing offset to `Incrementer`.
- [x] 2.2 Change scope marker storage and marker APIs to use floating-point offsets/positions.
- [x] 2.3 Update `ScopeReader` marker alignment to use floating-point marker positions.
- [x] 2.4 Update `WavetableVco` to pass the incrementer's top offset to `RecordStart`.

## 3. Verification

- [x] 3.1 Run `make -C projects/synth test`.
- [x] 3.2 Run `make -C projects/synth/miniapp test`.
- [x] 3.3 Run `openspec status --change "preserve-scope-fractional-top-markers"` and confirm artifacts are complete.
