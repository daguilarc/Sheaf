# OpenSpec Requirement ID Uniqueness Design

## Problem

The live `synth-parameter-modulation` specification assigns `spm-69` and
`spm-70` to two requirements each. OpenSpec validates the document because the
numeric prefixes are a repository traceability convention rather than an
OpenSpec structural key, but coverage documentation and human references rely
on those prefixes being unique.

Archived change deltas also repeat requirement IDs. Those repetitions are
expected historical records of additions, modifications, removals, and renames
and must not be rewritten or treated as live collisions.

A follow-up repository scan found three more collisions within individual live
capability files: `asd-20`, `arm-12`, and `sar-18`. Reusing a generic prefix in
different capability files remains valid, so uniqueness is a per-file contract,
not a repository-global one.

## Design

Keep the first live use of each collided ID. Rename the later requirements to
the next unused IDs:

- `spm-69 — Parameter appearance registration` becomes `spm-80`.
- `spm-70 — UI topology: optional modulator visualizer publication` becomes
  `spm-81`.

Update live documentation that refers to the renamed visualizer requirement.
Leave archived OpenSpec changes unchanged so they continue to record the IDs
used when those changes were created. Do not reuse removed `spm-53`.

For any remaining collision, preserve the requirement that acquired the ID
first according to Git and archived-change provenance. Assign the
later-introduced requirement the next unused numeric ID in that capability:

- `asd-20 — Shared skill: xagent-subagents` becomes `asd-23`.
- `arm-12 — Logging: Agent Review command and frame errors` becomes `arm-34`.
- `sar-18 — UI: portable application surface` becomes `sar-24`.

This provenance rule is independent of heading order: subsequent edits can
move requirements without changing their stable identity.

## Regression Guard

Add a repository-level unittest that scans requirement headings in every live
`openspec/specs/**/spec.md` file and fails when an identifier appears more than
once within the same file. Scope each uniqueness group to its capability file
so archived deltas, active change overlays, and intentionally reused generic
prefixes in other capability files do not produce false positives. Expose the
check through the root Makefile and include it in the root `test` target.

## Verification

The generalized check must first fail with exactly the three known remaining
collisions and pass after renumbering. `openspec validate --all` must continue
to pass, and a repository scan must show no duplicate requirement headings
within any live capability while archived files remain unchanged.
