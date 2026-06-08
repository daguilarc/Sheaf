# Issue responses

## Response PL-0001 2026-06-08T21:27:04Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Fixed WithSessionLock cleanup by tracking the exact chained tail promise stored in x_sequenceLocks and comparing against that tail before deleting the idle session key. This makes cleanup reachable without changing append serialization or sequence allocation. Verified with npm test in projects/sheaf-chat.
