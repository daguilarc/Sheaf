# step 5 — physical_planner

**thread:** Sheaf_quest_0001_physical_planner

## output

QP-0004 is open. I need to fix slice 0006's tab-switch handling so a user tab switch after an observed viewport/cursor produces one freshness push (not a silent reset).Planning doc, not malware. Now let me update the State storage and Change-event filtering sections for tab switches.Now update Cross-tool observation rules to flip `everObserved`, and Notification gating to use the new structure, plus add tests.Now append the response to the issue responses file.Not malware. Append response.QP-0004 addressed:

- Slice 0006's `ViewportFreshnessState` and `CursorFreshnessState` now carry an `everObserved` flag.
- A new "Active-editor changes (tab switches)" subsection defines the handler: agent-originated switches (inside a mutation guard) silently update `currentFile`; user-driven switches produce one viewport push and one cursor push when those have been previously observed, with `payload.file` set to the new active file (or, when all tabs close, the previously observed file).
- Duplicate suppression flows from the existing `notificationSent` gating; re-observation reopens the gate.
- File freshness is explicitly unaffected by tab switches.
- `tabSwitch.test.ts` validates pre-observation no-push, post-observation push with correct payload file, duplicate suppression, re-observation reopening, agent-mutation suppression, and the all-tabs-closed fallback.

Response appended to `physicalplan_issue_responses.md`.

