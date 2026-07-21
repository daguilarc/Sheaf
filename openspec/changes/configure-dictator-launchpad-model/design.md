## Context

`LaunchpadMIDIManager` currently owns two protocol constants globally: endpoint matching contains `"launchpad pro"`, and every Novation SysEx header uses model byte `0x0E`. The connected Launchpad Mini Mk3 exposes a different endpoint name and uses `0x0D`, while the existing note mapping and layout are intended to remain compatible.

Dictator currently treats tracked `config/dictator.json` as both repository defaults and mutable runtime state. `RuntimeConfigProvider` optionally loads `config/dictator.safe`, falls back to in-code bootstrap values, and eagerly writes `config/dictator.json` when it is absent. This causes machine-local edits to dirty the repository and gives defaults three possible sources.

The change crosses configuration decoding/storage, service startup and smoke-test asset resolution, Launchpad MIDI transport, reset paths, Conductor's fresh-Mac bootstrap path, documentation, and tests.

## Goals / Non-Goals

**Goals:**

- Select a supported Launchpad model through a typed runtime setting.
- Connect only to the selected model and use the selected model's SysEx identifier consistently.
- Preserve Pro Mk3 behavior for legacy configs with no model field while making the checked-in example select the Mini Mk3.
- Separate tracked defaults from ignored mutable state and avoid creating a live config until a successful mutation must be persisted.
- Use one required example file as the startup-default and reset source.
- Preserve ignored live config when running a worktree through smoke-test mode.
- Make the existing registered Conductor run command install its declared project-local dependencies and rebuild before launch on a fresh Mac.

**Non-Goals:**

- No automatic model detection or fallback to a different connected Launchpad.
- No simultaneous control of multiple Launchpads.
- No user-configurable raw endpoint substring or SysEx byte.
- No hot switching when `launchpad_model` changes; a service restart is required.
- No changes to pad coordinates, MIDI note mapping, layout JSON, or actions.
- No dashboard field for editing `launchpad_model` in this change.
- No shell-completion changes, global npm packages, or new repository bootstrap framework.

## Decisions

1. Represent the selection as a closed `LaunchpadModel` configuration enum.

   `RuntimeConfigFile` gains `launchpad_model` with values `pro_mk3` and `mini_mk3`. Decoding a missing field yields `pro_mk3`; decoding an unknown value fails rather than guessing. The checked-in example explicitly stores `mini_mk3`. A typed value keeps protocol details out of user configuration and makes unsupported hardware visible. Alternatives considered: raw `launchpad_endpoint_match` plus `launchpad_sysex_model_id` fields expose fragile protocol details; endpoint auto-detection becomes nondeterministic when both models are connected.

2. Resolve the enum to an immutable transport profile.

   A small profile value supplies the normalized endpoint substring and SysEx model byte: Pro Mk3 uses `"launchpad pro"` and `0x0E`; Mini Mk3 uses `"launchpad mini"` and `0x0D`. `LaunchpadMIDIManager` receives that profile at construction and uses it for source matching, destination matching, programmer-mode messages, RGB update messages, and sleep/wake messages. Message-building and endpoint-matching helpers remain testable without CoreMIDI endpoints.

3. Snapshot the Launchpad model at service startup.

   `DictatorServiceMain` already obtains the current runtime config before constructing services. It passes the selected model into the Launchpad controller/transport instead of making the MIDI queue observe mutable runtime state. The existing ten-second scan still connects a configured controller that appears later, but changing the config requires restarting the service. This keeps the change small and avoids reconnect races.

4. Make `config/dictator.example.json` the required production default source.

   The current tracked `config/dictator.json` content is copied to tracked `config/dictator.example.json` and extended with `"launchpad_model": "mini_mk3"`. `config/dictator.json` becomes ignored and `config/dictator.safe` is retired. Production startup must decode the example successfully even when a live file exists, because API defaults and reset depend on it. Missing or invalid example/live files surface as startup configuration errors; production no longer silently substitutes `RuntimeConfigFile.bootstrap()`.

5. Keep the example-backed state in memory until the first write.

   When live config is absent, `RuntimeConfigProvider` uses the decoded example as both current state and startup defaults without calling `save`. Any successful persistence path—config patch, prompt selection, injectable-rule mutation, reset, explicit persist, or Launchpad safe restore—writes a complete, atomically replaced `config/dictator.json` snapshot. Failed mutations and read-only startup/API calls leave the live file absent. Reset copies example values but refreshes `updated_at`.

6. Treat ignored live config as a smoke-test asset.

   In normal mode, the live and example paths are under the active repository root. In smoke-test mode, the live `config/dictator.json`, API keys, and model assets resolve from `SHEAF_SMOKE_ASSET_ROOT`, while the tracked `config/dictator.example.json` and `config/services.json` resolve from the active worktree. If the main checkout has no live config, the worktree example supplies current in-memory state without materializing a file. This preserves the existing worktree-code/production-asset contract after the live config becomes ignored.

7. Keep the Launchpad model outside the editable dashboard field set.

   The dashboard continues to expose its existing eight live-editable fields. `launchpad_model` is a startup setting edited directly in the JSON file, consistent with the restart requirement. The config API still returns example-derived defaults for the editable fields, and its first successful mutation materializes the complete config including `launchpad_model`.

8. Make the registered Conductor run target self-bootstrap through existing targets.

   `projects/conductor/Makefile` keeps project-local `npm install` as the dependency installation mechanism. Its `run` target depends on the existing `install` and `build` targets before invoking `start_conductor.sh`, so the registry's `make conductor-run` command works when `node_modules` or compiled output is absent. Alternatives considered: globally installing `ws` would contradict the package manifest and make versions machine-dependent; adding a new bootstrap script would duplicate the existing Makefile workflow; merely improving the error message would leave fresh Macs unable to run the registered command.

## Risks / Trade-offs

- [Mini Mk3 differs beyond the SysEx model byte] → Keep the accepted scope explicit, retain existing mapping tests, add both profile header tests, and require a human Mini Mk3 smoke test during implementation.
- [Endpoint display names vary] → Use case-insensitive containment against model-specific stable substrings and test representative source/destination names.
- [A bad example would disable startup for everyone] → Treat the example as a required contract, decode it in tests, and fail loudly with the offending path instead of silently running unexpected defaults.
- [Existing clones lose the tracked live path on update] → Preserve its exact committed content in the example; document that future local customization belongs in the ignored live file.
- [Smoke tests could mutate a developer's main live config] → Preserve the existing behavior that runtime mutations target the resolved live store, document it, and limit smoke tests to intentional configuration operations.
- [The startup-only model may surprise dashboard users] → Document the restart requirement and omit a dashboard control that would falsely imply immediate application.
- [Installing and building on each Conductor run adds startup latency] → Prefer deterministic, idempotent fresh-Mac startup over a fast command that depends on undocumented prior state; retain the explicit lower-level npm commands for debugging.

## Migration Plan

1. Copy the tracked live configuration to `config/dictator.example.json`, add `launchpad_model: mini_mk3`, ignore `config/dictator.json`, and remove it from Git tracking without treating the example as mutable state.
2. Replace safe/bootstrap production fallback wiring with required example/live stores and lazy persistence.
3. Add the typed Launchpad model/profile and inject it into the MIDI manager at startup.
4. Update smoke-test asset resolution, API/reset behavior, docs, and tests.
5. Verify a clean checkout starts from the example without creating a live file; verify the first mutation creates the ignored live file.
6. Restart Dictator with the Mini selected and manually verify connection, programmer mode, RGB rendering, pad input, sleep, and wake.
7. Make `make conductor-run` depend on Conductor's existing install/build targets, update its docs/spec, and verify it starts with project-local dependencies initially absent.

Rollback restores the tracked `config/dictator.json`, safe/bootstrap fallback behavior, and the Pro-only transport constants. A local ignored live file can be preserved separately during rollback.

## Open Questions

None.
