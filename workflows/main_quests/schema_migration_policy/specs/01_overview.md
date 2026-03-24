# Overview

## Quest

- Name: `schema_migration_policy`
- Created: `2026-03-24`

## Summary

Establish and implement a durable schema migration policy for Sheaf SQLite
databases so schema evolution is safe, trackable, and repeatable.

The policy uses:

- one bootstrap schema script for fresh installs
- ordered incremental upgrade scripts for in-place changes
- a migration versions table to track applied upgrades
- mandatory backup creation before any upgrade scripts alter the main server DB

## Current State

- Vault DB already has migration tracking and ordered script application.
- Server DB currently executes only bootstrap SQL idempotently and lacks upgrade
  tracking/version state.
- Repository policy exists in notes but not as a fully implemented, enforced
  runtime migration contract.

## Goals

- Define one explicit migration policy that answers how and when schema
  upgrades run.
- Introduce (or standardize) a migration versions table for all managed
  databases.
- Ensure upgrade scripts run only when needed (unapplied versions only).
- Require backup creation before any server DB upgrade script executes.
- Define backup directory location and retention/cleanup policy.
- Provide implementation guidance and validation criteria sufficient for
  execution without reopening policy questions.

## Core Policy

- Migration inputs:
  - `001_bootstrap.sql` (or equivalent) for base schema
  - ordered upgrade scripts (for example `002_*.sql`, `003_*.sql`, ...)
- Fresh DB initialization:
  - apply bootstrap + all upgrades in order
  - record applied versions
- Existing DB initialization:
  - apply only unapplied upgrades in order
  - record newly applied versions
- All upgrade scripts must be idempotent and safe to retry after interrupted
  runs.

## Main Database Alter Timing

For the main server database, alter/upgrade scripts run only during
initialization after:

- migration inventory is loaded and unapplied versions are determined, and
- a migration backup has been successfully created.

If backup creation fails, no upgrade scripts may execute.

## Backup Policy Scope

Backup requirements apply at minimum to the main server database for any
in-place upgrade path. Vault DB backup behavior may adopt the same mechanism in
this quest or a directly-following implementation task.

## Non-Goals

- Building a cross-database cloud backup product.
- Supporting downgrade migrations in this first policy pass.
- Rewriting unrelated runtime behavior outside schema migration flow.
