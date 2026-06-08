# Implementation Complete

Slice `0001_experiment_foundation` is complete.

## Delivered

- New `experiments.py` module with experiment dataclasses, deterministic naming helpers, metadata read/write/update APIs, and `resolve_quest_scope_checkout`.
- Extended `DashboardCheckout` with optional experiment fields; `resolve_dashboard_checkout` delegates to the shared resolver.
- Documented experiment metadata schema in `quest_docs/schemas.md`.
- Added `tests/test_experiments.py` (22 tests) covering naming, directory numbering, metadata I/O, validation, and scoped checkout resolution.

## Verification

`make -C projects/quest-runner test` passes (297 tests including new experiment suite).
