# Issue responses

## Response QP-0001 2026-06-06T19:33:04Z

- issue_id: QP-0001
- outcome: Fixed
- explanation: Added Conductor's own `POST /exit` lifecycle endpoint to slice 0002's backend-core plan, including shutdown-controller injection, poller stop behavior, and tests. Updated slice 0003 so stop/restart explicitly cover the registered `conductor` self-management path via `/exit` with injected fakes. Updated slice 0005 docs/UI integration planning to document `POST /exit` and the operator impact of stopping Conductor itself.
