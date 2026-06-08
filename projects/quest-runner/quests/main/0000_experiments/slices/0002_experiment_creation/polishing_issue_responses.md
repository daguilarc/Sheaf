# Issue responses

## Response PL-0001 2026-06-08T23:31:20Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Updated stop-node validation so the slice_completed alias maps through the slice machine node class and persists the canonical node-map key Completed, matching the values produced by Completed and SliceCompletedNode inputs. Added tests for all three equivalent inputs and updated experiment creation/API assertions to lock in the canonical persisted node_name.
