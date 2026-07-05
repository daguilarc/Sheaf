# synth-async-logging Specification

Project: `projects/synth`. ID prefix: `slog`.

## Purpose

Define the JUCE-free thread-aware async logging library: thread identity,
the audio-thread-safe INFO producer interface, per-identity bounded queues
with drop-and-count overflow, round-robin draining to stdout and per-session
log files, block-accurate audio-position stamps, and runtime integration.
## Requirements
### Requirement: slog-1 — Project: JUCE-free async logging library
WHEN the synth async logging capability is implemented, THE repository SHALL provide JUCE-free C++20 logging headers under `projects/synth/include/synth` — an async log queue with its fixed-size log message type and `INFO(...)` macro, a lock-free bounded `CircularQueue<T, N>` ring buffer, and a `ThreadId` thread-identity utility — ported from The All Electric Smart Grid's thread-aware async logging system, included in the `projects/synth` library build and its JUCE-free test suite.

#### Scenario: Logging headers compile without JUCE
- **WHEN** a JUCE-free synth test includes the logging, queue, and thread-identity headers
- **THEN** the test compiles without seeing `JUCE_MAJOR_VERSION`

#### Scenario: One production implementation
- **WHEN** the JUCE-free tests and the runtime-hosted application both log
- **THEN** they exercise the same production log-queue implementation with no build-flag fork

### Requirement: slog-2 — Thread identity: enum, thread-local tag, and scoped guard
WHEN synth code needs thread identity, THE logging library SHALL provide a synth-specific `ThreadId` enum covering the framework's thread topology (at minimum message, audio, MIDI input, MIDI sender, and unknown), a `thread_local` current-thread tag with get/set accessors defaulting to unknown, a scoped RAII guard that restores the prior tag on exit, and a thread-name string mapping; THE runtime SHALL tag the message thread at startup, the audio and MIDI callbacks via scoped guards, and the MIDI sender worker in its run loop.

#### Scenario: Callback identity does not leak
- **WHEN** the audio callback tags itself with the scoped guard and returns
- **THEN** log messages produced inside the callback carry the audio thread identity
- **AND** the physical thread's tag reverts to its prior value after the callback

#### Scenario: Untagged threads still log
- **WHEN** a single untagged thread calls `INFO` (no other untagged thread logging concurrently)
- **THEN** the message is queued and rendered under the unknown thread identity

#### Scenario: Concurrent producers hold distinct identities
- **WHEN** the audio callback and a MIDI callback log during the same block
- **THEN** each enqueues onto its own identity's queue with no shared-producer race

### Requirement: slog-3 — Producer: single audio-thread-safe logging interface
WHEN any project thread logs, THE logging library SHALL expose one producer interface — the `INFO(...)` macro over the async log queue's `Log` — that formats via `snprintf` into a fixed-capacity message slot (256 bytes, truncated with forced null termination) on the calling thread and enqueues onto that thread's own bounded queue using lock-free atomic operations, performing no heap allocation, no locking, and no IO on the producer path; each `ThreadId` SHALL have its own queue, and because queues are per identity rather than per physical thread, every thread that may log concurrently with another SHALL hold a distinct `ThreadId` — the unknown identity is reserved for single-threaded contexts (startup, tests) and concurrent untagged producers are unsupported, documented as such on the logging interface.

#### Scenario: Audio thread logs safely
- **WHEN** application block-processing code calls `INFO` from the audio callback
- **THEN** the message is enqueued without locks, heap allocation, file, or console IO on the audio thread

#### Scenario: Long messages truncate
- **WHEN** a formatted message exceeds the fixed message capacity
- **THEN** the stored message is truncated and null-terminated rather than overflowing or allocating

### Requirement: slog-4 — Overflow: drop with per-thread missed counts
WHEN a producer's queue is full, THE async log queue SHALL drop the new message and increment an atomic missed-message counter for that `ThreadId` without blocking the producer; WHEN the drain runs, THE async log queue SHALL report and reset each nonzero missed count as a log line naming the thread and count.

#### Scenario: Full queue never blocks
- **WHEN** a thread logs while its queue holds the maximum message count
- **THEN** the call returns after incrementing the thread's missed counter
- **AND** no queued message is overwritten

#### Scenario: Missed counts surface in the log
- **WHEN** a drain pass runs after messages were dropped for a thread
- **THEN** a line reporting the missed count for that thread is written
- **AND** the counter resets to zero

### Requirement: slog-5 — Drain: round-robin consumption to stdout and session file
WHEN the drain entry point runs, THE async log queue SHALL round-robin across the per-thread queues, writing each drained message as a line containing a wall-clock `HH:MM:SS` prefix, the captured sample count, the producing thread's name, and the message text, mirroring every line to stdout and appending it to the session log file with a flush; WHEN a log directory is configured, THE async log queue SHALL create one timestamp-named session log file per process lifetime with no in-session rotation; WHEN no directory is configured, file writes SHALL be skipped while stdout mirroring continues.

#### Scenario: Interleaved producers all drain
- **WHEN** audio, message, and MIDI threads have queued messages
- **THEN** a drain pass writes messages from every non-empty queue rather than exhausting one queue first

#### Scenario: Session file per process
- **WHEN** the runtime configures the log directory and the first line is written
- **THEN** exactly one timestamp-named log file is created for the session and appended for the process lifetime

#### Scenario: Unconfigured directory degrades to stdout
- **WHEN** no log directory has been configured
- **THEN** drained lines appear on stdout and no file is created

### Requirement: slog-6 — Timestamps: runtime-owned audio position clock
WHEN a message is filled, THE async log queue SHALL capture the current sample count from a settable non-owning sample-counter source and render it in the drained line; the source SHALL default to unset (rendering sample 0), and THE runtime SHALL register its per-block-advanced sample counter as the source so log lines carry block-accurate audio position while audio runs (stamps within a block share that block's counter value; per-sample stamping is not provided).

#### Scenario: Stamps reflect block audio position
- **WHEN** the runtime has registered its sample counter and the audio callback logs during block N
- **THEN** the drained line carries the sample count the runtime had advanced to for that block

#### Scenario: Logging works before audio starts
- **WHEN** code logs during initialization before any sample counter is registered
- **THEN** the message is queued and drained normally with a sample stamp of zero

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

### Requirement: slog-8 — Tests: JUCE-free coverage of the production logger
WHEN the synth test suite runs, THE logging library SHALL be covered by JUCE-free unit tests exercising the production producer and drain paths through test hooks (reset, queue-size and missed-count inspection, test-controlled log directory, session-file path inspection), including enqueue/drain round-trip, overflow missed-count behavior, truncation, and session-file creation.

#### Scenario: Logger tests run in synth suite
- **WHEN** a developer runs `make -C projects/synth test`
- **THEN** the async logger unit tests run and pass as part of the JUCE-free suite

#### Scenario: Tests use isolated directories
- **WHEN** logger tests need file output
- **THEN** they configure a test-controlled directory and inspect the session file path through test hooks

