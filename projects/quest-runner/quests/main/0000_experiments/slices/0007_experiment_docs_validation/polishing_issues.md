# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-09T03:56:54Z
- updated_at: 2026-06-09T03:56:54Z
- title: api.md: /experiments/create error table maps dirty/detached source checkout to 422 instead of 400
- details: WHAT IS WRONG
In docs/reference/api.md, the POST /experiments/create error-response table states:

| 422 | Source checkout not a git repo or not clean |
| 400 | Invalid input, unknown start step, or unknown stop node |

The '... or not clean' clause on the 422 row is incorrect. A dirty or detached source checkout does NOT return 422.

EVIDENCE
- quest_service.QuestService.create_experiment (quest_service.py:567-576) calls assert_source_checkout_clean and catches SourceCheckoutDetached / SourceCheckoutNotClean, re-raising both as InvalidQuestInput.
- api.py errorhandler for InvalidQuestInput returns 400 (api.py:76-78).
- Only NotAGitRepo returns 422 (api.py:68-70), raised when _is_git_repo is false.
- So: not-a-git-repo => 422; dirty/detached => 400.

WHY IT IS A PROBLEM
This slice's purpose is accurate operational/API documentation. The documented error contract for a public endpoint is wrong: an operator scripting against /experiments/create would branch on the wrong status code for a dirty/detached checkout. It is also internally inconsistent with the SAME file's create_quest table (api.md:86-91), which correctly lists '422 | Source checkout is not a git repository' and relegates dirty/detached to prose covered by the 400 'invalid input' row.

WHAT MUST BE TRUE TO CLOSE
The /experiments/create error table must reflect actual behavior, e.g. change the 422 row to 'Source checkout is not a git repository' and fold dirty/detached source checkout into the 400 row (or matching prose), consistent with the create_quest documentation in the same file.
- resolution_notes: none
