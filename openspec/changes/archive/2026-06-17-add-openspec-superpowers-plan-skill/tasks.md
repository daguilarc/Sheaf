## 1. Add Global Skill Source

- [x] 1.1 Create `projects/agents/global/skills/openspec-superpowers-workflow/skill.yaml` with `id`, `name`, `description`, and targets for `claude`, `cursor`, `pi`, and `codex`.
- [x] 1.2 Create `projects/agents/global/skills/openspec-superpowers-workflow/SKILL.md` with concise workflow instructions for using OpenSpec artifacts as the source of truth for a Superpowers plan-and-execute run.

## 2. Define Workflow Semantics

- [x] 2.1 Document the inspection phase: select the OpenSpec change, run OpenSpec status/apply-instructions, and read every context file returned by OpenSpec.
- [x] 2.2 Document the brainstorming decision: require brainstorming for ambiguous, incomplete, or design-changing OpenSpec artifacts, and skip full brainstorming when approved artifacts are clear.
- [x] 2.3 Document the Superpowers plan phase: invoke `superpowers:writing-plans`, save the plan under `docs/superpowers/plans/`, split broad OpenSpec tasks into subagent-sized tasks, and include exact files, tests, commands, expected outputs, and commits.
- [x] 2.4 Document the execution phase: when explicitly pre-authorized, execute the generated plan with `superpowers:subagent-driven-development` without pausing after plan creation or between tasks.
- [x] 2.5 Document stop conditions: ambiguity, blockers, failed agentic infrastructure, approval-required commands, user interruption, or completion.
- [x] 2.6 Document OpenSpec progress sync: update OpenSpec task checkboxes only after corresponding Superpowers work is complete and verified.

## 3. Verify Distribution

- [x] 3.1 Run `python3 projects/agents/scripts/install.py check --scope repo` and confirm it reports the new skill outputs as missing or stale before installation.
- [x] 3.2 Run `python3 projects/agents/scripts/install.py install --scope repo` and confirm the skill renders into repo-local harness skill directories.
- [x] 3.3 Run `python3 projects/agents/scripts/install.py check --scope repo` and confirm repo-local outputs are up to date.
- [x] 3.4 Run `python3 projects/agents/scripts/install.py check --scope global` and confirm it reports the new user-global skill outputs as missing or stale without modifying global files.

## 4. Validate OpenSpec

- [x] 4.1 Run `openspec status --change "add-openspec-superpowers-plan-skill"` and confirm all required artifacts are complete.
- [x] 4.2 Run the repository's OpenSpec validation command for `add-openspec-superpowers-plan-skill` and resolve any proposal/spec/task formatting issues.
