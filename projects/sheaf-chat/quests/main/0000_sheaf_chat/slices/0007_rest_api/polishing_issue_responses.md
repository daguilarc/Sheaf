# Issue responses

## Response PL-0001 2026-06-08T22:42:35Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Removed the unsupported bare pile endpoint resolution so /api/piles/:pile now resolves as an unknown route, added a final dispatcher fallback that sends a JSON not_found response instead of falling through, and added REST regression assertions for GET and POST /api/piles/work returning 404 not_found with abort timeouts to catch hangs.
