# Decisions

- 2026-03-24: Main quest created.
- 2026-03-24: This main quest defines one migration policy for both server and
  vault SQLite schemas, with immediate implementation priority on server schema
  upgrades because server currently only applies bootstrap SQL.
- 2026-03-24: Upgrade scripts must never run on the main server database unless
  a backup has been created first in a managed backup directory.
- 2026-03-24: Schema upgrades are applied in ordered version sequence and only
  for unapplied versions tracked in a migration versions table.
- 2026-03-24: The shared SQLite migration runner records migration versions by
  SQL filename stem (for example `001_bootstrap`) so existing vault migration
  records remain compatible while filename ordering still defines execution
  order.
- 2026-03-24: Existing bootstrap-only server databases without
  `schema_migrations` are adopted by validating the expected baseline tables and
  columns, then recording `001_bootstrap` as already applied before considering
  later upgrade scripts.
- 2026-03-24: Server schema backups are written under
  `data/backups/schema/server/` using SQLite's online backup API, and retention
  cleanup keeps the most recent backups plus any backups newer than the
  retention window.
- 2026-03-24: Vault and server migration execution now share one helper for
  ordered script discovery and version tracking, while backup-before-upgrade is
  enforced only for the main server DB in this implementation phase.
- 2026-03-24: Legacy bootstrap adoption without `schema_migrations` was removed;
  bootstrap scripts now create the tracking table directly, and existing
  deployed databases must be updated manually with that table before relying on
  future tracked upgrades.
- 2026-03-24: Human approval was given to close this quest after re-running
  schema migration tests, verifying the live `schema_migrations` record in the
  main database, and restarting the production server to a healthy state.
