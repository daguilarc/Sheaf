---
name: pyramid-index
description: Read, create, and maintain pyramid indexes for source material.
metadata:
  managedBy: sheaf-agents-installer
  source: projects/agents/global/skills/pyramid-index
---

<!-- sheaf-agents-managed: DO NOT EDIT; source=projects/agents/global/skills/pyramid-index -->

# Pyramid Index

Use this skill when reading, creating, updating, or relying on a pyramid index.

A pyramid index is a directory whose name ends with the suffix `.prmi`.

It contains a stack of progressively compressed summaries of the same source
material. Each level summarizes the level before it at roughly half the size.

Files are named by level:

- `file_0` is the most detailed summary.
- `file_1` is an approximately half-sized summary of `file_0`.
- `file_2` is an approximately half-sized summary of `file_1`.
- Further files continue the same pattern.

The index forms a summary pyramid. Lower-numbered files preserve more detail.
Higher-numbered files provide faster orientation.

Use pyramid indexes to choose an appropriate level of detail for the task:

- Start with a higher-level file when orienting, planning, or deciding whether
  the material is relevant.
- Move to lower-numbered files when more specificity is needed.
- Prefer the most detailed available level when making exact claims, editing
  related source material, or resolving ambiguity.

Each level should preserve the core structure, key claims, important names,
decisions, constraints, and unresolved questions from the previous level.
Compression should remove repetition and low-value detail before removing
meaning.

A pyramid index is not a replacement for source material. It is an access
structure that lets agents read at the right resolution before deciding whether
to inspect the original source.

When creating or maintaining a pyramid index, keep summaries faithful. Do not
introduce claims, interpretations, or architectural judgments that are not
present in the level being summarized unless they are clearly marked as
synthesis.
