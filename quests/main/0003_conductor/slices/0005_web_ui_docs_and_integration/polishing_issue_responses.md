# Issue responses

## Response PR-0001 2026-06-06T22:10:00Z

- issue_id: PR-0001
- outcome: Fixed
- explanation: Added a bounded `max-height: 70vh` to `.sheaf-log-view` in `projects/web/src/sheaf.css` while keeping `overflow: auto`, so long log output creates an internal scrollbar on the `#log-view` element and the existing upward-scroll handler can trigger `read_before`. Added a regression assertion in `projects/conductor/tests/ui.test.ts` that the shared log view CSS includes both the height bound and internal overflow.
