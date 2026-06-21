# Xagent Cross-Harness Subagent CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `projects/xagent`, a Node/TypeScript CLI that runs long-lived cross-harness subagent sessions over stdin/stdout JSONL.

**Architecture:** `src/main.ts` is a thin executable that parses commands and delegates to a CLI module. `src/runtime.ts` owns the stdio turn loop, sequencing, output filtering, logging, and adapter orchestration. Harness integrations live behind `HarnessAdapter` implementations so provider-specific stream parsing stays isolated and testable.

**Tech Stack:** Node >=20, TypeScript `NodeNext`, built-in `node:test`, built-in `child_process`, filesystem JSONL logs under `data/xagent/`.

---

## File Structure

- Create `projects/xagent/package.json`: package metadata, `bin`, and scripts.
- Create `projects/xagent/tsconfig.json`: same compiler settings as other Node projects.
- Create `projects/xagent/Makefile`: `install`, `build`, `test`, `clean`.
- Create `projects/xagent/src/main.ts`: executable entry point.
- Create `projects/xagent/src/cli.ts`: argument parsing and command dispatch for `run`, `list`, `logs`.
- Create `projects/xagent/src/events.ts`: event/input types, sequence emitter, role/mode/harness constants.
- Create `projects/xagent/src/protocol.ts`: stdin JSONL parsing and input validation.
- Create `projects/xagent/src/filter.ts`: `--subagent`/`--full` output filtering and 1500 ms delta coalescing.
- Create `projects/xagent/src/sanitize.ts`: secret redaction and workspace path relativization.
- Create `projects/xagent/src/logs.ts`: `data/xagent/` run directory, metadata, normalized/raw JSONL writing, offline listing/log reading.
- Create `projects/xagent/src/adapters/types.ts`: common harness adapter interface.
- Create `projects/xagent/src/adapters/fake.ts`: deterministic fake adapter for tests.
- Create `projects/xagent/src/adapters/process_jsonl.ts`: shared JSONL process-spawn adapter helpers.
- Create `projects/xagent/src/adapters/codex.ts`: Codex CLI adapter.
- Create `projects/xagent/src/adapters/pi.ts`: Pi adapter placeholder backed by Pi package import with unavailable fallback.
- Create `projects/xagent/src/adapters/cursor.ts`: Cursor CLI adapter.
- Create `projects/xagent/src/adapters/claude_code.ts`: Claude Code CLI adapter.
- Create `projects/xagent/src/adapters/index.ts`: adapter factory and capability warnings.
- Create `projects/xagent/tests/*.test.ts`: focused unit and end-to-end tests.
- Modify `Makefile`: add `xagent` to `PROJECTS` plus shortcut targets.
- Modify `.gitignore`: ignore generated `projects/xagent/dist/`.
- Modify `openspec/changes/add-xagent-cross-harness-subagent-cli/tasks.md`: mark completed tasks only after implementation, review, and verification.

---

### Task 1: Scaffold Package, CLI Parser, And Protocol Types

**Files:**
- Create: `projects/xagent/package.json`
- Create: `projects/xagent/tsconfig.json`
- Create: `projects/xagent/Makefile`
- Create: `projects/xagent/src/main.ts`
- Create: `projects/xagent/src/cli.ts`
- Create: `projects/xagent/src/events.ts`
- Create: `projects/xagent/src/protocol.ts`
- Create: `projects/xagent/tests/cli.test.ts`
- Create: `projects/xagent/tests/protocol.test.ts`
- Modify: `Makefile`
- Modify: `.gitignore`

- [x] **Step 1: Write failing CLI validation tests**

Create `projects/xagent/tests/cli.test.ts` with tests that import `parseArgs` from `../src/cli.js` and assert:

```ts
assert.deepEqual(parseArgs(["run", "--harness", "codex", "--subagent"]).command, "run");
assert.throws(() => parseArgs(["run", "--subagent"]), /--harness/);
assert.throws(() => parseArgs(["run", "--harness", "codex"]), /--subagent.*--full|--full.*--subagent/);
assert.throws(() => parseArgs(["run", "--harness", "codex", "--subagent", "--full"]), /exactly one/);
assert.throws(() => parseArgs(["run", "--harness", "codex", "--subagent", "--bogus"]), /--bogus/);
```

- [x] **Step 2: Write failing protocol tests**

Create `projects/xagent/tests/protocol.test.ts` with tests for:

```ts
assert.deepEqual(parseInputLine('{"type":"control.exit"}'), { type: "control.exit" });
assert.deepEqual(parseInputLine('{"type":"user.message","text":"hello"}'), { type: "user.message", text: "hello" });
assert.equal(parseInputLine("{").type, "error");
assert.equal(parseInputLine('{"type":"unknown"}').code, "unsupported_input_command");
assert.equal(parseInputLine('{"type":"user.message","text":""}').code, "invalid_user_message");
```

- [x] **Step 3: Add package scaffold**

Use the same TypeScript settings as `projects/conductor`. `package.json` must include:

```json
{
  "name": "xagent",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/src/main.js",
  "types": "./dist/src/main.d.ts",
  "bin": { "xagent": "./dist/src/main.js" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/src/main.js",
    "test": "npm run build && node --test dist/tests/*.test.js",
    "prepack": "npm run build"
  },
  "engines": { "node": ">=20" },
  "devDependencies": {
    "@types/node": "^22.15.21",
    "typescript": "^5.8.3"
  }
}
```

- [x] **Step 4: Implement CLI parser**

`parseArgs(argv: string[]): CliCommand` must support:

```ts
type CliCommand =
  | { command: "run"; harness: HarnessName; mode: OutputMode; model?: string; thinkingLevel?: ThinkingLevel; initialMessage?: string }
  | { command: "list" }
  | { command: "logs"; runId: string }
  | { command: "help"; topic?: "run" };
```

Supported `run` flags are exactly `--harness`, `--model`, `--thinking-level`, `--subagent`, and `--full`, with an optional trailing initial message. Harness values are `codex`, `pi`, `cursor`, `claude_code`; thinking levels are `low`, `medium`, `high`, `xhigh`.

- [x] **Step 5: Implement protocol parser and event types**

`parseInputLine(line: string)` returns either `UserInputCommand` or an error object with `type: "error"`, `code`, and `message`. `events.ts` defines the normalized event union from the OpenSpec contract and an `EventSequencer` that stamps `schema_version: 1`, `run_id`, `sequence`, and ISO timestamp.

- [x] **Step 6: Wire executable entry point**

`src/main.ts` should call `main(process.argv.slice(2), process.stdin, process.stdout, process.stderr, process.cwd())` and set `process.exitCode = 1` on failure.

- [x] **Step 7: Add xagent Make targets**

Add `xagent` to root `PROJECTS`, `.PHONY`, and shortcut targets matching existing project patterns: `xagent-build`, `xagent-test`, `xagent-clean`.

- [x] **Step 8: Ignore generated build output**

Add `projects/xagent/dist/` to `.gitignore`, matching existing per-project Node build output ignores.

- [x] **Step 9: Verify Task 1**

Run:

```bash
cd projects/xagent
npm install
npm test
```

Expected: CLI/protocol tests pass after implementation.

### Task 2: Runtime Loop, Output Filtering, Logging, And Sanitization

**Files:**
- Create: `projects/xagent/src/runtime.ts`
- Create: `projects/xagent/src/filter.ts`
- Create: `projects/xagent/src/logs.ts`
- Create: `projects/xagent/src/sanitize.ts`
- Create: `projects/xagent/src/adapters/types.ts`
- Create: `projects/xagent/src/adapters/fake.ts`
- Modify: `projects/xagent/src/cli.ts`
- Test: `projects/xagent/tests/runtime.test.ts`
- Test: `projects/xagent/tests/logs.test.ts`

- [x] **Step 1: Write fake-adapter runtime tests**

Create `runtime.test.ts` using `Readable`/`Writable` streams. Tests must verify:

- startup emits `session.started` then `session.ready`;
- two `user.message` input lines produce two turns on the same fake adapter instance;
- after each turn, output contains `turn.started`, `message.completed`, `turn.completed`, and `session.ready`;
- `--subagent` suppresses routine `tool.completed.output`;
- `--full` includes `raw.provider`, `tool.started`, and `tool.completed`.

- [x] **Step 2: Write logging tests**

Create `logs.test.ts` using `mkdtemp`. Verify:

- run directories are created under `<repoRoot>/data/xagent/<run_id>/`;
- `metadata.json`, `normalized.jsonl`, and `raw-provider.jsonl` are written;
- `listRuns(repoRoot)` reads persisted metadata without live process state;
- `readNormalizedLog(repoRoot, runId)` returns persisted normalized JSONL text.

- [x] **Step 3: Implement adapter interface and fake adapter**

`HarnessAdapter` should expose:

```ts
type HarnessAdapter = {
  readonly harness: HarnessName;
  readonly capabilities: HarnessCapabilities;
  start(options: HarnessStartOptions): Promise<HarnessSession>;
};

type HarnessSession = {
  readonly providerThreadId?: string;
  submit(context: AdapterTurnContext): AsyncIterable<AdapterEvent>;
  close(): Promise<void>;
};
```

`AdapterTurnContext` includes `text`, runtime-provided `turnId`, and
`inputSequence`. Adapters must use this context instead of creating independent
turn sequencing.

`AdapterEvent` should include normalized events without the base envelope plus `rawProvider?: unknown` where needed.

- [x] **Step 4: Implement runtime loop**

`runSession(options)` creates a run record, starts the adapter, emits `session.started`, emits `session.ready`, reads stdin line-by-line, validates commands, submits user turns serially, emits output events, and closes on `control.exit` or EOF.

- [x] **Step 5: Implement filter and debounce**

`filter.ts` must:

- pass all normalized events in `full`;
- suppress `raw.provider`, reasoning raw payloads, and routine tool output in `subagent`;
- buffer `message.delta` in `subagent` and release at most once per 1500 ms, or immediately before `message.completed`.

Use an injectable clock/timer in tests so debounce behavior is deterministic.

- [x] **Step 6: Implement sanitization**

Redact common secret forms (`Bearer ...`, `sk-...`, `AKIA...`, and `api_key|token|secret|password` assignments). Relativize string paths under `repoRoot`.

- [x] **Step 7: Implement offline commands**

`cli.ts` should call `listRuns` for `xagent list` and `readNormalizedLog` for `xagent logs <run_id>`.

- [x] **Step 8: Verify Task 2**

Run:

```bash
cd projects/xagent
npm test
```

Expected: runtime/logging/filter tests pass.

### Task 3: Process-Backed Harness Adapters

**Files:**
- Create: `projects/xagent/src/adapters/process_jsonl.ts`
- Create: `projects/xagent/src/adapters/codex.ts`
- Create: `projects/xagent/src/adapters/cursor.ts`
- Create: `projects/xagent/src/adapters/claude_code.ts`
- Create: `projects/xagent/src/adapters/pi.ts`
- Create: `projects/xagent/src/adapters/index.ts`
- Test: `projects/xagent/tests/adapters.test.ts`
- Test fixtures: `projects/xagent/tests/fixtures/*.jsonl`

- [x] **Step 1: Write adapter fixture tests**

Create fixtures for representative provider events:

- Codex: `thread.started`, `turn.started`, `item.completed` with `agent_message`, `item.started/completed` with `command_execution`, `turn.completed`.
- Cursor: assistant text stream event, tool call event, final result-like event.
- Claude Code: `stream_event` text deltas, tool use/result payload, result payload.
- Pi: `agent_start`, `message_update` text delta, `tool_execution_start`, `tool_execution_end`, `agent_end`.

Tests should feed fixture lines into parser functions and assert normalized `message.completed`, `tool.started`, `tool.completed`, `turn.completed`, and `raw.provider` events.

- [x] **Step 2: Implement shared process JSONL helper**

`process_jsonl.ts` should spawn a command, write prompt text when needed, parse stdout lines as JSON when possible, preserve non-JSON text as status/raw events, and resolve when the child exits. Keep this helper injectable with a fake spawn for tests.

- [x] **Step 3: Implement Codex adapter**

Use `codex exec --json` for first turn and `codex exec resume --json <provider_thread_id>` for later turns when the SDK is not used. Map `thread.started.thread_id` to `providerThreadId`; map `agent_message` items to assistant text; map `command_execution` items to tool events.

- [x] **Step 4: Implement Cursor adapter**

Use `cursor-agent --print --output-format stream-json --stream-partial-output`, add `--resume <id>` when a provider thread exists, and pass `--model` when provided. If `--thinking-level` is provided, emit a warning because Cursor does not use it in this contract.

- [x] **Step 5: Implement Claude Code adapter**

Use `claude --print --output-format stream-json --include-partial-messages`, add `--resume <id>` when a provider thread exists, pass `--model` and map `--thinking-level` to `--effort`.

- [x] **Step 6: Implement Pi adapter**

Create an adapter module that invokes the local `pi` CLI behind a narrow boundary. If the command/session cannot be initialized in the current environment, emit `harness_unavailable` cleanly. Map Pi event names according to the xagent event schema.

- [x] **Step 7: Implement adapter factory and warnings**

`createAdapter(harness, dependencies)` returns the selected adapter. Unsupported option warnings are emitted as normalized `status` events before the first turn.

- [x] **Step 8: Verify Task 3**

Run:

```bash
cd projects/xagent
npm test
```

Expected: adapter fixture tests pass without invoking real external harnesses.

### Task 4: End-To-End CLI Behavior

**Files:**
- Modify: `projects/xagent/src/cli.ts`
- Modify: `projects/xagent/src/runtime.ts`
- Test: `projects/xagent/tests/e2e.test.ts`

- [x] **Step 1: Write executable e2e tests**

Build first, then spawn `node dist/src/main.js run --harness fake --subagent` only in tests through a test-only adapter injection path or environment variable. Write two JSONL `user.message` commands to stdin and assert same-session follow-up behavior. The public parser must still reject `--harness fake`.

- [x] **Step 2: Test subagent suppression**

The fake adapter should emit raw provider deltas, a tool call with output, and final text. Assert stdout in `--subagent` omits raw provider events and routine tool output while logs preserve them.

- [x] **Step 3: Test full visibility**

Run the same fake turn with `--full` and assert stdout includes `raw.provider`, `tool.started`, `tool.completed`, `message.completed`, and `turn.completed`.

- [x] **Step 4: Test offline list/log commands through the executable**

After an e2e run writes `data/xagent/`, run `node dist/src/main.js list` and `node dist/src/main.js logs <run_id>` with the same cwd. Assert they read disk and do not require a running xagent process.

- [x] **Step 5: Verify Task 4**

Run:

```bash
cd projects/xagent
npm test
```

Expected: all xagent tests pass.

### Task 5: OpenSpec Task Sync And Repository Verification

**Files:**
- Modify: `openspec/changes/add-xagent-cross-harness-subagent-cli/tasks.md`
- Modify if needed: `Makefile`

- [x] **Step 1: Mark OpenSpec tasks complete**

After Tasks 1-4 pass review, update every checkbox in `openspec/changes/add-xagent-cross-harness-subagent-cli/tasks.md` from `- [ ]` to `- [x]`.

- [x] **Step 2: Run validation**

Run:

```bash
openspec validate add-xagent-cross-harness-subagent-cli
openspec status --change add-xagent-cross-harness-subagent-cli
```

Expected: OpenSpec validation passes and status shows all tasks complete.

- [x] **Step 3: Run project verification**

Run:

```bash
make xagent-test
```

Expected: install/build/test for `projects/xagent` passes.

- [x] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: only `projects/xagent/`, root `Makefile`, the xagent OpenSpec change, and this plan file are changed.

---

## Spec Coverage Self-Review

- xa-1 is covered by Task 1 CLI parser/tests.
- xa-2 is covered by Task 1 protocol tests and Task 2 runtime loop.
- xa-3 is covered by Task 1 event types and Task 2 runtime tests.
- xa-4 and xa-5 are covered by Task 2 filter tests and Task 4 e2e tests.
- xa-6 and xa-7 are covered by Task 3 adapters and warning tests.
- xa-8 is covered by Task 2 fake adapter runtime tests and Task 4 e2e follow-up tests.
- xa-9 is covered by Task 2 logging/offline command tests and Task 4 executable list/log tests.
- xa-10 is covered by Task 2 sanitization tests.
