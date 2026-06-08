# Physical Plan Accepted

Reviewer: physical_plan_reviewer
Scope: quest-level (all slices)
Open issues at acceptance: none

## Summary

Reviewed the spec (`specs/01_sheaf_chat.md`) and all nine slice physical plans.
The plan set is accepted: slice boundaries are appropriate (neither over-sliced
nor too coarse), the dependency ordering is correct for sequential execution,
and every spec-critical behavior is owned by a slice.

## Slice ordering verified

1. `0001_foundation_config` — Node/TS project, Makefile + root wiring, service
   registration, config/secrets shape, shared types (envelope, errors,
   manifest, lifecycle).
2. `0002_storage_history` — piles/manifests/JSONL, safe path validation,
   deferred manifest, sequenced history paging. Depends on S1.
3. `0003_scoped_tools_extension` — root-scoped Pi tools + path policy + audit;
   no shell surface. Depends on S1/S2.
4. `0004_provider_models` — service-local auth (no global `~/.pi`), OpenAI +
   local model registry/validation. Depends on S1.
5. `0005_pi_agent_lifecycle` — `(pile, sessionId)` registry, new/hot/cold
   resume, first-turn manifest, offload guards. Depends on S2/S3/S4.
6. `0006_agui_mapper` — Pi→AGUI mapping/snapshots, schema validation,
   RAW/activity fallback. Depends on schema + S5 event surfaces.
7. `0007_rest_api` — health/piles/sessions/history/models endpoints, stable
   error envelope, blank-session creation without manifest. Depends on
   S2/S4/S5/S6.
8. `0008_websocket_protocol` — `/ws/chat`, hello/backlog/caught_up, multi-client
   broadcast, replay, history, model select, dedup. Depends on S2/S5/S6/S7.
9. `0009_browser_ui_docs` — piles/sessions/chat screens, lazy history, reconnect,
   mobile, backward-compatible shared AGUI assets, docs. Depends on S7/S8.

## Spec coverage confirmed

Deferred manifest creation, root-escape enforcement with audit/activity events,
multi-client broadcast/replay/reconnect, OpenAI+local model merge with OAuth
stored under `data/sheaf-chat/`, `messageId` de-duplication, mobile UI
requirements, documentation, and independence from global Pi configuration are
each covered.

## Non-blocking implementation note (config key path)

The committed `config/global_config.json` stores the local-inference URL at the
top level as `local_inference_url`, while the Slice 1/4 plan prose phrases it as
a nested `sheaf_chat.local_inference_url`. The spec is itself inconsistent on
this (top-level in "Service Registration", `sheaf_chat.*` in "Providers And
Models"). This is not a blocking defect because the committed config file is the
authoritative ground truth and resolves trivially during implementation.
Implementer guidance: use the already-committed shapes — top-level
`local_inference_url` in `global_config.json` and `local_inference_api_key` in
`api_keys.json` — and keep Slice 1 and Slice 4 consistent with each other.

## Process note

The `scripts/quest-runner` issue CLI was approval-gated and never executed
during this review session, so no CLI-tracked issues could be opened or closed.
The single inconsistency found was judged non-blocking and is captured above as
implementation guidance rather than an open issue.
