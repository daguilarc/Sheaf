## 1. Runtime grid topology access

- [x] 1.1 Add the documented non-owning initialization-time `GridManager*` to `AppContext` and wire it from `Engine` without changing runtime ownership or finalization order.
- [x] 1.2 Add JUCE-free Engine coverage proving an application can declare a grid slot/grid through the context during `Init` and that runtime finalization/publication still occurs afterward.

## 2. MiniApp just-intonation grid

- [x] 2.1 Add MiniApp's fixed `(0,0)`–`(8,2)` slot/grid, two set-only selection states initialized to the `1/1` column, and all sixteen stable colored ratio cells.
- [x] 2.2 Apply the two selected ratios only to their matching prepared VCO input frequencies before VCO processing, without mutating Tune parameter state.
- [x] 2.3 Extend MiniApp system coverage for exact topology/order, set-only independent row selection, packed dim/full feedback, unity startup, and independent per-voice frequency offsets.

## 3. Verification and traceability

- [x] 3.1 Run focused Engine/MiniApp tests, full synth and MiniApp suites, strict OpenSpec validation, and diff/placeholder checks.
- [ ] 3.2 Update the MiniApp ratio-grid spec coverage and mark these OpenSpec tasks complete only after reviewed verification passes.
