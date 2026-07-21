## Why

Dictator hard-codes the Launchpad Pro Mk3 MIDI endpoint name and SysEx model byte, so it cannot connect to the Launchpad Mini Mk3 currently used by this repository. Its tracked live runtime config also mixes repository defaults with machine-local state and is eagerly materialized even when no local customization exists.

## What Changes

- Add a closed `launchpad_model` runtime setting with `pro_mk3` and `mini_mk3` profiles; missing legacy values remain compatible by defaulting to `pro_mk3`.
- Make each Launchpad profile supply its MIDI endpoint match and SysEx model byte (`0x0E` for Pro Mk3, `0x0D` for Mini Mk3), and connect only to endpoints matching the configured profile without falling back to another Launchpad model.
- Read the Launchpad selection at service startup; changing it takes effect after restarting Dictator. Existing pad layout, coordinate mapping, and actions remain unchanged.
- **BREAKING** Replace the tracked live `config/dictator.json` with a tracked `config/dictator.example.json`, copied from the current configuration and selecting `mini_mk3`; make `config/dictator.json` an ignored machine-local file.
- When the live config is absent, use the example config in memory without creating a live file. On the first persisted configuration change, write a complete live config derived from the example-backed state.
- Replace the optional `config/dictator.safe` and bootstrap-default reset source with the required example config for startup defaults, API reset, and the Launchpad safe-config action.
- Make Conductor's existing registered `make conductor-run` command self-bootstrap its project-local npm dependencies and compiled output on a fresh Mac before starting the service.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `dictator-launchpad`: Select the supported Launchpad model from runtime configuration, match only that controller, and use its SysEx model byte; restore safe configuration from the example-backed defaults.
- `dictator-service-lifecycle`: Load the ignored live Dictator config when present, otherwise use the tracked example without eagerly creating the live file.
- `dictator-web-ui`: Derive displayed defaults and reset behavior from the example config and persist a live config only when a mutation occurs.
- `conductor-service-management`: Preserve the existing project-local npm deployment model while making the registered run command install and build before launch.

## Impact

- Repository configuration: `.gitignore`, `config/dictator.json`, and new `config/dictator.example.json`.
- Runtime configuration model and storage: `RuntimeConfigFile`, `RuntimeConfigProvider`, config path helpers, reset behavior, and related tests.
- Launchpad transport and service startup: `LaunchpadMIDIManager`, `LaunchpadServiceController`, and construction in `DictatorServiceMain`.
- Config API and documentation: Dictator web API defaults/reset behavior, `projects/dictator/docs/contracts/config.md`, operations/architecture references, and the three modified capability specs.
- Test coverage: config decoding/default/lazy-persistence tests plus Launchpad endpoint matching and SysEx construction tests for both supported profiles.
- Fresh-Mac service bootstrap: Conductor Makefile workflow, its static regression coverage, and operational documentation.
