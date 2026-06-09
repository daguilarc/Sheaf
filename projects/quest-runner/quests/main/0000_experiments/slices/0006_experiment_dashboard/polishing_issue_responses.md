# Issue responses

## Response PL-0001 2026-06-09T03:40:16Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Removed the dead archived_experiments_payload helper so the tested quest_overview_payload archived-experiments branch remains the single summary path; removed the unused source_qdir parameter from open_experiment_summary_row and its caller; updated experiment_archive_detail_payload to use experiments.experiment_dir_name for archived experiment directories. Verified with PYTHONPATH=src .venv/bin/python -m unittest tests.test_dashboard_api.
