## Context

Agent Review has two input surfaces for the same navigation and mutation actions:

- Browser controls send Agent Review WebSocket `command` frames from `sheaf-chat.js`.
- Launchpad cells are owned through Dictator's generic RPC; Dictator forwards `launchpad.cellPressed` events to Sheaf Chat, and Sheaf Chat maps coordinates to Agent Review actions.

The intended boundary is that Dictator owns hardware rendering and event forwarding, while Sheaf Chat owns review state and commands. Recent unified file-viewer behavior introduced browser-local command intent flags, so browser button clicks and Launchpad-originated commands no longer drive identical post-command file-viewer synchronization.

## Goals / Non-Goals

**Goals:**

- Prove, with paired tests, that browser controls and matching Launchpad cells produce the same Agent Review navigation behavior.
- Cover cross-file navigation through the unified file viewer, including the scenario where the selected file has no hunk and navigation must open the next or previous hunk file.
- Ensure Launchpad command handling uses the same command dispatch semantics as browser WebSocket commands.
- Make any remaining differences explicit and limited to controls that do not have browser-command equivalents, such as the review/comment/post cell.

**Non-Goals:**

- Do not change Dictator's generic WebSocket RPC protocol unless a failing test proves it is necessary.
- Do not redesign Agent Review hunk discovery, patch application, or review draft serialization.
- Do not add a new user-visible Launchpad layout.

## Decisions

### Normalize Launchpad presses into Agent Review commands

Launchpad navigation and mutation cells should be edge adapters. A cell press should resolve to the same `AgentReviewAction` and pass through the same command execution path as a browser command, including command-result semantics visible to connected review UIs.

Alternative considered: keep Launchpad as a server-only shortcut that mutates current state and broadcasts a plain state frame. That preserves the existing split and lets browser-only post-command flags decide whether the file viewer follows the command, which is exactly the class of bug this change is meant to eliminate.

Launchpad-originated command results should use generated command ids with a diagnostic prefix such as `launchpad:`. Browser commands already carry client-generated ids; giving hardware-originated commands their own visible id namespace makes logs, tests, and multi-client traces easier to interpret without changing command semantics.

### Test parity by running paired flows

Add paired test helpers that run the same scripted Agent Review flow twice:

1. Browser-origin flow: click the visible browser controls.
2. Launchpad-origin flow: inject fake Dictator RPC `launchpad.cellPressed` events for the matching cells.

Each version must assert the same externally important state after every step: selected tab/file, focused hunk, inline rows, scroll target, command result/state frame, and Launchpad cell availability. The Launchpad version must fail against the current broken behavior before the implementation fix lands.

Alternative considered: add one focused Launchpad next-file test. That would catch the known bug but leave the broader parity contract unprotected. The paired-flow approach makes future drift harder.

### Let UI synchronization derive from command results, not local click flags

The unified file viewer should follow successful Agent Review command results independent of input origin. Browser-local flags can remain as transient implementation details only if they do not affect behavior differently for Launchpad-originated commands.

Alternative considered: teach the Launchpad path to set browser-local flags indirectly. That couples hardware events to browser internals and does not work for multiple connected review clients.

## Risks / Trade-offs

- [Tests become too coupled to implementation details] → Assert user-observable and protocol-observable behavior: selected file, current hunk, command result, visible inline rows, and cell state. Avoid asserting private helper names.
- [Launchpad-generated command results surprise passive clients] → Treat this as desired synchronization: all connected Agent Review clients should follow the authoritative review command result.
- [Review/comment/post cell has different semantics] → Keep it explicitly outside command parity tests and document why; it is not a browser navigation/mutation command.
- [Existing tests pass without proving the new failure] → Include a task to run the new Launchpad parity test before the fix and confirm it fails for the current regression.

## Migration Plan

1. Add failing paired tests for browser and Launchpad navigation flows.
2. Refactor Launchpad coordinate handling to synthesize the same Agent Review command/result path used by browser commands.
3. Update unified file-viewer synchronization so successful command results open/reveal the authoritative current hunk regardless of origin.
4. Run Sheaf Chat tests and the relevant Dictator RPC/Launchpad tests.
5. Rollback is code-only: revert the Sheaf Chat changes. Dictator protocol state is unchanged.

## Open Questions

- None.
