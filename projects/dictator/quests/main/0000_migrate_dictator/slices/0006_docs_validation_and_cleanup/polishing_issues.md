# Issues

## Issue PI-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-07T16:12:14Z
- updated_at: 2026-06-07T16:12:14Z
- title: data.md interaction filename pattern does not match implementation
- details: `projects/dictator/docs/reference/data.md` documents the on-disk
  interaction layout as files named `YYYY-MM-DD-HH.jsonl` under
  `data/dictator/interactions/`. The implementation does not produce that name.
  `InteractionHistory.hourlyFileName` (`projects/dictator/src/Sources/DictatorService/InteractionHistory.swift:445-451`)
  builds the filename with `dateFormat = "yyyy-MM-dd'T'HH'Z'"` in UTC, yielding
  names like `2026-06-07T16Z.jsonl` (literal `T` separator before the hour, a
  trailing `Z`, and no hyphen before the hour). The documented pattern is
  therefore wrong: it uses a hyphen separator and omits the `T`/`Z`.
  Why it is a problem: the physical plan's Documentation Plan requires
  `reference/data.md` to accurately describe the `data/dictator/` structure. An
  incorrect filename format for the only documented data file undermines the
  reference doc and would mislead an operator inspecting
  `data/dictator/interactions/`.
  To mark completed: update `data.md` so the documented interaction filename
  pattern matches the implementation, e.g. an hourly UTC file named like
  `2026-06-07T16Z.jsonl` (format `yyyy-MM-dd'T'HH'Z'.jsonl`).
- resolution_notes: none

Note: recorded by direct markdown edit because `scripts/quest-runner` is not
present in this worktree (CLI unavailable). Migrate to CLI-managed entries if the
runner becomes available.
