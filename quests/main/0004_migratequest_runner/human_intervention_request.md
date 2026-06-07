# Human intervention requested

**Reason:** Documenter completion predicate conflicts with the allowed documentation path.

The Quest Runner documentation has been completed under the project-local docs tree:

- `projects/quest-runner/docs/README.md`
- `projects/quest-runner/docs/reference/dashboard.md`
- `projects/quest-runner/docs/reference/runtime-files.md`
- `projects/quest-runner/docs/explanation/architecture.md`
- `projects/quest-runner/docs/explanation/lifecycle.md`
- `projects/quest-runner/docs/how-to/run-service.md`
- `projects/quest-runner/docs/reference/testing.md`

Root-level `docs/` edits were rejected by the role path permissions and reverted.
However, the runner's `docs_updated_for_quest` predicate currently checks only
root `docs/` paths, so documenter steps that update `projects/quest-runner/docs/`
do not advance the quest from `QuestDocumenting` to `Completed`.

<details>

Relevant implementation:

- `projects/quest-runner/src/quest_runner_service/quest_runner.py`
- function `docs_updated_for_quest`

The predicate checks:

```text
git diff --name-only <base_ref> HEAD -- docs
git diff --name-only <base_ref> -- docs
git ls-files --others --exclude-standard -- docs
```

For this quest, the valid documentation target is `projects/quest-runner/docs/`.
Either the completion predicate needs to accept project-local docs paths, or a
human needs to authorize a root `docs/` documentation change despite the role
path restriction.

</details>
