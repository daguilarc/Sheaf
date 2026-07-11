# Task 1 Report: Add Failing Target-Center Tests

## Result

- Status: `RED`
- Scope: Added the failing target-center tests from the Task 1 brief.
- Production code was not modified.
- OpenSpec task files were not modified or marked.

## Implementation

Modified `projects/synth/tests/parameter_modulation_tests.cpp` only, adding:

- Default, valid, and invalid `targetCenterAlpha` configuration checks.
- Top-level compute smoothing with group alpha `0.25f`.
- Alpha-one direct top-level assignment coverage.
- Recursive modulation-depth immediacy coverage for parent reads.
- Per-sample target-center smoothing before process-lite smoothing.

## TDD RED Evidence

Command:

```text
make -C projects/synth build/parameter_modulation_tests && projects/synth/build/parameter_modulation_tests
```

Observed result: exit 2 during compilation. The baseline production
`synth::ParameterGroupConfig` has no `targetCenterAlpha` member. The compiler
reported eight errors for the new member access and designated initializers,
including:

```text
error: no member named 'targetCenterAlpha' in 'synth::ParameterGroupConfig'
error: field designator 'targetCenterAlpha' does not refer to any field in type 'synth::ParameterGroupConfig'
make: *** [build/parameter_modulation_tests] Error 1
```

This is the expected RED state specified by the brief. `git diff --check`
also passed before the RED build.

## Files Changed

- `projects/synth/tests/parameter_modulation_tests.cpp`
- `.superpowers/sdd/task-1-report.md`

Pre-existing unrelated untracked files were left untouched:

- `docs/superpowers/plans/2026-07-11-add-target-center-alpha.md`
- `openspec/changes/add-target-center-alpha/`
- `projects/synth/miniapp/`

## Concerns

No implementation concern for this TDD task. The focused binary cannot compile
until the production `targetCenterAlpha` interface is added by a later task.
