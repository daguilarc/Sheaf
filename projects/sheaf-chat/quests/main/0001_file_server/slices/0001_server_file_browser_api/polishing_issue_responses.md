# Issue responses

## Response PL-0001 2026-06-10T03:44:12Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Changed ListSessionDirectory to compute listed entry paths from the entry's own path under the parent directory, while retaining resolved symlink targets for safety/kind checks. Added a direct regression test for an in-root symlink asserting docs/link is reported separately from docs/sub with matching basename and no duplicate paths.
