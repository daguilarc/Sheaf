# Validation And Rollout

## Validation

- Add tests for migration planning:
  - no pending versions -> no backup creation, no schema changes
  - pending versions -> backup required before script execution
- Add tests for migration execution:
  - fresh DB applies bootstrap + upgrades in order
  - existing DB applies only unapplied upgrades
  - re-run is no-op when fully migrated
- Add tests for failure behavior:
  - backup failure prevents all pending upgrade execution
  - migration failure does not record version as applied
- Add tests for backup retention policy:
  - preserves recent backups
  - preserves minimum count
  - removes only backups beyond retention thresholds

## Rollout Plan

### Phase 1: Server Migration Runner

- Implement migration tracking/execution for server DB.
- Add backup-before-upgrade behavior for server DB.
- Add backup retention cleanup and structured runtime logging.

### Phase 2: Policy Convergence

- Align vault and server migration behavior under one shared migration utility
  where practical.
- Standardize naming, metadata, and failure semantics.

### Phase 3: Documentation Lock-In

- Document migration operational commands and recovery playbook.
- Document retention defaults and override strategy.

## Exit Criteria

- Main server DB no longer depends solely on bootstrap idempotence for schema
  evolution.
- Pending schema upgrades are version-tracked and applied in deterministic
  order.
- Backup is mandatory and verified before any server DB upgrade scripts run.
- Backup directory layout and retention policy are defined and implemented.
- Automated tests cover happy path, no-op path, and failure paths for migration
  and backup workflow.
