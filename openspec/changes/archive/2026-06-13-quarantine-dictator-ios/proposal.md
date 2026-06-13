## Why

Apple's built-in dictation has improved enough that the Dictator iOS app and keyboard extension are no longer part of the normal day-to-day workflow. Keeping their simulator build and test lanes in the default Dictator commands adds friction and environmental failures without matching current usage.

## What Changes

- Remove the iOS host app and keyboard extension from Dictator's default `build`, `test`, and repo-level Dictator validation paths.
- Keep the iOS source, tests, Xcode project, setup notes, and dedicated opt-in commands available so the work can be revived later without reconstructing it.
- Mark the iOS client as quarantined/retired in docs and specs, with clear instructions that it is not maintained by default validation.
- Update operations docs, README references, and coverage expectations so default Dictator development is Swift package/service focused.
- Preserve explicit iOS build/test entry points for manual revival checks, but make them separate from normal build/test commands.

## Capabilities

### New Capabilities
- `dictator-build-workflow`: Dictator's local and repo-level build/test workflow, including which targets run by default and which retired lanes remain opt-in.

### Modified Capabilities
- `dictator-ios-keyboard`: Change the iOS keyboard capability from an active routinely validated client to a quarantined retained codebase with opt-in validation only.

## Impact

- Affected code: `projects/dictator/Makefile`, root `Makefile` forwarding behavior if needed, and any scripts/docs that describe or invoke Dictator build/test lanes.
- Affected docs/specs: `projects/dictator/README.md`, `projects/dictator/docs/README.md`, `projects/dictator/docs/operations.md`, `projects/dictator/docs/architecture.md`, `openspec/specs/dictator-ios-keyboard/spec.md`, and the new build workflow spec.
- Affected systems: routine local validation, CI or agent workflows that call `make build`, `make test`, `make dictator-build`, or `make dictator-test`.
- The iOS app, keyboard extension, Xcode project, and tests remain in the repository for future reactivation.
