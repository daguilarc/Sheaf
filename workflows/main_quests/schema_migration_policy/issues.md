# Issues

## `executescript` breaks per-migration transactional integrity

`sqlite_migrations.py:92` uses `conn.executescript(sql)` to apply each migration.
SQLite's `executescript` implicitly commits any open transaction before executing,
then runs each statement outside the caller's transaction context. This creates two
failure modes:

1. If a second migration fails after a first migration succeeded via `executescript`,
   the first migration's DDL is already committed but its version may not be recorded
   (since `_record_applied_version` and `conn.commit()` at line 95 haven't run yet).
2. If the process crashes between `executescript` and `_record_applied_version`, the
   schema change is applied but never tracked.

This contradicts spec `02_execution_model.md:74`: "Runtime must never mark a version
as applied if its script failed" — and the inverse is also violated (a version's DDL
can be applied but never recorded).

The simplest fix is to move `conn.commit()` inside the loop immediately after
`_record_applied_version` for each migration, so each migration + its version record
are committed together before the next migration begins.

Status: `completed`

Next Action: `none — replaced executescript with _execute_script_transactionally using explicit BEGIN/rollback/commit per migration`

## Duplicate compatibility checker functions

`_server_schema_compatible_with_bootstrap` in `runtime.py:179-199` and
`_vault_schema_compatible_with_bootstrap` in `schema.py:34-54` are structurally
identical functions that differ only in which expected-schema dict they reference.

Superseded by "Remove `_EXPECTED_SERVER_SCHEMA` and compatibility checkers" below —
the entire compatibility checker path is being removed.

Status: `completed`

Next Action: `none — resolved by removing the compatibility checker path entirely`

## Backup cleanup glob matches all `.sqlite3` files in directory

`sqlite_migrations.py:182` uses `policy.directory.glob("*.sqlite3")` to find backup
files for retention cleanup. This matches every `.sqlite3` file in the directory, not
just files created by this policy's `database_name`. If multiple databases share a
parent backup directory or a user places other SQLite files there, unrelated files
could be deleted.

Should use `policy.directory.glob(f"{policy.database_name}_pre_migration_*.sqlite3")`
to scope cleanup to files this policy actually creates.

Status: `completed`

Next Action: `none — cleanup glob now scoped to policy.database_name prefix; covered by test_apply_migrations_prunes_only_matching_database_backups`

## No test for migration script failure leaving version unrecorded

Spec `03_validation_and_rollout.md:14` requires: "migration failure does not record
version as applied." There is a test for backup failure blocking upgrades, but no
test for what happens when a migration SQL script itself raises an error. This is
especially important given the `executescript` transactional concern above.

Status: `completed`

Next Action: `none — covered by test_apply_migrations_failure_rolls_back_schema_and_version`

## Remove `_EXPECTED_SERVER_SCHEMA` and compatibility checkers

The expected-schema dicts (`_EXPECTED_SERVER_SCHEMA` in `runtime.py:74-164`,
`_EXPECTED_VAULT_SCHEMA` in `schema.py:14-18`) and their compatibility checker
functions exist to adopt legacy databases that lack the `schema_migrations` table.
There is only one deployment. Instead of maintaining this machinery:

1. Add the `schema_migrations` CREATE TABLE to `001_bootstrap.sql` (and the vault
   bootstrap equivalent) so the tracking table is part of the baseline schema.
2. Remove `_EXPECTED_SERVER_SCHEMA`, `_EXPECTED_VAULT_SCHEMA`, and both
   `_*_schema_compatible_with_bootstrap` functions.
3. Remove the `compatibility_checker` parameter and its associated code path from
   `apply_migrations` in `sqlite_migrations.py`.
4. After the diff stabilizes, manually add the `schema_migrations` table to the one
   existing deployed database.

This also resolves the "Duplicate compatibility checker functions" issue above.

Status: `completed`

Next Action: `none — schema dicts, compatibility checkers, and compatibility_checker parameter removed; schema_migrations CREATE TABLE added to both bootstrap SQL files; production database verified with schema_migrations present and 001_bootstrap recorded after restart`

## Legacy baseline adoption assumes `files[0]` is the bootstrap script

`sqlite_migrations.py:70` records `files[0].stem` as the already-applied version
when adopting a legacy database. This relies on the convention that the first file
alphabetically is always the bootstrap script. There is no guard or assertion that
`files[0]` matches an expected pattern like `001_bootstrap`.

Status: `completed`

Next Action: `none — legacy adoption path removed entirely along with compatibility checker`
