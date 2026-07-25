# xagent Plugin

`plugins/xagent` owns the packaged `xagent-subagents` skill, launcher, and
runtime. Do not install `xagent-subagents` through the shared agents skill
installer.

## Ownership

```text
Shared skills: projects/agents/global/skills -> agents-install-global
smoke-test: projects/agents/sheaf/skills/smoke-test -> agents-install-repo
xagent-subagents + launcher + runtime: plugins/xagent -> xagent-plugin-install-global
```

Install or update the global xagent plugin package with:

```shell
make xagent-plugin-install-global
```

After installation, open a new Codex conversation so Codex reloads the plugin
skill and launcher metadata. Before invoking xagent, confirm `codex plugin
list` reports xagent installed and enabled at
`$HOME/.agents/plugins/plugins/xagent`.

For recovery, rerun `make xagent-plugin-install-global`. If the installed
package is unmarked, inspect it and move it aside manually rather than forcing
overwrite.
