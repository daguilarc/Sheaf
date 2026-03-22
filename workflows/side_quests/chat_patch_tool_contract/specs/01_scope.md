# Scope

## Quest

- Name: `chat_patch_tool_contract`
- Main Quest: `obsidian_chat`
- Created: `2026-03-21`

## Summary

Adopt the OpenAI/Codex patching contract for the chat editing tool so agents
and the server agree on one patch format. This side quest should treat the
OpenAI Patching Protocol as the intended public contract for `apply_patch` and
should require the tools registry documentation shown to agents to instruct them
to use that protocol explicitly.

This is no longer an open evaluation between multiple patch dialects. The plan
is to make the server-side tool contract, the server implementation, tool
metadata, and agent-facing documentation converge on the Codex-style patch
envelope format.

## Contract Direction

- The canonical public editing contract for `apply_patch` is the OpenAI/Codex
  patch envelope format, not raw unified-diff hunks.
- The server must implement the OpenAI diff supplier for `apply_patch` so the
  live tool accepts the OpenAI/Codex patch envelope contract directly.
- Agent-facing tool documentation in the tools registry must explicitly tell
  agents to use the OpenAI Patching Protocol when calling `apply_patch`.
- The contract should be documented with concrete expectations such as
  `*** Begin Patch`, file operation sections like `*** Update File:`,
  `*** Add File:`, and `*** Delete File:`, and a terminating
  `*** End Patch`.
- The server may still translate the OpenAI patch envelope into unified diff or
  another internal representation under the hood, but that is an implementation
  detail rather than the public agent contract.
- Backward compatibility is not a goal. Once this contract lands, callers are
  expected to use the OpenAI patch protocol rather than the previous
  unified-diff-first behavior.
- Transcript and tool-event UX should assume `apply_patch` is a file-editing
  tool whose request body is a structured patch payload and should not rely on
  displaying the raw patch text.

## Goals

- Replace the previous open-ended contract question with a clear decision that
  `apply_patch` follows the OpenAI/Codex patching protocol.
- Require an implementation change on the server so the live `apply_patch` tool
  actually accepts the OpenAI diff supplier contract.
- Specify that the live tools registry documentation must teach agents the
  required patch envelope format directly.
- Define the minimum protocol details that must appear in agent-facing tool
  documentation so compliant agents generate the correct patch payload.
- Clarify that any internal translation or adapter layer is acceptable only if
  it preserves the OpenAI patch envelope as the only supported external
  contract.
- State explicitly that this quest does not preserve backward compatibility for
  callers still sending raw unified diffs to `apply_patch`.
- Define the user-facing implications for transcript rendering and tool-event UX
  so file-editing tool calls remain understandable without surfacing raw patch
  bodies.
- Give implementation work a stable planning contract that can be executed
  without reopening the patch-dialect question.

## Required Outcomes

- The side quest must specify that `apply_patch` accepts the OpenAI/Codex patch
  envelope format as its canonical external contract.
- The side quest must specify that the server implementation changes so the live
  `apply_patch` tool implements the OpenAI diff supplier behavior.
- The side quest must specify that the tools registry documentation exposed to
  agents explicitly instructs them to use that patching protocol.
- The side quest must specify that documentation for `apply_patch` includes the
  patch envelope structure and the supported file operation sections.
- The side quest must specify that any server internals using unified diff or
  other patch machinery remain implementation details rather than the documented
  agent contract.
- The side quest must specify that backward compatibility for the old
  unified-diff-first `apply_patch` contract is not required and should not
  shape the implementation.
- The side quest must specify that chat transcript summaries and tool-event UX
  continue to avoid rendering raw patch contents.

## Non-Goals

- Redesign the entire Obsidian chat pane.
- Change replica sync behavior.
- Solve general tool-use reliability across every non-filesystem tool in the
  same side quest.
- Reopen the question of whether `apply_patch` should remain unified-diff-first
  as a public contract.
- Introduce multiple equally supported public patch dialects for agents.
- Preserve compatibility for callers that continue sending the old patch format
  after this contract change.

## Answered Questions

- Yes: the preferred and intended public editing contract for chat agents is the
  OpenAI/Codex patching protocol.
- No: this side quest should not plan around renaming the public tool to an
  explicitly unified-diff contract.
- Yes: an internal compatibility or translation layer is acceptable if needed,
  but only as an implementation strategy behind a single OpenAI-style external
  contract.
- Yes: the tools registry documentation provided to agents must explicitly
  instruct them to use the OpenAI patch envelope format rather than assuming the
  model will infer it.
- No: backward compatibility for the previous unified-diff-first public
  behavior is not a requirement for this quest.
