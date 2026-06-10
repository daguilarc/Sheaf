# Issues

## Issue PL-0001

- status: completed
- owner_role: polisher_reviewer
- created_at: 2026-06-10T04:25:59Z
- updated_at: 2026-06-10T04:29:38Z
- title: Mobile chat panel double-applies safe-area bottom inset
- details: WHAT IS WRONG:
The mobile chat panel applies the bottom safe-area inset twice. In projects/sheaf-chat/src/ui/sheaf-chat.css the rule '.sheaf-chat-mobile-panel--chat' sets 'padding-bottom: env(safe-area-inset-bottom, 0px)', and the rule '.sheaf-chat-mobile-panel--chat .sheaf-chat-composer' sets 'padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px))'. Because the composer is the bottom-most child of the chat panel, the inset is added once by the panel and again by the composer, so on a notched device the clearance below the Send button is '10px + 2 * env(safe-area-inset-bottom)' instead of the intended '10px + 1 * env(safe-area-inset-bottom)'.

WHY IT IS A PROBLEM:
The slice spec requires the bottom chat panel to respect safe-area insets and not cover its own composer. The composer is not covered, but the doubled inset produces a visibly oversized empty band below the composer on devices with a home indicator, a cosmetic regression against the intended safe-area handling.

WHAT MUST BE TRUE TO MARK COMPLETED:
The safe-area bottom inset must be applied exactly once to the space below the composer (for example keep it on the composer and drop it from the panel, or vice versa), so that on a notched viewport the clearance below the Send button equals a single 'env(safe-area-inset-bottom)' plus the intended fixed padding. The chat panel must still not cover its composer after the change.
- resolution_notes: none
