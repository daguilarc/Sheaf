## Context

The parameter engine currently gives `RangeKind::Bipolar` two jobs: presentation metadata and an internal `[-1, 1]` storage/clamping domain. Modulation sources are always `[0, 1]`, so the crossfade equation combines incompatible coordinate systems for bipolar carriers. Bipolar values also flow through scene editing, smoothing, cached reads, dynamic ranges, persistence, mapping helpers, and UI snapshots.

This change makes `[0, 1]` the sole engine coordinate system. Bipolarity remains useful metadata, but conversion happens only when a consumer needs signed natural units or when a UI snapshot is published.

## Goals / Non-Goals

**Goals:**

- Establish `[0, 1]` as the invariant for all parameter and modulation-depth state.
- Make bipolar linear, centered exponential, and zero-based exponential helpers convert normalized input with `2u - 1`.
- Preserve the current bounded crossfade law, signed-depth normalization, and full-depth replacement/inversion behavior.
- Preserve the existing signed bipolar UI/controller snapshot contract.
- Move the modulation-depth curve halfpoint magnitude from `0.125` to `0.25`.

**Non-Goals:**

- Changing crossfade modulation to additive modulation.
- Changing unipolar modulation-source values or timing.
- Renaming `GetRaw()` or redesigning the public mapping-helper family.
- Adding a versioned persistence format or automatic conversion for previously serialized signed bipolar values.

## Decisions

### Use one normalized core domain

`ParameterConfig::range` remains as polarity/presentation metadata, but parameter construction, defaults, scene and gesture values, edit limits, randomization, center smoothing, `GetRaw()`, cached values, min/max state, and JSON values all use `[0, 1]`. Core clamping no longer branches on polarity.

This is preferable to inserting special bipolar corrections into modulation because it removes the domain mismatch from every recursive depth level and gives all generic parameter operations one invariant.

### Preserve the crossfade equation unchanged

Depth normalization continues to produce signed effective depths, center scale `max(0, 1 - sum(abs(depth)))`, and normalization offset `-sum(min(0, depth))`. The audio-rate expression remains:

```text
normalized = center * centerScale + normalizationOffset + sum(source * depth)
```

For a bipolar consumer, applying `b = 2u - 1` turns a positive route into `(1-d) * centerBipolar + d * sourceBipolar`; a full positive depth reaches the signed source, and a full negative depth reaches its inversion. No additive offset behavior is introduced.

### Decode bipolar meaning at boundaries

`GetRaw()` and `CachedKnobValue()` remain normalized. `GetBipolarLinear`, `GetBipolarExponential`, and `GetBipolarZeroBasedExponential` validate bipolar metadata, convert the cached value with `2u - 1`, then apply their existing natural-unit mappings. Ordinary linear and exponential helpers continue to consume normalized values directly.

`PopulateUIState()` converts normalized center and min/max values with `2u - 1` for bipolar parameters and scales normalized display spread by `2`. This keeps encoder, MIDI, and other UI consumers on their current signed contract without allowing signed state back into the core.

### Encode modulation-depth controls as normalized knobs

Generated modulation-depth parameters remain marked bipolar for presentation but use normalized default `0.5`. Recursive reads convert `u` to signed travel `2u - 1` before the zero-based exponential depth curve. The curve retains endpoints and neutral while changing the absolute half-travel target from `0.125` to `0.25`.

### Migrate declarations and fixtures directly

Code-defined bipolar defaults, scene values, gesture values, and test fixtures convert from signed values with `(b + 1) / 2`. Existing serialized patches are not automatically distinguishable because the current value JSON has no domain/version marker; compatibility migration is therefore outside this change, and existing signed bipolar patch data must be regenerated or converted before loading.

## Risks / Trade-offs

- [Missed signed literal] A bipolar declaration or fixture may still supply an old signed value that happens to fall inside `[0, 1]` and evade range checks. -> Audit all bipolar registrations and direct scene/gesture writes, then rely on endpoint, center, module, and randomized-oracle tests.
- [Boundary double conversion] A module or UI path may convert a value that a helper or snapshot already converted. -> Keep `GetRaw()` explicitly normalized and centralize signed conversion in bipolar helpers and `PopulateUIState()`.
- [Spread scale regression] Bipolar UI blur could become half-sized if normalized spread is published unchanged. -> Specify and test the factor-of-two conversion.
- [Persisted patch incompatibility] Unversioned old bipolar values are ambiguous. -> Treat the value-domain change as breaking and document regeneration/conversion rather than guessing during load.
- [Large mechanical test churn] Many signed literals change even though musical behavior should remain equivalent. -> Update the simulation oracle with the implementation and retain explicit crossfade anchor tests.

## Migration Plan

1. Change core clamping, depth decoding/defaults, bipolar mapping helpers, and UI publication together so no intermediate mixed-domain state is considered supported.
2. Convert bipolar module declarations and direct state assignments with `(b + 1) / 2`, then update the deterministic oracle and focused parameter tests.
3. Run the synth parameter, module, engine, and system suites and compare bipolar natural-unit outputs and signed UI snapshots with their prior intended behavior.

Rollback is a source-level revert of the implementation and converted literals; serialized normalized patches produced after this change are not backward-compatible with the previous signed bipolar core.

## Open Questions

None.
