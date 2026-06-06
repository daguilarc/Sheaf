# Human intervention requested

**Reason:** documenter completion predicate conflicts with documenter path permissions

The documenter pass has completed the allowed project documentation surfaces:

- `projects/conductor/docs/README.md`
- `projects/conductor/docs/reference/api.md`
- `projects/conductor/docs/reference/runtime.md`
- `projects/conductor/docs/how-to/operations.md`
- `projects/web/docs/README.md`

The quest remains in `QuestDocumenting` because the v2 runner's
`docs_updated_for_quest` predicate checks only root `docs/` paths:

```text
git diff --name-only <base_ref> HEAD -- docs
git diff --name-only <base_ref> -- docs
git ls-files --others --exclude-standard -- docs
```

This quest's `documenter` execution profile allows only:

```yaml
modify_allow:
  - "projects/conductor/docs/**"
  - "projects/web/docs/**"
  - "$currentQuest/human_intervention_request.md"
modify_block:
  - "**"
```

Earlier root `docs/` edits were reverted by the harness as illegal. The runner therefore
cannot observe the completed allowed project-doc updates as `docs_updated_for_quest`,
and repeated documenter turns remain `QuestDocumenting -> QuestDocumenting`.

Human resolution options:

- Update this quest's documenter allow-list to include the root `docs/` paths that the
  runner completion predicate requires, then rerun the documenter.
- Update the runner completion predicate to count the allowed project documentation
  paths for project-scoped documentation quests.
- Manually transition the quest to `Completed` if the current project-local
  documentation is accepted.
