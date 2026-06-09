# Issue responses

## Response PL-0001 2026-06-09T03:58:43Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Updated docs/reference/api.md so POST /experiments/create documents dirty/detached source checkout under 400 InvalidQuestInput behavior and limits 422 to non-git source checkouts. Verified with PYTHONPATH=src .venv/bin/python -m unittest tests.test_quest_service_api.
