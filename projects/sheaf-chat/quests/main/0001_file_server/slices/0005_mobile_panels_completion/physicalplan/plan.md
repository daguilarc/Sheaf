# Slice 5: Mobile Panels And Completion

## Objective

Complete the iOS/mobile workspace by adapting the file browser, tabs, and chat into pullable panels while preserving all file browsing, Markdown rendering, link navigation, and stale-tab behavior from desktop.

Expected outcome:

- On touch/mobile layouts, the current file view is primary.
- The directory explorer pulls out from the left.
- The open tab list pulls out from the right and displays tabs vertically.
- The chat window pulls up from the bottom.
- When panels are closed, side panels are hidden and only the current file is visible.
- The quest acceptance criteria are fully covered with tests or explicit verification notes.

## Key Files And Systems

- `projects/sheaf-chat/src/ui/sheaf-chat.js`
- `projects/sheaf-chat/src/ui/sheaf-chat.css`
- `projects/sheaf-chat/tests/ui/chatScreen.test.ts`
- `projects/sheaf-chat/docs/how-to/run-and-use.md` and/or `projects/sheaf-chat/docs/reference/api.md` if user-facing docs are updated.

## Existing APIs To Reuse

- Reuse `IsTouchLayout()` and existing `sheaf-chat-touch` / `sheaf-chat-desktop` class toggles.
- Reuse all workspace state and methods from slice 4. Mobile is a different presentation of the same explorer/tabs/file/chat state, not a second implementation.
- Reuse `OpenFile`, `SelectTab`, stale-tab logic, and Markdown link callbacks.
- Reuse the same websocket connection and REST file APIs.

## APIs To Extend Or Modify

- Add mobile panel state:

```js
{
  mobileExplorerOpen: false,
  mobileTabsOpen: false,
  mobileChatOpen: false
}
```

- Add commands:
  - `OpenMobilePanel("explorer" | "tabs" | "chat")`
  - `CloseMobilePanels()`
  - `ToggleMobilePanel(name)`
- Add mobile-only controls in the file-view toolbar:
  - explorer button;
  - tabs button;
  - chat button;
  - current file title.
- Add backdrop/gesture handling that closes panels without destroying chat or file state.

## Mobile Layout Details

- Use CSS media queries and the existing touch-layout detection to switch presentation.
- File pane occupies the viewport when panels are closed.
- Left explorer panel:
  - fixed or absolute over the file view;
  - width constrained to the viewport;
  - includes directory tree and close control.
- Right tab panel:
  - fixed or absolute over the file view;
  - vertical list of open tabs with readable names, stale state, selected state, and close buttons;
  - selecting a tab closes or leaves the panel according to the most ergonomic implementation, but must reveal the selected file.
- Bottom chat panel:
  - slides/pulls up from the bottom;
  - contains status, chat transcript, and composer;
  - respects safe-area insets and does not cover its own composer.
- Hidden side panels should not reserve layout width.
- Desktop resize handles should be hidden/disabled on mobile.

## Completion And Cleanup

- Remove any fallback UI paths made obsolete by the workspace if they are not needed.
- Ensure Markdown/KaTeX vendor assets are documented or covered by static tests.
- Ensure no feature flags or temporary compatibility branches remain unless they protect an intentional fallback, such as Markdown renderer unavailable.
- Update docs only where existing docs describe the old chat-only screen or API list.

## Validation

- UI tests forcing touch layout:
  - file view is primary;
  - explorer opens from left and can open files;
  - tab panel opens from right with vertical tabs and can select/close tabs;
  - chat panel opens from bottom and preserves composer/send behavior;
  - panels close without losing selected file, open tabs, chat state, or stale-tab markers.
- Regression tests proving desktop still renders the three-pane layout after mobile CSS/DOM changes.
- Manual/browser verification notes for iOS-sized viewport, safe-area padding, panel overlay behavior, tab readability, and no overlapping controls.
- Run `npm test` in `projects/sheaf-chat`.
