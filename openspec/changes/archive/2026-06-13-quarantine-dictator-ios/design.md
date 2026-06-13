## Context

Dictator currently treats the iOS keyboard host app and keyboard extension as an active part of the project workflow. `projects/dictator/Makefile` defines `build` as `swift-build ios-build` and `test` as `swift-test ios-test`, so the root `make dictator-build` and `make dictator-test` shortcuts inherit Xcode and iOS Simulator requirements.

That made sense when the iOS keyboard was a primary client. The current workflow has shifted back to Apple's built-in dictation for iOS, while Dictator remains useful as a macOS Swift service, web UI, Launchpad pipeline, and VS Code hunk-control partner. The iOS source should stay in the repository because reactivation may still be valuable, but default validation should no longer depend on Xcode simulator availability.

## Goals / Non-Goals

**Goals:**

- Make default Dictator build/test commands Swift package/service focused.
- Ensure root `make dictator-build` and `make dictator-test` no longer build or test the iOS app by default.
- Keep iOS source, tests, Xcode project metadata, and setup docs available in the repo.
- Make iOS build/test commands explicitly opt-in and clearly documented as quarantined/manual revival lanes.
- Update specs and operations docs so future agents do not accidentally reintroduce simulator requirements into regular validation.

**Non-Goals:**

- Delete, rewrite, or archive the iOS source outside the repository.
- Fix existing iOS app, keyboard extension, Xcode project, signing, simulator, or UI-test issues.
- Change the Dictator service API that the iOS client currently calls.
- Remove documentation needed to revive or manually validate the iOS client.

## Decisions

### Default lanes become Swift-only

`projects/dictator/Makefile` should define `build` as the Swift package build and `test` as the Swift package tests. `all` should continue to mean the normal project workflow, which now resolves to `build test` without invoking Xcode. The root `dictator-build` and `dictator-test` targets can keep forwarding to the project Makefile because the project owns the lane semantics.

Alternative considered: keep `build`/`test` unchanged and ask developers to run `swift-build`/`swift-test`. That preserves the current friction and violates the repo's regular-test convention, where default tests should avoid machine-specific setup such as simulators.

### iOS lanes stay present but opt-in

Keep `ios-build` and `ios-test` as explicit Makefile targets that run the current `xcodebuild` commands. They should be described as quarantined/manual checks, not regular validation. This is the smallest reversible change: re-enabling iOS as a first-class client later can be done by reconnecting those targets to `build` and `test` after a deliberate decision.

Alternative considered: rename the iOS directory or remove Make targets entirely. That would make accidental default execution less likely, but it also makes revival harder and loses useful institutional memory about how to validate the retained code.

### Specs model both workflow and retained client status

Add a new `dictator-build-workflow` capability for default/opt-in validation behavior because no current Dictator spec owns Makefile lane semantics. Modify `dictator-ios-keyboard` to say the client is retained in quarantine and is not part of default validation.

Alternative considered: only update docs and the Makefile. That leaves the living specs saying the iOS app is an active client and invites future changes to treat simulator lanes as regular tests again.

### Documentation emphasizes current support level

Update `projects/dictator/README.md`, `projects/dictator/docs/README.md`, `projects/dictator/docs/operations.md`, and `projects/dictator/docs/architecture.md` so the first-read story matches reality: Dictator is currently a macOS/service workflow, with the iOS keyboard retained but de-emphasized.

Alternative considered: move all iOS docs under `src/ios-keyboard/` only. Keeping a short pointer in the main docs is better because it explains why the code exists while preventing it from appearing active.

## Risks / Trade-offs

- [Risk] The iOS client can drift because default validation no longer exercises it. -> Mitigation: label it quarantined, preserve manual `ios-build`/`ios-test` commands, and require an explicit reactivation change before treating it as supported again.
- [Risk] Existing agent workflows may assume `make dictator-test` covers every migrated source tree. -> Mitigation: update specs, operations docs, and coverage wording so the expected validation boundary is unambiguous.
- [Risk] Future cleanup might delete the retained iOS code as "unused." -> Mitigation: document that the code is intentionally retained for possible revival and keep the source-of-truth Xcode project in place.
- [Risk] Manual iOS lanes may still fail due to simulator or signing state. -> Mitigation: classify those lanes as manual revival checks, not blockers for routine Dictator work.

## Migration Plan

1. Update `projects/dictator/Makefile` so default `build`, `test`, and `all` avoid `ios-build` and `ios-test`.
2. Keep `ios-build` and `ios-test` available with their current `xcodebuild` commands, optionally adding a short Makefile comment to mark them quarantined.
3. Update Dictator README and operations docs to list Swift-only defaults and separate iOS manual checks.
4. Update architecture/docs index language so the iOS client is described as retained/quarantined rather than an active supported surface.
5. Update or add tests that pin Makefile lane composition without invoking Xcode.
6. Validate with `make -C projects/dictator build`, `make -C projects/dictator test`, and root `make dictator-build`/`make dictator-test` if practical.

Rollback is straightforward: reconnect `ios-build` to `build` and `ios-test` to `test`, then update docs/specs to mark the iOS client active again.

## Open Questions

- Should the opt-in iOS targets keep the exact names `ios-build` and `ios-test`, or should implementation add aliases such as `ios-quarantine-build` for stronger signaling while preserving the old names?
