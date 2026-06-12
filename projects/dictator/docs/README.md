# Dictator — Living Spec

Dictator is the Sheaf dictation service: a macOS Swift service on port
`9003` that transcribes WAV audio with local whisper.cpp, refines the
transcript through a configurable LLM provider (Ollama or OpenAI with
fallback), records every interaction, and exposes an operational web
dashboard. A Launchpad Pro hardware controller drives the same pipeline
in-process with OS-level text insertion, and an iOS keyboard host
app/extension acts as a remote client.

This directory is the project's living spec under the rules in
[Docs Structure](../../../structure/docs-structure.md): normative
requirements with stable IDs, held to the rebuild-test standard. Spec status
and known gaps are tracked in [coverage.md](coverage.md).

- [Architecture](architecture.md) — components, dictation data flow, key
  design decisions.
- [Operations](operations.md) — build, run, and test from a fresh checkout.
- [Coverage](coverage.md) — rebuild-test audit and gap register.

## Capability Map

| Capability | Prefix | What it specifies |
|---|---|---|
| [dictation-pipeline](../../../openspec/specs/dictator-dictation-pipeline/spec.md) | `dp` | `POST /v1/dictate-audio`: headers, WAV validation, error catalogue; STT, prompt building, provider routing and fallback, interaction recording |
| [service-lifecycle](../../../openspec/specs/dictator-service-lifecycle/spec.md) | `svc` | Startup (root discovery, registry, config/secrets, health warnings), CLI overrides, `/health`, `/exit`, SIGINT shutdown, 404/405 fallbacks, trace log |
| [web-ui](../../../openspec/specs/dictator-web-ui/spec.md) | `web` | Static dashboard shell and all `/api/*` endpoints: status, config edit/options/reset, prompts, interaction history, models, key status |
| [launchpad](../../../openspec/specs/dictator-launchpad/spec.md) | `lp` | Launchpad Pro layout JSON, dictation pads and states, Talon Lite mode, keystroke injection, shift latch, contextual backspace, safe-config restore, paste insertion |
| [ios-keyboard](../../../openspec/specs/dictator-ios-keyboard/spec.md) | `ios` | iOS host app + keyboard extension: server URL resolution, upload contract usage, app-group session state machine, Darwin notifications, diagnostics |

## Shared Contracts

- [Configuration files](contracts/config.md) — `config/dictator.json` keys
  and defaults, `config/dictator.safe` semantics, `config/api_keys.json`.
- [Interaction records](contracts/interactions.md) — the
  `data/dictator/interactions/` hourly JSONL envelope, field meanings, and
  buffer/startup-load policy.
