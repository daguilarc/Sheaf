## Why

The Controllers page block editor is fragile: edits, additions, and rebuilds can
change the rows being rendered while a section is open, which breaks user
expectations and leaves too much behavior untested. We need the page to treat
the persisted profile arrays as the source of truth, but treat the open
section's block/singleton rows as the stable in-memory editing surface until the
user closes and reopens that section.

## What Changes

- **Open-section edit sessions.** A section coalesces persisted profile
  elements into block rows and singleton rows only when it is opened. While it
  stays open, the UI renders that session-owned row list rather than
  re-coalescing after each edit or rebuild.
- **Explicit coalesce and expand boundaries.** JUCE-free pure functions
  coalesce sorted persisted elements into presentation rows, expand session rows
  back to persisted elements, and normalize/sort persisted config arrays for
  commits.
- **Stable edits, adds, and deletes.** Editing a row mutates the in-memory
  session row and flushes the expanded/normalized persisted config, but does not
  replace the visible row list. "+" and "+B" append session rows at the end of
  the selected group/section. Delete removes the targeted session row. Only
  close-and-reopen discards the session and re-coalesces from persisted truth.
- **Message kind and argument split.** System-message editors select the message
  kind separately from its argument fields, so users see "Scene Select" plus
  argument `3`, not dropdown entries like "Scene Select 3".
- **Shared system-message implementation.** WRLD.Bldr, Launchpad, Twister, and
  Generic controllers share one system-message editing/coalescing/expansion
  pipeline; controller kinds differ only through their address schema and
  validation rules.
- **Scrolling contract fix.** The portable Controllers page tree separates
  visible viewport bounds from scroll content extent so JUCE and future browser
  renderers can both make every expanded row reachable.
- **Model-based simulation coverage.** The Controllers page gains deterministic
  state-machine tests that randomly open/close nested sections, add/delete rows
  and blocks, edit parameters, scroll, and compare both the rendered/session
  state and the expanded persisted state against an independent oracle.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `synth-runtime-ui`: refines the Controllers page block presentation,
  edit-session stability, scrollability, and JUCE-free testing requirements.

## Impact

- `projects/synth/include/synth` and `projects/synth/src`: replace the fragile
  identity re-resolution path with an explicit controller config edit-session
  model, plus pure coalesce/expand/normalize helpers.
- `projects/synth/include/synth/ControllersPageUI.hpp`: carry scroll viewport
  bounds and content extents separately, and dispatch row actions by stable
  session row identity where needed.
- `projects/synth/juce`: adapt the JUCE renderer/harness to the new tree
  contract and keep JUCE-specific code segregated there.
- `projects/synth/tests` and `projects/synth/juce` tests: add pure function
  unit tests, session stability tests, seeded simulation tests, and scrolling
  regression coverage.
- No persistence format change; the profile arrays remain the saved source of
  truth.
