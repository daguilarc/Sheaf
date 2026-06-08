Polisher could not fully satisfy PL-0001's `git ls-files` close check because
this worktree's git index lives outside the writable sandbox at:

`/Users/joyo/Sheaf/.git/worktrees/sheaf-chat_main_0000_sheaf_chat/index`

Attempting `git add -A projects/sheaf-chat/tests/agents/modelRegistry` failed
with `Operation not permitted` while creating `index.lock`.

The slice tests were moved from the ignored `tests/agents/models/` path to the
non-ignored `tests/agents/modelRegistry/` path, and `git check-ignore` no longer
matches the files. A human or runner with permission to update the external git
index should stage the new test files so `git ls-files projects/sheaf-chat/tests/agents/`
lists:

- `projects/sheaf-chat/tests/agents/modelRegistry/auth.test.ts`
- `projects/sheaf-chat/tests/agents/modelRegistry/helpers.ts`
- `projects/sheaf-chat/tests/agents/modelRegistry/models.test.ts`
