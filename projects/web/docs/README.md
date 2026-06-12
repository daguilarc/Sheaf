# Web — Living Spec

The web project is the repository's shared browser-asset library: plain CSS
and JavaScript files under `projects/web/src/` that other projects' service
dashboards serve verbatim at `/assets/web/<filename>`. It owns the shared
page stylesheet (`sheaf.css`) and the AGUI streaming-chat widget
(`agui-chat.js` + `agui-chat.css`); it owns no service, API, or
project-specific behavior.

This directory is the project's living spec under the rules in
[Docs Structure](../../../structure/docs-structure.md): normative
requirements with stable IDs, held to the rebuild-test standard. Spec status
and known gaps are tracked in [coverage.md](coverage.md).

- [Operations](operations.md) — build, test, and how consumers load the
  assets.
- [Coverage](coverage.md) — rebuild-test audit and gap register.

The project is small enough to be a single capability; there is no separate
`architecture.md` (the Design section of the capability file covers it).

## Capability Map

| Capability | Prefix | What it specifies |
|---|---|---|
| [web-utilities](../../../openspec/specs/web-utilities/spec.md) | `web` | The shared asset surface (`sheaf.css`, `agui-chat.css`, `agui-chat.js`), the `ChatView` API, AGUI event reduction and rendering, theming contracts, browser constraints, and how consumers serve the files |

## Shared Contracts

- [AGUI event schema](../../../structure/schemas/ag_ui_events.schema.json) —
  canonical (repo-level) definition of the event vocabulary the chat widget
  consumes; the capability file links it rather than restating shapes.
- [Web UI rules](../../../structure/webui.md) — repo-level rules for what
  belongs in this project.
