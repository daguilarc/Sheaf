# Execution Model

## Intent

Define a concrete migration execution contract that can be implemented in the
server runtime with minimal ambiguity and low operational risk.

## Migration Script Model

- Migration scripts live in version-ordered files.
- Bootstrap script defines base schema for empty databases.
- Upgrade scripts contain incremental DDL/DML changes needed after bootstrap.
- Version identifiers are derived from filename prefix and must be unique.

Example shape:

- `001_bootstrap.sql`
- `002_add_requests_index.sql`
- `003_expand_turn_fields.sql`

## Version Tracking

- Maintain `schema_migrations` (or equivalent canonical table) with at least:
  - `version` (primary key)
  - `applied_at`
- Optional recommended fields:
  - `script_name`
  - `checksum`
- Runtime behavior:
  - list migration files in deterministic order
  - read applied versions
  - execute only versions not yet recorded
  - record each version after successful execution

## Upgrade Flow (Main Server DB)

1. Open DB connection and enable runtime pragmas.
2. Ensure migration tracking table exists.
3. Resolve pending upgrade versions.
4. If no pending upgrades, exit with no backup and no schema change.
5. If pending upgrades exist:
   - create backup directory if missing
   - create a timestamped backup artifact
   - only continue if backup succeeded
6. Execute pending upgrades in order.
7. Persist version records for applied upgrades.
8. Commit and emit structured logs/events for observability.

## Backup Directory And Naming

Policy target:

- Base directory: `data/backups/schema/`
- Per-database subdirectory:
  - `data/backups/schema/server/`
  - `data/backups/schema/vaults/` (optional in first implementation phase)
- Suggested backup filename:
  - `<db_name>_pre_migration_<utc_timestamp>.sqlite3`

## Backup Retention Policy

Minimum baseline:

- Keep all backups created in the last `N` days (default `14`).
- Keep at least the latest `M` backups even if older than `N` (default `10`).
- Cleanup runs after successful migration initialization and only removes files
  exceeding both thresholds.
- Cleanup failures are warnings, not migration blockers.

## Failure Policy

- Backup failure before pending upgrade application is fatal.
- Migration script execution failure is fatal and must halt startup for that DB.
- Runtime must never mark a version as applied if its script failed.
- Existing DB backup artifact remains available for manual recovery.

## Compatibility And Rollout

- Existing DBs without migration tracking are treated as "bootstrap already
  present" only when compatible with expected baseline; otherwise fail fast with
  a clear actionable error.
- Initial rollout should prioritize server DB migration runner parity with the
  existing vault migration behavior, then converge on a shared migration helper.
