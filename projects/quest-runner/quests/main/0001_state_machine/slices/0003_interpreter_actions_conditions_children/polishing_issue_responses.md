# Issue responses

## Response PL-0001 2026-06-09T21:57:11Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Deduplicated collection path matching by making workflow_state_io.path_matches_collection_pattern the single implementation and importing it into workflow_paths; workflow_paths no longer contains a copied matcher body. Verified with PYTHONPATH=src .venv/bin/python -m unittest tests.test_workflow_interpreter tests.test_workflow_state_io and make test.

## Response PL-0002 2026-06-09T21:57:11Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Added SyntheticWorkflowGenericityTests with a synthetic WorkflowDefinition using non-default machine/state names, collection path chapters/*, active tag current_chapter, profile inventor, issue file bespoke_reviews.md, and marker files green.flag/launch.marker/mission.marker. The test runs parent child-selection and child-step transitions through WorkflowMachineLoader and asserts persisted/logical renamed states. Verified with PYTHONPATH=src .venv/bin/python -m unittest tests.test_workflow_interpreter tests.test_workflow_state_io and make test.
