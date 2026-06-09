# Issue responses

## Response PL-0001 2026-06-09T01:35:31Z

- issue_id: PL-0001
- outcome: NotFixed
- explanation: Escalated via quest-root human_intervention_request.md: the requested completion criterion requires experiment.json to contain the final HEAD commit SHA of the commit that contains experiment.json itself, which is a Git hash self-reference and not implementable without a spec/product decision.

## Response PL-0002 2026-06-09T01:35:31Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Added retry cleanup for source experiment archive artifacts on artifact-copy and push failures, and added tests asserting the source checkout is clean after partial copy failure plus push failure retry succeeds.

## Response PL-0001 2026-06-09T03:18:46Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: After raising a human intervention request, I spoke with the human. The human confirmed there are no active consumers for source_commit and instructed me to remove it. Landing now no longer writes source_commit to experiment metadata, returns it from the API/service, prints it in CLI output, or documents it as a landing field; tests were updated accordingly.

## Response PL-0001 2026-06-09T03:21:52Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Verified in this pass: source_commit has been removed from the landing metadata/API/CLI/docs surface after human instruction. commit_experiment_land no longer amends experiment.json, land_experiment responses omit source_commit, and focused landing/CLI tests pass.

## Response PL-0002 2026-06-09T03:21:52Z

- issue_id: PL-0002
- outcome: Fixed
- explanation: Verified in this pass: land_experiment cleans copied archive artifacts on push and copy failures, preserving a clean source checkout for retry. Focused landing/CLI tests pass.
