# synth-async-logging Delta

Project: `projects/synth`. ID prefix: `slog`.

## MODIFIED Requirements

### Requirement: slog-7 — Runtime integration: configuration, drain cadence, and ad hoc log replacement
WHEN the runtime starts, THE runtime SHALL configure the async log queue's directory from the runtime-owned persistent logs root before other startup logging is drained, and SHALL call the drain entry point as the final step of each message-thread timer tick; WHEN runtime patch orchestration reports command results, message application, runtime-configuration load/save results, or storage-batch provisioning, THE runtime SHALL log them through `INFO`, and the miniapp SHALL contain no ad hoc file-writing log path.

#### Scenario: Runtime drains every tick
- **WHEN** the message-thread timer fires
- **THEN** the log drain runs after the tick's other duties

#### Scenario: Patch activity logs through the async logger
- **WHEN** a patch command completes or a patch message is applied
- **THEN** the outcome is recorded via `INFO` and appears in the session log
- **AND** the ported miniapp contains no per-line `std::ofstream` logging code

#### Scenario: Configuration activity logs through the async logger
- **WHEN** runtime configuration is loaded, ignored as invalid, or saved
- **THEN** the outcome is recorded via `INFO` and appears in the session log

#### Scenario: Log directory comes from runtime data paths
- **WHEN** the runtime resolves persistent data paths for an application
- **THEN** it configures the async logger with `logs/` from those paths
- **AND** it does not read a log root from application-owned runtime config
