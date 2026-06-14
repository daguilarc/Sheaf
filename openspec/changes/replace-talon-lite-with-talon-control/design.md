## Context

Dictator currently owns two Launchpad dictation flows: the normal Dictator audio-to-refinement pipeline and a Talon Lite mode that transcribes constrained utterances into a small Talon-like command grammar. Talon Lite is implemented inside Dictator and appears as a static Launchpad pad at `(1,7)`, but it is less reliable than the full Talon installation already present on the machine.

Live local validation confirmed the installed Talon app exposes the control primitives needed for this change. Through the Talon REPL, `actions.speech.enable()` wakes Talon, `actions.speech.disable()` puts it to sleep, `actions.speech.enabled()` reports the current state, and `scope.get("mode")` includes `"sleep"` when Talon is asleep.

Dictator is Swift, while Talon user scripts are Python running inside Talon. The integration needs a small boundary object so Dictator does not depend directly on Talon's private REPL protocol and so the Sheaf repo remains the source of truth for the Talon-side code.

## Goals / Non-Goals

**Goals:**

- Replace the Launchpad Talon Lite button with a full Talon wake/sleep toggle and status indicator.
- Store the Talon-side bridge source in `projects/dictator/src/talon/`.
- Install the bridge into `~/.talon/user` through a Make command that creates or repairs a symlink to the repo source.
- Use Talon's official user-script APIs for wake, sleep, and state checks.
- Force Talon asleep before any non-Talon Dictator dictation starts, regardless of the cached or observed Talon state.
- Refuse to wake Talon while Dictator is recording, refining, or otherwise running non-Talon dictation work.
- Keep the integration usable when Talon is not running by rendering an unavailable state and logging failures instead of breaking Dictator startup.

**Non-Goals:**

- Do not implement full Talon command grammar, Talon command execution, or Talon user customization inside Dictator.
- Do not uninstall Talon or manage the Talon app lifecycle beyond reporting the bridge as unavailable when it is absent.
- Do not move the user's existing `~/.talon/user/community` files into this repository.
- Do not expose Talon control over the public Dictator HTTP API.
- Do not require Talon to be awake for normal Dictator dictation.

## Decisions

### Use a Sheaf-owned Talon bridge script

Create a small Talon user-script package under `projects/dictator/src/talon/sheaf_control/` and install it into `~/.talon/user/sheaf_control` as a symlink. The bridge exposes local-only status and control operations and implements them using Talon's in-process Python API.

Alternatives considered:

- Directly drive Talon's REPL socket from Swift. This works for manual validation, but the REPL protocol is private and interactive.
- Use macOS UI automation or menu commands. That would be more brittle and would not give reliable state checks.

### Use local-only request/response IPC

The bridge should expose a minimal local interface with JSON operations:

- `GET /status` returns `{"available": true, "speech_enabled": <bool>, "mode": [<string>]}`.
- `POST /sleep` calls `actions.speech.disable()` and returns the resulting status.
- `POST /wake` calls `actions.speech.enable()` and returns the resulting status.

The implementation uses loopback HTTP on `127.0.0.1:28579`. It binds only to the local machine, does not require network access, and fails closed if Talon is not running.

Alternatives considered:

- Use files for state and commands. This makes wake/sleep asynchronous and harder to reason about.
- Depend on the bundled `talon-rpc` binary. Its protocol is not documented enough for Dictator to own directly.

### Add a Dictator TalonControlClient

Dictator should have a small async client abstraction that can query status, request sleep, and request wake. It should return explicit states such as `awake`, `asleep`, `unavailable`, and `error(message)` so Launchpad rendering and logs can stay deterministic.

This client is shared by:

- Launchpad Talon control pad.
- Normal Launchpad recording start.
- Auxiliary Launchpad recording start.
- Voice diff review recording start.
- HTTP `/v1/dictate-audio` start.

### Make non-Talon dictation always send sleep first

Before starting any Dictator-owned dictation flow that is not Talon, Dictator sends a Talon sleep command without checking whether Talon is already asleep. This is intentionally redundant: sleeping an already-sleeping Talon instance is cheap, while leaving Talon secretly awake can capture the user's speech at the same time as Dictator.

If the Talon bridge is unavailable, Dictator logs that Talon sleep could not be sent and continues with non-Talon dictation. The safety goal is best-effort isolation from Talon, not making Dictator depend on Talon for its own dictation.

### Refuse Talon wake while Dictator is busy

The current shared activity tracker only reports `idle` or `processing`. This change should introduce a small dictation activity arbiter or extend the tracker so the Launchpad controller and HTTP server can distinguish idle from active recording/processing. The Talon button checks the arbiter before wake:

- If Dictator is idle and Talon is asleep/unavailable, pressing the pad attempts wake.
- If Talon is awake, pressing the pad sleeps Talon.
- If Dictator is busy, pressing the pad refuses wake and leaves Talon asleep.

### Repurpose the Talon Lite pad and retire Talon Lite from the primary layout

The `(1,7)` pad should become a status-colored Talon control pad. The layout action should be renamed away from `talon_lite_dictation`, and the dynamic color should come from Talon status instead of a static orange color.

The product Launchpad layout and normal Launchpad controller stop invoking the Talon Lite pipeline, and the Talon Lite core (`TalonLiteParser`, `TalonLiteRecoveryEngine`, the `talon_lite` transcription decode mode and its whisper guidance) and all `TalonLite*Tests` are removed outright in this change. The `talon_lite` interaction-history mode is also dropped; historical records carrying it decode as `revision`.

## Risks / Trade-offs

- [Risk] Talon scripts reload or the Talon app quits while Dictator is running. -> Mitigation: every control operation has a short timeout and maps failure to `unavailable` or `error`; Launchpad rendering polls/invalidates after failed operations.
- [Risk] A loopback HTTP bridge could be reachable by local processes. -> Mitigation: bind only to `127.0.0.1` or a Unix socket, keep operations limited to wake/sleep/status, and do not expose arbitrary code execution.
- [Risk] The symlink can be deleted or replaced by Talon/user maintenance. -> Mitigation: the Make install command is idempotent and verifies the symlink target.
- [Risk] Talon's `actions.speech.disable()` can notify "already asleep" through community overrides. -> Mitigation: this is acceptable; the operation remains idempotent and safer than relying on cached state.
- [Risk] Removing Talon Lite from the Launchpad path may surprise any remaining users of that pad. -> Mitigation: the replacement occupies the same button and provides a better version of the intended Talon-adjacent workflow.
- [Risk] Existing tests expect `talon_lite_dictation` in the product or fixture layout. -> Mitigation: update layout decode tests, product layout guards, and interaction-mode expectations to pin the new Talon action instead.

## Migration Plan

1. Add the Talon bridge source under the Sheaf repo.
2. Add `make install-talon-bridge` or an equivalent Dictator-scoped Make target that creates `~/.talon/user/sheaf_control -> <repo>/projects/dictator/src/talon/sheaf_control`.
3. Ask the user to reload Talon scripts or restart Talon after installing the symlink.
4. Add Dictator's Talon control client and status model.
5. Replace the Launchpad Talon Lite action/role/layout entry with the Talon control action and dynamic status color.
6. Add unconditional Talon sleep calls before every non-Talon dictation start path.
7. Extend or replace the dictation activity tracker so Talon wake can be refused while Dictator is active.
8. Update tests and docs/spec links.

Rollback is straightforward: restore the previous Launchpad layout/action and leave the Talon bridge symlink unused. Removing the symlink disables the bridge without modifying the user's other Talon scripts.

## Resolved Scope Notes

- The bridge transport is loopback HTTP for straightforward Swift integration and manual `curl` testing.
- Talon state remains Launchpad-only for now; the Dictator web status API is unchanged.
- The obsolete Talon Lite core parser/recovery/rendering code, its `talon_lite` transcription decode mode and whisper guidance, and all `TalonLite*Tests` are removed outright in this change rather than left as legacy tested code.
