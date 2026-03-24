# Decisions

- 2026-03-24: Main quest created.
- 2026-03-24: This main quest defines one migration policy for both server and
  vault SQLite schemas, with immediate implementation priority on server schema
  upgrades because server currently only applies bootstrap SQL.
- 2026-03-24: Upgrade scripts must never run on the main server database unless
  a backup has been created first in a managed backup directory.
- 2026-03-24: Schema upgrades are applied in ordered version sequence and only
  for unapplied versions tracked in a migration versions table.
