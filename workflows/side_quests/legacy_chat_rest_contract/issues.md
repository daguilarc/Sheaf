# Issues

## Quest status says planning while implementation is in progress

`status.md` still lists stage `planning` and describes the work as definition-only, but the current tree contains substantial implementation (server routes, iOS client, Obsidian app, Chainlit removal, README). That mismatch makes it unclear whether this quest is in implementation, review, or complete, and it undermines stage tracking for the rest of the workflow.

Status: `completed`

Next Action: Resolved: `status.md` stage set to `polishing` and summary updated to match the current lifecycle.

## Scope doc omits `POST /vaults/repair` from the public keep list

`specs/01_scope.md` enumerates public REST endpoints to keep (through `POST /replica/sessions`) but does not include `POST /vaults/repair`, even though `decisions.md`, `specs/02_cleanup_plan.md`, the README, and `app.py` all treat it as part of the canonical surface after cleanup. Readers comparing only `01_scope.md` to the live catalog will think the repair route is unspecified or accidental.

Status: `completed`

Next Action: Resolved: `specs/01_scope.md` public keep list now includes `POST /vaults/repair` (see “Public REST endpoints to keep”).

## Duplicate `import Foundation` in `SheafAPIClient.swift`

`SheafAPIClient.swift` ends the `SheafAPIClient` actor, then repeats `import Foundation` before `ChatTransportFrame` and related types. A single file-level import at the top is enough; the mid-file import reads like a bad merge and may confuse tooling or future splits of the file.

Status: `completed`

Next Action: Resolved: only one `import Foundation` remains at the top of `SheafAPIClient.swift`.

## Main quest `obsidian_chat` issues still claim stale iOS REST history helpers

`workflows/main_quests/obsidian_chat/issues.md` still describes the iOS client as defining `GET /threads/{id}/metadata` and `GET /threads/{id}/messages`, with a deferred next action pointing at this side quest. The current `SheafAPIClient` no longer exposes those paths, so that issue text is obsolete and will mislead future reviewers unless it is closed, reworded, or replaced.

Status: `rejected`

Next Action: `rejected` — side quest supersedes; main-quest issue should be closed or rewritten by committer/polisher when convenient.

## No automated coverage for `POST /vaults/repair` or absence of `repair_vault` from the tool registry

`app.py` exposes `POST /vaults/repair` and `build_agent_tools()` omits `repair_vault`, but there is still no pytest (or other automated check) that asserts the route returns the expected JSON shape or that the agent tool list does not regress to including `repair_vault`.

Status: `completed`

Next Action: Resolved: `tests/test_server_model_selection.py` adds `test_repair_vault_route_returns_success_shape` (monkeypatched `repair_vault_state`, asserts `{"status","result"}`) and `test_build_agent_tools_excludes_repair_vault`.

## Large `.test-dist` diffs alongside source changes

Obsidian replica changes included extensive churn under `apps/obsidian-replica/.test-dist/`. Generated output should not be tracked.

Status: `completed`

Next Action: Resolved: `.gitignore` lists `apps/obsidian-replica/.test-dist/`; `decisions.md` records generated-output policy; paths are no longer tracked in git.

## README “Core APIs” omits `POST /debug/log`

Scope and decisions explicitly keep `POST /debug/log` as intentional public surface. The top-level `README.md` “Core APIs” list documents health, models, threads, vaults, replica, and websockets but not `/debug/log`, so the primary onboarding doc understates the supported REST catalog relative to `specs/01_scope.md` and `app.py`.

Status: `completed`

Next Action: Resolved: README “Core APIs” now includes `POST /debug/log` plus vault/replica routes aligned with the catalog.

## `02_cleanup_plan.md` canonical REST list still names repair vaguely

In “Canonical Post-Cleanup Contract”, the repair surface is described as “REST endpoint for `repair_vault`” instead of the concrete `POST /vaults/repair` used everywhere else (`01_scope.md`, README, `app.py`). That is minor spec drift between side-quest spec files.

Status: `completed`

Next Action: Resolved: “Canonical Post-Cleanup Contract” in `specs/02_cleanup_plan.md` lists `POST /vaults/repair` explicitly.

## `02_cleanup_plan.md` workstream 5 still describes repair as a generic REST move

Previously, “### 5. Normalize tool inventory” used vague wording (“Introduce a REST endpoint for `repair_vault`”) instead of naming `POST /vaults/repair`.

Status: `completed`

Next Action: Resolved: workstream §5 now includes “Implement `POST /vaults/repair`.” alongside removing `repair_vault` from the agent registry.

## `01_scope.md` still frames the quest as planning-only in places

The “Scope of Removal” section says this side quest “covers planning for removal”, and “Non-Goals” includes “Implement the cleanup in code during planning.” The quest `status.md` is `polishing` and the repo already contains the implementation. That mismatch can confuse anyone using `01_scope.md` as the live description of what the quest is.

Status: `rejected` shut up nerd

Next Action: `fix md file` — revise those sections (or add a short “Implementation” note) so the scope doc matches the current lifecycle without implying the work is still definition-only.

## Tracked `.chainlit/config.toml` still references removed Chainlit assets

Previously, a tracked `.chainlit/config.toml` pointed at deleted `public/sheaf-chainlit.*` assets while Chainlit was removed from `pyproject.toml`, contradicting full Chainlit removal.

Status: `completed`

Next Action: Resolved: no `.chainlit/` tree in the repo; `.gitignore` only lists `.chainlit/*` with no `config.toml` exception, so nothing tracked references those assets.

## `02_cleanup_plan.md` opening still says the plan “does not perform the work”

The “Purpose” section states that this file “does not perform the work” and only defines what implementation must do. Implementation is now in the tree, so that wording reads like the plan is still a pre-implementation artifact unless qualified (for example, that it was the pre-flight checklist or that the repo has since executed it).

Status: `rejected` shut up nerd

Next Action: `fix md file` — add a short clause noting implementation has been applied, or rephrase so the document reads as historical spec plus acceptance criteria rather than implying the work is still future-only.
