# Scope

## Quest

- Name: `tool_call_summary_contract`
- Main Quest: `obsidian_chat`
- Created: `2026-03-21`

## Summary

Define a narrow, stable transcript-summary contract for file-oriented tool calls
in the Obsidian replica chat UI. The goal is to show concise path labels without
showing file contents, patch bodies, or other raw payload data.

This side quest is documentation-first. The expected implementation delta is
small because the current Obsidian summary helper already does most of the
required privacy shaping.

## Confirmed Current Implementation

- The canonical directory-listing tool name is `list_directory`.
- `list_directory` is implemented in the live file-system tool registry and
  should be treated as file-oriented for summary purposes.
- The live file-system tool family is:
  - `list_directory`
  - `read_file`
  - `create_file`
  - `create_directory`
  - `apply_patch`
  - `move_path`
  - `delete_path`
- The server transports raw `tool_calls` with full `args`; privacy-safe
  transcript summaries are a client concern.
- The current Obsidian summary helper already suppresses content-bearing
  arguments for `create_file`, `apply_patch`, and `list_directory`.
- The current Obsidian helper does not yet fully enforce the desired path
  normalization contract for current-vault stripping and basename fallback.

## Goals

- Document the authoritative list of file-oriented tools used by transcript
  summaries.
- Explicitly classify `list_directory` as file-oriented.
- Remove legacy `list_notes` language from this side quest.
- Define the path display contract for file-oriented summaries.
- Define the summary contract for `move_path`, including both source and
  destination paths.
- Keep the scope limited to the Obsidian replica chat summary helper for now.

## Path Display Contract

- If a displayed path starts with `data/vaults/<current-vault>/`, strip that
  prefix and show the vault-relative remainder.
- If a displayed path is exactly the current vault root, show `/`.
- If a path does not belong to the current vault, show only its basename rather
  than the absolute path.
- Relative paths may be shown as-is.
- Path normalization should continue to accept the existing path-like argument
  keys already recognized by the helper.

## Summary Contract

- File-oriented transcript summaries must never show file contents, patch text,
  or other raw payload bodies.
- `list_directory` summaries should show only the directory label derived from
  its path argument and should not surface unrelated arguments.
- `move_path` summaries should show both the source path label and the
  destination path label.
- When no trustworthy path label can be derived, summaries should fall back to a
  generic action label instead of exposing raw arguments.

## Non-Goals

- Redesign the chat transcript UI.
- Change server-side tool transport payloads.
- Harmonize iOS transcript summaries in this side quest.
- Redesign the separate patch payload contract tracked elsewhere.
