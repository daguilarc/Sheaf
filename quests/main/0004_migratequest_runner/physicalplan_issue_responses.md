# Issue responses

## Response QP-0001 2026-06-07T02:17:59Z

- issue_id: QP-0001
- outcome: Fixed
- explanation: Clarified test migration ownership across slices. Slice 0001 now owns only the initial runnable core test subset and its validation gate no longer collects REST/API/dashboard tests that depend on later slices. Slices 0002, 0003, 0004, and 0005 now each name the test modules or split test portions they own, including explicitly assigning REST route tests to slice 0004 and dashboard asset JS tests to slice 0005.

## Response QP-0002 2026-06-07T02:17:59Z

- issue_id: QP-0002
- outcome: Fixed
- explanation: Defined the runtime quest schema docs home as `projects/quest-runner/src/quest_runner_service/quest_docs/**`, bundled unchanged from `/Users/joyo/conductor/docs/quest/**` in slice 0001 and used as `quest_docs_dir` in slice 0003. Slice 0006 now explicitly limits the Sheaf documentation rewrite to `projects/quest-runner/docs/**` and `README.md`, and states that the runtime schema docs package must not be rewritten or Diataxis-converted.
