## Review: Task 1 — Encoder-Mode Contract and Compatible Persistence (`d4498d81..8693e629`)

**1. SPEC COMPLIANCE: PASS**

**2. CODE QUALITY: PASS**

### Strengths

- **Declaration order & defaults**: `EncoderMode{Signed7Bit=0, DirectionOnly=1, Absolute=2}` matches the plan exactly, enforced by `static_assert`s (`parameter_modulation_tests.cpp:844-846`), and `EncoderMidiInConfig::mode` still defaults to `Signed7Bit`.
- **New-field authority, including present-null**: `ObjectHasKey` (`MidiController.cpp:608-620`) checks key membership in the JSON container directly, which is necessary — `JSON::Get()`/`IsNull()` cannot distinguish an absent key from a key explicitly set to `arena.Null()`, since `SetNew(key, arena.Null())` stores a `nullptr` member value identical to what `Get()` returns for a missing key (`Json.hpp:452,493-511`). This is confirmed correct against `encoder_mode_json_new_field_is_authoritative`'s explicit-null case (`parameter_modulation_tests.cpp:911-918`), and it matches an existing codebase pattern of consumers reaching into `JsonMember`/`JsonContainer` directly (`ParameterModulation.cpp:173-177`), so it's not a novel encapsulation violation.
- **Write-new/read-old, legacy fallback only when absent**: `ToJSON` emits only `"mode"`; `FromJSON` parses `mode` when present, `relativeMode` only otherwise, and never partially mutates the destination on failure (uses a local `parsed` and assigns only on full success) — verified via `encoder_mode_json_loads_legacy_field_and_migrates_on_save` and the destination-preservation assertions in `encoder_mode_json_new_field_is_authoritative`.
- **Exhaustive rename**: `rg 'EncoderRelativeMode|\.relativeMode|"relativeMode"' projects/synth --glob '!miniapp/**'` returns only the deliberate compat parser reference and legacy JSON test fixtures — no leftover `EncoderRelativeMode` type usage anywhere.
- **Relative behavior preserved byte-for-byte**: `DecodeDelta`'s `Signed7Bit`/`DirectionOnly` branches are untouched; only a new `Absolute` case (`return std::nullopt`) was added, which is safely handled by the existing `if (const std::optional<float> delta = ...)` guard at the one call site (`MidiController.cpp:409`) — no new code paths assume a non-null result.
- Scope discipline is good: only the files task 1 authorized were touched (including `ControllersPageUI.hpp` and `rig_tests.cpp` as legitimate "repository consumers" / comment-only touches); no `ParameterModulation.hpp/cpp` message/routing work leaked in from Task 2/3.

### Findings

**Critical:** none.

**Important:**
- `projects/synth/src/MidiConfigViewModel.cpp:1169-1172` — `RowFieldValue`'s `Field::EncoderMode` case treats any mode other than `DirectionOnly` as index `0`, so a persisted `EncoderMode::Absolute` config is misreported as "Signed 7-bit" selected in the Controllers combo box (`ControllersPageUI.hpp:1301-1305` feeds this straight into `fieldNode.selectedOption`). This contradicts the function's own header contract ("`out` is the current mode's index into `EncoderModeCatalog()`") since Absolute has no index in that 2-entry catalog. It's reachable today because this diff's `FromJSON` already accepts `"mode": "absolute"`, even though no UI path can *write* Absolute yet. No data corruption results (the underlying `EncoderModeRow` still carries the real `Absolute` value unless the user explicitly edits/commits that field, which is index-range-limited to {0,1}), but it's a display-correctness gap the report's "Concerns" section doesn't mention. This is worth a one-line flag for whoever picks up Task 5, e.g. have `RowFieldValue` return `false` for a mode outside the current catalog rather than aliasing it to `Signed7Bit`.

**Minor:**
- The doc comment on `EncoderModeCatalog()` (`MidiConfigViewModel.hpp:123-127`) notes the catalog is used "for the two relative choices" but doesn't call out that `RowFieldValue`/`ApplyMappingEdit` currently have no representation for `Absolute` — a short note would have made the above gap self-documenting rather than a silent surprise.

### Verdict

Task 1's actual diff matches its stated scope (OpenSpec 1.1–1.3) faithfully: the enum rename, declaration order, JSON authority/fallback/null-handling semantics, and exhaustive repository rename are all correctly and defensively implemented, with well-targeted TDD evidence in the report matching what's in the diff. The one concrete gap found — `RowFieldValue` silently misrepresenting a persisted `Absolute` mode as `Signed7Bit` in the UI — is a real, verifiable diff-level defect, but it's confined to display and doesn't corrupt persisted state, doesn't violate any Task 1 acceptance criterion (the plan explicitly permits deferring "full UI semantics" and the 2-entry catalog), and is naturally in-scope for Task 5's catalog/session work rather than blocking Task 1. Recommend: **approve Task 1**, and hand the `RowFieldValue` gap to Task 5 as a known follow-up rather than reopening Task 1.