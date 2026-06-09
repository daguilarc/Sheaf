# Implementation Complete

Slice 0001 delivers workflow configuration loading without changing runner execution.

## Delivered

- `workflow_config.py` with `WorkflowValidationError`, `load_workflow()`, `load_packaged_default_workflow()`, and typed `WorkflowDefinition` helpers for machines, profiles, prompt paths, issue declarations, and collection lookup.
- Packaged `default_workflow/` directory containing `workflow.yaml`, `preamble.md`, quest/slice machine YAML, six profile YAML files, and prompt markdown copied from `roles/` with issue CLI wording updated to `--file`.
- `tests/test_workflow_config.py` covering the packaged default workflow shape, byte-exact collection scaffold content, validation failures, and a minimal fixture workflow.

## Verification

- `make -C projects/quest-runner test` passes (381 tests).
