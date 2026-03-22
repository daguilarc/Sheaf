# Decisions

- 2026-03-21: Side quest created.
- 2026-03-21: Planning direction updated so `apply_patch` follows the
  OpenAI/Codex patch envelope contract as the canonical public interface.
  Agent-facing tools registry documentation must explicitly instruct agents to
  use that protocol. Any unified-diff handling that remains is an internal
  implementation detail, not the public contract.
- 2026-03-21: Backward compatibility for the old unified-diff-first
  `apply_patch` behavior is not a goal of this quest. The server is expected to
  implement the OpenAI diff supplier path for the live tool contract, and
  callers are expected to use the OpenAI patch protocol after this change.
- 2026-03-21: The public `apply_patch` schema uses a single required `patch`
  string containing the full OpenAI/Codex patch envelope. Top-level `path`
  input is removed so the external contract matches the envelope format
  directly.
- 2026-03-21: Update operations translate the OpenAI/Codex patch envelope into
  the existing internal unified-diff logging path. This keeps replica replay
  and vault patch reconstruction behavior unchanged while making unified diff an
  implementation detail instead of the public tool contract.
