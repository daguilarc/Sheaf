## Context

Sheaf has three distinct agent-asset classes but currently distributes two of
them through overlapping paths:

1. Shared filesystem skills under `projects/agents/global/skills/` are rendered
   both globally and into each repository worktree.
2. The Sheaf-specific `smoke-test` skill is correctly repo-local.
3. xagent has a valid plugin package under `plugins/xagent/`, but the package is
   not registered or installed as a Codex plugin. Its skill is also duplicated
   under `projects/agents/global/skills/`.

The duplicate filesystem skills can drift between the canonical source, a
worktree, and the user's home directory. The xagent arrangement is worse:
instructions are globally visible, but execution still depends on the active
repository containing `plugins/xagent/scripts/xagent`.

Codex supports personal marketplaces at
`~/.agents/plugins/marketplace.json`. A marketplace plugin is installed with
`codex plugin add <plugin>@<marketplace>` and becomes available to new
conversations. Plugin installation and filesystem-skill installation are
separate lifecycles, so the implementation must give each artifact exactly one
distribution owner.

## Goals / Non-Goals

**Goals:**

- Install shared filesystem skills globally only.
- Install `smoke-test` repo-locally only.
- Install xagent as a real global Codex plugin through a supported Make target.
- Make the plugin the only installed owner of the `xagent-subagents` skill,
  launcher, and packaged runtime.
- Remove obsolete managed copies without deleting unmanaged files.
- Make installation and obsolete managed-skill cleanup deterministic and
  testable.

**Non-Goals:**

- Publishing xagent to the public OpenAI plugin directory.
- Adding an xagent MCP server or putting an `xagent` executable on `PATH`.
- Changing xagent's harness protocol, model routing, logging semantics, or
  authentication.
- Changing repo-local `AGENTS.md` or `CLAUDE.md` generation.
- Treating Codex's internal marketplace/plugin cache implementation as an
  additional Sheaf-managed installation destination.

## Decisions

### 1. Assign one owner and one scope to every skill

| Artifact class | Canonical source | Installed scope | Installer owner |
| --- | --- | --- | --- |
| Shared filesystem skills | `projects/agents/global/skills/` | User-global harness locations only | agents installer |
| Sheaf-only skills | `projects/agents/sheaf/skills/` | Repo-local harness locations only | agents installer |
| `xagent-subagents` | `plugins/xagent/skills/` | Global xagent Codex plugin only | xagent plugin installer |

`projects/agents/global/skills/xagent-subagents/` will be removed. The plugin
skill becomes the single canonical copy, preventing Codex from discovering the
same workflow through both a filesystem skill and a plugin.

Alternative considered: keep the standalone global xagent skill as a bootstrap
pointer. Rejected because it creates two independently installed copies of the
same skill and allows the pointer to outlive the plugin it requires.

### 2. Desired outputs and obsolete outputs are separate sets

The agents installer will render:

- repo scope: repo-root instructions plus Sheaf-only skills;
- global scope: user-global instructions plus shared filesystem skills.

For repo scope, obsolete outputs are the union of the current global skill
sources and an explicit retired repo-skill ID list containing
`xagent-subagents`, with both sets expanded across all four repo harness skill
directories. Expanding all four targets also cleans a managed orphan after a
skill narrows its target metadata. The retired list preserves cleanup knowledge
after a source directory is deleted. For global scope, the existing obsolete-ID
mechanism includes both `smoke-test` and `xagent-subagents`. Install removes
obsolete files only when they contain the managed marker; check reports them;
clean removes them; unmanaged files are preserved.

Alternative considered: clear harness skill directories before rendering.
Rejected because those directories can contain user-managed or third-party
skills.

### 3. Install xagent through the implicit personal marketplace

The global plugin installer will use the implicitly discovered Codex personal
marketplace rooted at `~/.agents/plugins/marketplace.json`. A newly created
marketplace is named `personal`; an existing marketplace keeps its top-level
name, which the installer reads before constructing the Codex plugin selector.
The local `xagent` entry uses `policy.installation: "AVAILABLE"`,
`policy.authentication: "ON_INSTALL"`, and `category: "Productivity"`.

The Make target will:

1. build the xagent runtime into an untracked temporary package and validate
   that package without rewriting tracked plugin assets;
2. stage the complete validated plugin package under
   `~/.agents/plugins/plugins/xagent/`;
3. use the installed `plugin-creator` helpers to create the marketplace entry
   when absent and to apply a single cachebuster to the staged manifest,
   failing explicitly if those helpers are unavailable;
4. normalize the `xagent` marketplace entry's local `source.path` to the staged
   package path relative to the invoking home, because Codex resolves personal
   marketplace local paths from that home rather than from the temporary
   scaffold path used by the helper;
5. read the marketplace's actual name and run
   `codex plugin add xagent@<marketplace-name>`;
6. verify `codex plugin list` reports xagent installed and enabled.

The staged copy contains a `.sheaf-managed` file whose exact contents are
`sheaf-xagent-plugin\n` and preserves the launcher's executable mode. The
installer writes that marker on first installation and requires it before
replacing an existing destination. The target fails on an unmarked conflicting
destination, a missing Codex CLI or plugin-creator helper, any package
validation failure, or any non-zero Codex plugin command. Repeated runs update
the one staged plugin package and reinstall the same plugin identity. The
installer invokes Codex with the same selected home used for staging and
marketplace writes, then validates the resolved path reported by
`codex plugin list` rather than assuming Codex's internal cache layout.

Alternative considered: configure each worktree as a local marketplace.
Rejected because worktree paths are temporary and would leave global plugin
configuration pointing at deleted directories.

### 4. Plugin executables live only inside the plugin package

The installer will not copy the launcher or runtime into `~/.local/bin`,
filesystem skill directories, repo-local harness directories, or separate
harness-specific script locations. The installed plugin package contains its
skill, `scripts/xagent`, and `assets/xagent` runtime together. The repository
copy is source/build input; the personal-marketplace copy is the sole
Sheaf-managed global deployment.

### 5. Provide one global plugin install target

The root Makefile will expose `xagent-plugin-install-global`. Existing package
build/test targets remain developer checks. Plugin removal and marketplace
administration remain owned by Codex; this change does not add parallel
check/clean abstractions.

## Risks / Trade-offs

- **[Risk] Personal marketplace setup could damage unrelated entries.**
  → Use the installed plugin-creator command rather than hand-editing the
  marketplace, and test against an existing multi-entry marketplace fixture.
- **[Risk] A failed update could leave xagent unavailable.**
  → Stage and validate in a temporary sibling directory, then replace the
  managed package atomically before invoking Codex installation.
- **[Risk] Codex may retain an old plugin version in an existing conversation.**
  → Use a fresh cachebuster for each install and document that validation must
  occur in a new conversation.
- **[Risk] Global cleanup could remove user-owned files.**
  → Require Sheaf management markers/metadata and preserve unmanaged
  destinations.
- **[Trade-off] xagent becomes Codex-plugin-only rather than a standalone
  filesystem skill.**
  → This matches its executable dependency and guarantees that discovering the
  skill implies the launcher/runtime is installed.

## Migration Plan

1. Implement and test desired/obsolete output separation in the agents
   installer, including the retired repo-local `xagent-subagents` ID.
2. Move xagent skill ownership to the plugin and add the global plugin install
   helper and Make target.
3. Run repo installation to delete managed worktree copies of global skills.
4. Run global agents installation to delete the standalone managed xagent skill
   while retaining other shared skills.
5. Run `make xagent-plugin-install-global`.
6. Verify installer checks, `codex plugin list`, packaged launcher smoke tests,
   and discovery from a new Codex conversation.

Rollback restores the prior agents skill source/output rules, runs the agents
installers, and removes the xagent plugin through Codex.

## Open Questions

None.
