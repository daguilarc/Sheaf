# Dictator refiner benchmark

This directory is the tracked definition of Dictator's refiner benchmark. It
keeps reusable code, immutable prompt candidates, synthetic contracts, small
deliberately reviewed examples, and aggregate study metadata in Git. Personal
dictation, model responses, and judge traces remain in ignored local data.

## Layout

```text
datasets/synthetic.jsonl                 exact synthetic contracts
datasets/reviewed/                       explicitly human-approved cases only
prompts/                                 immutable experiment prompt versions
studies/2026-07-13-refiner-study/        manifest, summary, and study metadata
benchmark.py                             run, score, sample, and judge harness
rank_awkwardness.py                      awkwardness/landmine ranking harness
study_artifacts.py                       snapshot and integrity verifier
```

The private evidence for the retained study lives in the canonical checkout:

```text
/Users/joyo/Sheaf/data/dictator/experiments/refiner-benchmark/
  2026-07-13-refiner-study/
    inputs/
    runs/
    judgments/
    analyses/
```

Those files contain personal dictation and full API traces. Do not add them to
Git. Back them up as private operator data. The tracked manifest records their
relative paths, record counts, byte sizes, SHA-256 hashes, and aggregate run
metadata so missing or changed evidence is detectable.

## Dataset meanings

- `distribution-sample`: historical Whisper transcripts and lived-with outputs.
  These are useful for edit-distance and blinded-comparison measurements, but
  their outputs are not labels.
- `synthetic-contract`: authored examples with exact expected behavior.
- `human-reviewed`: a case promoted only after the user explicitly approves its
  expected output. The awkward-example report is review material, not a golden
  dataset.

Never report target-output accuracy for a distribution sample.

## Verify the retained study

From the repository root:

```sh
python3 projects/dictator/experiments/refiner-benchmark/study_artifacts.py verify \
  --manifest projects/dictator/experiments/refiner-benchmark/studies/2026-07-13-refiner-study/manifest.json \
  --data-root /Users/joyo/Sheaf/data/dictator/experiments/refiner-benchmark/2026-07-13-refiner-study
```

The verifier fails for missing files, byte-count differences, JSONL record-count
differences, or SHA-256 differences. Treat a study as immutable: a new run gets
a new run name or study ID rather than overwriting retained evidence.

## Reports and rollout

- [Refiner benchmark report](../../docs/experiments/2026-07-13-refiner-benchmark.md)
- [Awkward dictation review](../../docs/experiments/2026-07-13-awkward-dictation-review.md)
- [Marker parser follow-up design](../../docs/experiments/2026-07-15-marker-parser-design.md)
- [Luna-low rollout and rollback](../../docs/experiments/2026-07-15-luna-low-rollout.md)

The selected rollout is Luna at low reasoning with conservative v4, Blark v3,
and Borg v4. Reconsider `none` only after structural marker parsing or production
evidence demonstrates that the semantic Borg reliability difference is gone.
