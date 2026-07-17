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

## Design

Keep the first live use of each collided ID. Rename the later requirements to
the next unused IDs:

- `spm-69 — Parameter appearance registration` becomes `spm-80`.
- `spm-70 — UI topology: optional modulator visualizer publication` becomes
  `spm-81`.

Update live documentation that refers to the renamed visualizer requirement.
Leave archived OpenSpec changes unchanged so they continue to record the IDs
used when those changes were created. Do not reuse removed `spm-53`.

## Regression Guard

Add a repository-level unittest that scans `spm-*` requirement headings in the
live `synth-parameter-modulation` specification and fails when an identifier
appears more than once. Scope the scan to that live capability so archived
deltas, active change overlays, and intentionally reused generic prefixes in
other capability files do not produce false positives. Expose the check through
the root Makefile and include it in the root `test` target.

## Verification

The focused check must fail before the renumbering and pass afterward.
`openspec validate --all` must continue to pass, and repository searches must
show unique `spm-*` headings in the live parameter-modulation spec while the
archived files remain unchanged.
