# Issues

## PP-001: Local-inference config key path in Slice 1/4 plans contradicts committed config files

- id: PP-001
- scope: physicalplan
- status: open
- slices: 0001_foundation_config, 0004_provider_models

### Description

Slice 1 plan (line 34) says to add a nested `sheaf_chat` section in
`global_config.json` holding `local_inference_url`, and Slice 4 plan (line 11)
says the local provider reads `sheaf_chat.local_inference_url` from
`global_config.json`. The already-committed `config/global_config.json` stores
it top-level as `local_inference_url` (`http://studio.local:8000/v1/`) with no
`sheaf_chat` wrapper.

The spec is itself inconsistent: the "Service Registration And Configuration"
section shows top-level `local_inference_url` and api_keys
`local_inference_api_key`, while the "Providers And Models" section references
`sheaf_chat.local_inference_url` and `sheaf_chat.local_api_key`.

Why it is a problem: as written, an implementer following Slice 1/4 literally
would restructure the committed config into a nested block, contradicting both
the committed file and the spec registration example, causing implementation
churn. Slice 4 already uses the committed top-level name
`local_inference_api_key` for `api_keys.json` but the nested form only for the
URL, so the two plans are also inconsistent with each other.

Recommended resolution: pick one canonical config shape (recommend matching the
committed files: top-level `local_inference_url` in `global_config.json` and
`local_inference_api_key` in `api_keys.json`) and make Slice 1 and Slice 4 plan
text agree with it and with the committed config.

To close: Slice 1 and Slice 4 plans reference the same config key path, and that
path matches the already-committed `config/global_config.json` and
`config/api_keys.example.json`.

> Recorded by physical_plan_reviewer via direct edit because
> `scripts/quest-runner issues create` was unavailable (blocked on approval).
