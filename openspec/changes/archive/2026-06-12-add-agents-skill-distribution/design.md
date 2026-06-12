## Context

The repo already contains harness-specific agent surfaces:

- `.claude/skills/`
- `.cursor/skills/`
- `.codex/skills/`
- `.pi/skills/`

Those directories currently hold OpenSpec skills copied into each harness format. The requested change adds a `projects/agents/` project that owns shared global agent instructions and shared skill source material.

The root Makefile currently delegates project targets with `$(MAKE) -C projects/<name>` shortcuts. The new `agents` project should follow that convention as `projects/agents`.

Prompt drafts were found at `/Users/joyo/Desktop/prompt_draft`:

- `about_me.me`
- `git_workflow.md`
- `incremental_mode.md`
- `pyramid_index.md`
- `software_principles.md`

## Goals / Non-Goals

**Goals:**

- Create `projects/agents/` as the source of truth for global agent guidance.
- Store canonical global instructions at `projects/agents/global/AGENTS.md`.
- Store reusable shared skill sources under `projects/agents/global/skills/`.
- Convert the prompt drafts into full skills.
- Compile/install skills for Claude Code, Cursor, Pi, and Codex.
- Install global instructions as both root `AGENTS.md` and root `CLAUDE.md`.
- Add Makefile targets that call the installer in the repo's delegated style.
- Make installation deterministic and easy to verify.

**Non-Goals:**

- Replacing existing OpenSpec skills.
- Publishing these skills outside this repo.
- Supporting harnesses beyond Claude Code, Cursor, Pi, and Codex in the first implementation.
- Designing a general package manager for agent skills.

## Decisions

### 1. Source-First Skill Layout

Use `projects/agents/global/skills/<skill-id>/` as the canonical source for each shared skill.

Suggested source shape:

```text
projects/agents/global/skills/incremental-mode/
  skill.yaml
  SKILL.md
```

`skill.yaml` holds stable metadata used by the installer:

```yaml
id: incremental-mode
name: incremental-mode
description: Follow explicit keyboard-style instructions without adjacent initiative.
targets:
  - claude
  - cursor
  - pi
  - codex
```

`SKILL.md` holds the source skill body in a harness-neutral format. The installer can copy it directly for harnesses that already use `SKILL.md`, while preserving room for target-specific rendering later.

**Rationale:** The current harnesses all already accept skill directories with `SKILL.md`. A metadata-plus-markdown source keeps the first implementation small while making future target-specific packaging explicit.

### 2. Harness Outputs Are Generated Install Artifacts

The installer writes:

```text
.claude/skills/<skill-id>/SKILL.md
.cursor/skills/<skill-id>/SKILL.md
.pi/skills/<skill-id>/SKILL.md
.codex/skills/<skill-id>/SKILL.md
```

Generated files should include a short marker comment near the top so the installer can distinguish managed files from manually authored files. If a destination file exists without the marker and differs from the generated output, the installer should fail unless `--force` is supplied.

**Rationale:** The repo already has hand-meaningful harness folders. A marker avoids accidental clobbering while still letting the script update generated outputs repeatably.

### 3. Global Instructions Install to Root Files

The installer copies `projects/agents/global/AGENTS.md` to:

```text
AGENTS.md
CLAUDE.md
```

Both files should have identical body content, aside from an optional generated marker if needed. `CLAUDE.md` exists because Claude Code conventionally reads it; `AGENTS.md` remains the cross-agent source for tools that honor repo instructions.

### 4. Draft Conversion Produces Five Initial Skills

Convert the drafts as follows:

| Draft | Skill ID | Intent |
| --- | --- | --- |
| `about_me.me` | `about-me` | User preferences, dictation constraints, and how to treat a likely typo |
| `git_workflow.md` | `git-workflow` | Linear git workflow, rebase discipline, and land procedure |
| `incremental_mode.md` | `incremental-mode` | Low-initiative keyboard mode |
| `pyramid_index.md` | `pyramid-index` | How agents should read and maintain pyramid indexes |
| `software_principles.md` | `software-principles` | Engineering principles and quality expectations |

Each converted skill should have frontmatter or metadata that names when to use it. The skill body should preserve the draft's intent but upgrade terse prompt notes into clear, reusable skill instructions.

### 5. Installer Interface

Implement `projects/agents/scripts/install.py` with these modes:

```shell
projects/agents/scripts/install.py install
projects/agents/scripts/install.py check
projects/agents/scripts/install.py clean
```

Expected behavior:

- `install` renders global instructions and skill outputs.
- `check` renders in memory and exits non-zero if installed outputs differ.
- `clean` removes only managed generated outputs, not unmanaged files.

The script should default to the repo root as the parent of `projects/agents/`, with an optional `--repo-root` for testability.

### 6. Makefile Integration

Add `projects/agents/Makefile`:

```make
.PHONY: all install check clean

all: check

install:
	python3 scripts/install.py install

check:
	python3 scripts/install.py check

clean:
	python3 scripts/install.py clean
```

Update the root `Makefile` with explicit delegated shortcuts:

```make
.PHONY: agents agents-install agents-check agents-clean

agents:
	$(MAKE) -C projects/agents all

agents-install:
	$(MAKE) -C projects/agents install

agents-check:
	$(MAKE) -C projects/agents check

agents-clean:
	$(MAKE) -C projects/agents clean
```

The root `help` target should mention the new commands.

## Risks / Trade-offs

**Risk: Generated files drift from source.**

Mitigation: `make agents-check` should fail when installed outputs differ.

**Risk: Installer clobbers existing harness skills.**

Mitigation: use generated markers and require `--force` for unmarked conflicts.

**Risk: Global `AGENTS.md`/`CLAUDE.md` becomes too personal for repo-wide use.**

Mitigation: keep user-specific context in a dedicated `about-me` skill and keep global instructions limited to broadly applicable operating rules.

## Migration Plan

1. Add the `projects/agents/` source tree and installer.
2. Convert the prompt drafts into source skills.
3. Run `make agents-install` to generate root instruction files and harness skill outputs.
4. Run `make agents-check` to confirm generated outputs match source.
5. Review generated diffs for each harness directory before committing.
