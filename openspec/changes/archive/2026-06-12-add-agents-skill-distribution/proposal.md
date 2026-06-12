## Why

Agent guidance currently lives in harness-specific directories such as `.claude/`, `.cursor/`, `.codex/`, and `.pi/`. That makes shared instructions and reusable skills easy to drift across tools. There are also prompt drafts in `/Users/joyo/Desktop/prompt_draft` that should become first-class skills rather than loose notes.

This change creates a repo-local `projects/agents/` project as the source of truth for global agent instructions and shared skills. A compile/install script will package that source into the formats expected by Claude Code, Cursor, Pi, and Codex, and install the global instructions where the agents can see them.

## What Changes

Add a new project folder:

```text
projects/agents/
  Makefile
  scripts/
    install.py
  global/
    AGENTS.md
    skills/
```

The `projects/agents/global/AGENTS.md` file becomes the canonical global instruction file. The installer copies it to repo-root `AGENTS.md` and `CLAUDE.md`.

The `projects/agents/global/skills/` directory stores source material for shared skills. The first implementation converts these drafts into full skills:

- `/Users/joyo/Desktop/prompt_draft/about_me.me`
- `/Users/joyo/Desktop/prompt_draft/git_workflow.md`
- `/Users/joyo/Desktop/prompt_draft/incremental_mode.md`
- `/Users/joyo/Desktop/prompt_draft/pyramid_index.md`
- `/Users/joyo/Desktop/prompt_draft/software_principles.md`

The compiler/installer writes harness-specific skill packages for:

- Claude Code: `.claude/skills/<skill>/SKILL.md`
- Cursor: `.cursor/skills/<skill>/SKILL.md`
- Pi: `.pi/skills/<skill>/SKILL.md`
- Codex: `.codex/skills/<skill>/SKILL.md`

The root `Makefile` gains an `agents` project target and shortcuts following the existing delegated target style.

## Capabilities

### New Capabilities

- `agents-skill-distribution`: source-controlled global agent guidance, shared skill sources, and deterministic install outputs for the supported harnesses.

## Impact

### New Files

- `projects/agents/Makefile`
- `projects/agents/scripts/install.py`
- `projects/agents/global/AGENTS.md`
- `projects/agents/global/skills/<skill>/...`
- generated skill outputs under `.claude/skills/`, `.cursor/skills/`, `.codex/skills/`, and `.pi/skills/`
- repo-root `AGENTS.md`
- repo-root `CLAUDE.md`

### Modified Files

- `Makefile` - add delegated `agents` targets and help text.

### Affected Capability Specs

- `agents-skill-distribution` - new capability spec for the new `projects/agents/` project.

## Open Questions

- Should installed skills be checked in for all harnesses, or should only `projects/agents/global` source be checked in and harness outputs generated locally?
