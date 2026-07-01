## 1. Packaging Scaffold

- [x] 1.1 Choose and create the repository location for the xagent Codex plugin/package, including `.codex-plugin/plugin.json`, plugin skill location, script location, and runtime asset staging location.
- [x] 1.2 Add a build or package command that compiles `projects/xagent` from source and stages the compiled runtime assets into the plugin/package without relying on checked-in `projects/xagent/dist/`.
- [x] 1.3 Add a launcher script inside the plugin/package that resolves its own asset directory, validates Node >=20, verifies the packaged xagent entrypoint exists, preserves the caller working directory, and delegates all CLI arguments to packaged xagent.

## 2. Portable Runtime Behavior

- [x] 2.1 Add tests or validation scripts that invoke the packaged launcher with `--help` from outside the Sheaf repository and assert xagent usage is printed.
- [x] 2.2 Add a fake-harness smoke test that invokes the packaged launcher from a temporary non-Sheaf repository and asserts run logs are created under the configured central log root, not that repository's `data/xagent/`.
- [x] 2.3 Add negative validation cases for missing packaged runtime assets, unavailable log root permissions, or too-old/missing Node that exit non-zero with clear diagnostics or structured JSONL.
- [x] 2.4 Launch xagent-spawned Codex children with Codex's explicit approval-and-sandbox bypass flag, and add a regression test for the generated child command.

## 3. Codex Skill And Model Guidance

- [x] 3.1 Update the `xagent-subagents` source skill to use the packaged launcher or tool path as the primary invocation form instead of bare `xagent`, and document that packaged logs default to `/Users/joyo/Sheaf/data/xagent`.
- [x] 3.2 Update Claude review examples and model routing so strongest review uses `--model opus` and the skill no longer recommends `claude-opus-4.8`.
- [x] 3.3 Add guidance that agents must verify unfamiliar Claude Code model aliases locally and must not silently downgrade after model rejection.
- [x] 3.4 Regenerate managed Codex skill outputs from the `projects/agents` source and verify repo-local/global outputs are not stale.

## 4. Optional Tool Surface

- [x] 4.1 Decide whether to expose MCP tools such as `xagent_run`, `xagent_list`, and `xagent_logs` in the plugin; if implemented, make them delegate to the same launcher.
- [x] 4.2 If MCP tools are added, document tool-first usage in the plugin skill while keeping the launcher as the fallback/debug interface.
- [x] 4.3 Add tests or smoke validation proving tool invocation preserves active repository working directory semantics.

## 5. Verification

- [x] 5.1 Run `make -C projects/xagent test`.
- [x] 5.2 Run the new xagent plugin/package validation target.
- [x] 5.3 Run `make agents-check-repo` after regenerating repo-local skill outputs.
- [x] 5.4 Run `openspec validate package-xagent-codex-plugin`.
- [x] 5.5 Manually verify that a Codex agent in a repository without `projects/xagent` can read the skill and invoke xagent without a `PATH` binary or local xagent build, and that log permission failures report `log_root_unavailable`.
