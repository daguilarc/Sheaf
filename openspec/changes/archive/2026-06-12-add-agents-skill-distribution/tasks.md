## 1. Source Tree

- [x] 1.1 Create `projects/agents/` with `Makefile`, `scripts/`, and `global/` directories
- [x] 1.2 Add canonical `projects/agents/global/AGENTS.md`
- [x] 1.3 Add `projects/agents/global/skills/` source directory
- [x] 1.4 Document the source skill metadata format

## 2. Draft-to-Skill Conversion

- [x] 2.1 Convert `/Users/joyo/Desktop/prompt_draft/about_me.me` to `projects/agents/global/skills/about-me/` with a description that includes the word `typo`
- [x] 2.2 Convert `/Users/joyo/Desktop/prompt_draft/git_workflow.md` to `projects/agents/global/skills/git-workflow/` with a description that includes the word `land`
- [x] 2.3 Convert `/Users/joyo/Desktop/prompt_draft/incremental_mode.md` to `projects/agents/global/skills/incremental-mode/`
- [x] 2.4 Convert `/Users/joyo/Desktop/prompt_draft/pyramid_index.md` to `projects/agents/global/skills/pyramid-index/`
- [x] 2.5 Convert `/Users/joyo/Desktop/prompt_draft/software_principles.md` to `projects/agents/global/skills/software-principles/`

## 3. Installer

- [x] 3.1 Implement `projects/agents/scripts/install.py install`
- [x] 3.2 Implement `projects/agents/scripts/install.py check`
- [x] 3.3 Implement `projects/agents/scripts/install.py clean`
- [x] 3.4 Render `projects/agents/global/AGENTS.md` to root `AGENTS.md`
- [x] 3.5 Render `projects/agents/global/AGENTS.md` to root `CLAUDE.md`
- [x] 3.6 Render skills to `.claude/skills/<skill-id>/SKILL.md`
- [x] 3.7 Render skills to `.cursor/skills/<skill-id>/SKILL.md`
- [x] 3.8 Render skills to `.pi/skills/<skill-id>/SKILL.md`
- [x] 3.9 Render skills to `.codex/skills/<skill-id>/SKILL.md`
- [x] 3.10 Add generated-file marker handling and unmarked-conflict protection

## 4. Makefile Integration

- [x] 4.1 Add `projects/agents/Makefile` targets for `all`, `install`, `check`, and `clean`
- [x] 4.2 Add root `Makefile` delegated target `agents`
- [x] 4.3 Add root `Makefile` shortcuts `agents-install`, `agents-check`, and `agents-clean`
- [x] 4.4 Update root `Makefile` help output

## 5. Verification

- [x] 5.1 Run `make agents-install`
- [x] 5.2 Run `make agents-check`
- [x] 5.3 Verify generated root `AGENTS.md` and `CLAUDE.md`
- [x] 5.4 Verify generated skills exist for Claude Code, Cursor, Pi, and Codex
- [x] 5.5 Verify the installer refuses to overwrite an unmarked conflicting destination
