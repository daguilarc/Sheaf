# Implementation Plan

## Intent

This side quest should replace the current contract mismatch with one supported
server implementation path. The implementation goal is not to document the
OpenAI/Codex patch envelope and hope models comply; it is to make the live
`apply_patch` tool actually accept that contract.

This plan intentionally does not preserve backward compatibility for the old
unified-diff-first public behavior. After this change, callers are expected to
use the OpenAI patch protocol.

## Planned Changes

### 1. Change The Live `apply_patch` Contract

- Update the server-side `apply_patch` tool contract so its documented input is
  the OpenAI/Codex patch envelope.
- Remove unified-diff-first language from the live tool description and replace
  it with explicit OpenAI patch protocol instructions.
- Ensure the tool schema and description shown to models make the required patch
  format obvious enough that the model does not need to infer it.

### 2. Implement The OpenAI Diff Supplier On The Server

- Add server-side parsing or translation support for the OpenAI/Codex patch
  envelope format used by `*** Begin Patch` / file operation sections /
  `*** End Patch`.
- Route `*** Update File`, `*** Add File`, and `*** Delete File` behavior
  through the live filesystem tooling in a way that preserves existing write
  logging expectations where possible.
- If the easiest implementation is to translate the OpenAI envelope into the
  current unified-diff machinery, keep that translation internal and do not
  expose unified diff as an equally supported public input contract.

### 3. Remove Backward-Compatibility Expectations

- Do not preserve the old unified-diff-first `apply_patch` contract as a
  supported public behavior.
- Do not add dual-format documentation that presents unified diff and OpenAI
  patch envelopes as equally valid agent inputs.
- Update planning and product documentation so the repository names only the
  OpenAI/Codex patch protocol as the intended agent-facing contract.

### 4. Update Agent-Facing Tool Registry Documentation

- Update the tool metadata emitted to OpenAI-compatible models so `apply_patch`
  explicitly instructs the model to send the OpenAI patch envelope.
- Include enough format detail in the tool description to cover:
  - `*** Begin Patch`
  - `*** Update File:`
  - `*** Add File:`
  - `*** Delete File:`
  - `*** End Patch`
- Keep the instructions concise enough for a tool description but explicit
  enough to prevent fallback to raw unified diff hunks.

### 5. Preserve Transcript Safety

- Keep transcript summaries and tool-event rendering path-focused and avoid
  surfacing raw patch text.
- Verify that failures remain understandable without exposing the patch payload
  body in chat summaries.

## Validation

- Add or update server tests proving `apply_patch` accepts the OpenAI/Codex
  patch envelope.
- Add tests for `*** Update File`, `*** Add File`, and `*** Delete File`
  handling as supported by the final implementation.
- Add or update tests for tool metadata so agent-facing documentation explicitly
  instructs callers to use the OpenAI patch protocol.
- Add a regression test that demonstrates the previously failing OpenAI-style
  patch shape now succeeds.
- Confirm transcript/tool summary behavior still avoids raw patch-body display.

## Exit Criteria

- The live `apply_patch` contract is documented as OpenAI/Codex patch envelope
  input, not unified diff input.
- The server implementation accepts the OpenAI diff supplier path for
  `apply_patch`.
- The tools registry documentation explicitly tells agents to use the OpenAI
  patch protocol.
- Repository planning/docs for this work no longer frame unified diff as a
  supported public caller contract.
- The implementation plan is specific enough to execute without reopening the
  backward-compatibility question.
