# Decisions

- 2026-03-21: Side quest created.
- 2026-03-21: `list_directory` is the canonical directory-listing tool name for
  this contract; legacy `list_notes` language should be removed from this side
  quest spec.
- 2026-03-21: Directory-oriented tools are treated as file-oriented for
  transcript-summary purposes, so `list_directory` belongs in the authoritative
  file-oriented tool list.
- 2026-03-21: Path stripping should apply only to `data/vaults/<current-vault>/`
  prefixes. Current-vault root displays as `/`, and non-current-vault absolute
  paths should collapse to basename-only labels.
- 2026-03-21: `move_path` summaries should display both source and destination
  path labels.
- 2026-03-21: This side quest is Obsidian-only for now and does not attempt to
  harmonize iOS transcript summary behavior.
- 2026-03-21: Implementation threads the current vault name through the
  Obsidian chat store so summary formatting can strip only
  `data/vaults/<current-vault>/` prefixes without changing the server payload
  contract.
- 2026-03-21: Obsidian summaries now give first-class path-label rendering to
  `create_directory` and `delete_path` alongside the already-supported
  file-oriented tool summaries.
- 2026-03-21: Human approval was given to move this side quest to `complete`
  after the Obsidian implementation and tests landed.
