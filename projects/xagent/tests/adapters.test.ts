import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { AdapterEvent, AdapterTurnContext } from "../src/adapters/types.js";
import { assertCommandAvailable, ProcessJsonlSession, type ProcessHarnessState } from "../src/adapters/process_jsonl.js";
import { ClaudeCodeAdapter, parseClaudeProviderEvent } from "../src/adapters/claude_code.js";
import { buildCodexCommand, parseCodexProviderEvent } from "../src/adapters/codex.js";
import { parseCursorProviderEvent } from "../src/adapters/cursor.js";
import { createAdapter } from "../src/adapters/index.js";
import { parsePiProviderEvent } from "../src/adapters/pi.js";
import type { HarnessName } from "../src/events.js";

const context: AdapterTurnContext = {
  text: "run tests",
  turnId: "turn_1",
  inputSequence: 1,
};

test("codex fixture maps provider events into normalized adapter events", async () => {
  const events = await parseFixture("codex.jsonl", parseCodexProviderEvent);

  assertEventTypes(events, ["tool.started", "tool.completed", "message.completed", "turn.completed"]);
  assert.equal(events.find((event) => event.type === "message.completed")?.text, "Codex final");
  assert.equal(events.find((event) => event.type === "turn.completed")?.provider_thread_id, "codex-thread-1");
});

test("cursor fixture maps provider events into normalized adapter events", async () => {
  const events = await parseFixture("cursor.jsonl", parseCursorProviderEvent);

  assertEventTypes(events, [
    "message.delta",
    "message.delta",
    "tool.started",
    "tool.completed",
    "message.delta",
    "message.delta",
    "message.delta",
    "message.completed",
    "turn.completed",
  ]);
  const deltas = events
    .filter((event) => event.type === "message.delta")
    .map((event) => event.type === "message.delta" ? event.delta : "");
  assert.deepEqual(deltas, ["Starting", " now.", "| ", "| ", "Done."]);
  // `result` fuses both segments ("Starting now.| | Done."), but only the
  // post-tool segment is the turn's final assistant message. The controller
  // consumes final_text as the report, so it must not carry narration.
  assert.equal(
    events.find((event) => event.type === "turn.completed")?.final_text,
    "| | Done.",
  );
  const started = events.find((event) => event.type === "tool.started");
  assert.equal(started?.type === "tool.started" ? started.tool_call_id : undefined, "tool-1");
  assert.equal(started?.type === "tool.started" ? started.name : undefined, "read");
  assert.deepEqual(
    started?.type === "tool.started" ? started.input : undefined,
    { path: "sample.txt" },
  );
  const completed = events.find((event) => event.type === "tool.completed");
  assert.equal(completed?.type === "tool.completed" ? completed.tool_call_id : undefined, "tool-1");
  assert.equal(completed?.type === "tool.completed" ? completed.name : undefined, "read");
  assert.equal(completed?.type === "tool.completed" ? completed.status : undefined, "completed");
  assert.deepEqual(
    completed?.type === "tool.completed" ? completed.output : undefined,
    { success: { content: "ok", path: "sample.txt" } },
  );
  assert.equal(events.find((event) => event.type === "message.completed")?.text, "| | Done.");
  assert.equal(events.find((event) => event.type === "turn.completed")?.provider_thread_id, "cursor-thread-1");
});

test("cursor adapter maps failed shell tool_call completions", () => {
  const state: ProcessHarnessState = { providerSequence: 1 };
  const events = parseCursorProviderEvent({
    type: "tool_call",
    subtype: "completed",
    call_id: "tool-fail",
    tool_call: {
      shellToolCall: {
        args: { command: "false" },
        result: {
          failure: { command: "false", exitCode: 1, stdout: "", stderr: "" },
          isBackground: false,
        },
      },
      toolCallId: "tool-fail",
    },
  }, context, state);

  assert.deepEqual(events, [{
    type: "tool.completed",
    tool_call_id: "tool-fail",
    name: "shell",
    status: "failed",
    output: {
      failure: { command: "false", exitCode: 1, stdout: "", stderr: "" },
      isBackground: false,
    },
    error: "command failed (exit 1): false",
  }]);
});

test("cursor adapter drops flushes via model_call_id and keeps repeated chunks", () => {
  const state: ProcessHarnessState = { providerSequence: 0 };
  const events: AdapterEvent[] = [];
  const rawEvents = [
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Starting" }] },
      session_id: "cursor-thread-2",
      timestamp_ms: 1,
    },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: " now." }] },
      session_id: "cursor-thread-2",
      timestamp_ms: 2,
    },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Starting now." }] },
      session_id: "cursor-thread-2",
      timestamp_ms: 3,
      model_call_id: "call-1",
    },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "| " }] },
      session_id: "cursor-thread-2",
      timestamp_ms: 4,
    },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "| " }] },
      session_id: "cursor-thread-2",
      timestamp_ms: 5,
    },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      session_id: "cursor-thread-2",
      timestamp_ms: 6,
    },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "| | Done." }] },
      session_id: "cursor-thread-2",
    },
    {
      type: "result",
      subtype: "success",
      session_id: "cursor-thread-2",
      result: "Starting now.| | Done.",
    },
  ];

  for (const raw of rawEvents) {
    events.push(...parseCursorProviderEvent(raw, context, state));
  }

  const deltas = events
    .filter((event) => event.type === "message.delta")
    .map((event) => event.type === "message.delta" ? event.delta : "");
  assert.deepEqual(deltas, ["Starting", " now.", "| ", "| ", "Done."]);
  assert.equal(deltas.join(""), "Starting now.| | Done.");
  // Deltas still stream every segment; the report is the last one only.
  assert.equal(events.find((event) => event.type === "turn.completed")?.final_text, "| | Done.");
  assert.equal(state.providerThreadId, "cursor-thread-2");
});

test("claude code fixture maps provider events into normalized adapter events", async () => {
  const events = await parseFixture("claude_code.jsonl", parseClaudeProviderEvent);

  assertEventTypes(events, ["message.delta", "tool.started", "tool.completed", "message.completed", "turn.completed"]);
  assert.equal(events.find((event) => event.type === "message.completed")?.text, "Claude final");
  assert.equal(events.find((event) => event.type === "turn.completed")?.provider_thread_id, "claude-thread-1");
});

test("claude code adapter launches sessions with auto permission mode", async () => {
  const binDir = await mkdtemp(path.join(tmpdir(), "xagent-claude-bin-"));
  const fakeClaude = path.join(binDir, "claude");
  await writeFile(
    fakeClaude,
    [
      "#!/usr/bin/env node",
      "console.log(JSON.stringify({ type: 'argv', argv: process.argv.slice(2), session_id: 'claude-thread-1' }))",
      "console.log(JSON.stringify({ type: 'result', message_id: 'msg-1', result: 'done' }))",
      "",
    ].join("\n"),
  );
  await chmod(fakeClaude, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = [binDir, previousPath].filter(Boolean).join(path.delimiter);
  try {
    const session = await new ClaudeCodeAdapter().start({ cwd: process.cwd(), model: "sonnet", thinkingLevel: "high" });
    const events: AdapterEvent[] = [];
    for await (const event of session.submit(context)) {
      events.push(event);
    }

    const argvEvent = events.find((event) => event.type === "raw.provider" && isRecord(event.payload) && event.payload.type === "argv");
    assert.ok(argvEvent?.type === "raw.provider" && isRecord(argvEvent.payload));
    assert.deepEqual(argvEvent.payload.argv, [
      "--print",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--permission-mode",
      "auto",
      "--model",
      "sonnet",
      "--effort",
      "high",
      context.text,
    ]);
  } finally {
    process.env.PATH = previousPath;
  }
});

test("pi fixture maps provider events into normalized adapter events", async () => {
  const events = await parseFixture("pi.jsonl", parsePiProviderEvent);

  assertEventTypes(events, ["message.delta", "tool.started", "tool.completed", "message.completed", "turn.completed"]);
  assert.equal(events.find((event) => event.type === "message.completed")?.text, "Pi final");
  assert.equal(events.find((event) => event.type === "turn.completed")?.provider_thread_id, "pi-thread-1");
});

test("pi real CLI fixture ignores thinking and empty agent end summaries", async () => {
  const events = await parseFixture("pi-real.jsonl", parsePiProviderEvent);

  assertEventTypes(events, ["message.delta", "message.completed", "turn.completed"]);
  assert.equal(events.find((event) => event.type === "message.delta")?.delta, "XAGENT_HELLO_PI");
  assert.equal(events.find((event) => event.type === "message.completed")?.text, "XAGENT_HELLO_PI");
  assert.equal(events.find((event) => event.type === "turn.completed")?.provider_thread_id, "pi-session-1");
});

test("adapter factory reports capabilities for all supported harnesses", () => {
  assert.deepEqual(createAdapter("codex").capabilities, {
    forwardsModel: true,
    forwardsThinkingLevel: true,
    streamsDeltas: true,
  });
  assert.deepEqual(createAdapter("cursor").capabilities, {
    forwardsModel: true,
    forwardsThinkingLevel: false,
    streamsDeltas: true,
  });
  assert.equal(createAdapter("pi").harness, "pi");
  assert.equal(createAdapter("claude_code").harness, "claude_code");
});

test("all four adapters emit a resume argv on the first turn when provider_thread_id is supplied", async () => {
  const cases: Array<{
    readonly name: HarnessName;
    readonly command: string;
    readonly script: string;
    readonly assertResumed: (argv: string[], threadId: string) => void;
  }> = [
    {
      name: "codex",
      command: "codex",
      script: [
        "#!/usr/bin/env node",
        "console.log(JSON.stringify({ type: 'argv', argv: process.argv.slice(2) }))",
        "console.log(JSON.stringify({ type: 'thread.started', thread_id: 'codex-thread-1' }))",
        "console.log(JSON.stringify({ type: 'turn.completed', final_text: 'done' }))",
        "",
      ].join("\n"),
      assertResumed: (argv, threadId) => {
        assert.deepEqual(argv.slice(0, 5), [
          "exec",
          "resume",
          "--json",
          "--skip-git-repo-check",
          "--dangerously-bypass-approvals-and-sandbox",
        ]);
        assert.equal(argv.at(-2), threadId);
      },
    },
    {
      name: "cursor",
      command: "cursor-agent",
      script: [
        "#!/usr/bin/env node",
        "console.log(JSON.stringify({ type: 'argv', argv: process.argv.slice(2), thread_id: 'cursor-thread-1' }))",
        "console.log(JSON.stringify({ event: 'result', text: 'done' }))",
        "",
      ].join("\n"),
      assertResumed: (argv, threadId) => {
        const resumeIndex = argv.indexOf("--resume");
        assert.ok(resumeIndex >= 0, "cursor argv must include --resume");
        assert.equal(argv[resumeIndex + 1], threadId);
        const separatorIndex = argv.lastIndexOf("--");
        assert.ok(separatorIndex >= 0, "cursor argv must include -- before the prompt");
        assert.equal(argv[separatorIndex + 1], context.text);
      },
    },
    {
      name: "pi",
      command: "pi",
      script: [
        "#!/usr/bin/env node",
        "console.log(JSON.stringify({ type: 'argv', argv: process.argv.slice(2) }))",
        "console.log(JSON.stringify({ type: 'session', id: 'pi-session-1' }))",
        "console.log(JSON.stringify({ type: 'agent_end', final_text: 'done' }))",
        "",
      ].join("\n"),
      assertResumed: (argv, threadId) => {
        const sessionIndex = argv.indexOf("--session");
        assert.ok(sessionIndex >= 0, "pi argv must include --session");
        assert.equal(argv[sessionIndex + 1], threadId);
      },
    },
    {
      name: "claude_code",
      command: "claude",
      script: [
        "#!/usr/bin/env node",
        "console.log(JSON.stringify({ type: 'argv', argv: process.argv.slice(2), session_id: 'claude-thread-1' }))",
        "console.log(JSON.stringify({ type: 'result', result: 'done' }))",
        "",
      ].join("\n"),
      assertResumed: (argv, threadId) => {
        const resumeIndex = argv.indexOf("--resume");
        assert.ok(resumeIndex >= 0, "claude argv must include --resume");
        assert.equal(argv[resumeIndex + 1], threadId);
      },
    },
  ];

  for (const item of cases) {
    const binDir = await mkdtemp(path.join(tmpdir(), `xagent-resume-${item.name}-`));
    const fake_bin = path.join(binDir, item.command);
    await writeFile(fake_bin, item.script);
    await chmod(fake_bin, 0o755);

    const previousPath = process.env.PATH;
    process.env.PATH = [binDir, previousPath].filter(Boolean).join(path.delimiter);
    try {
      const adapter = createAdapter(item.name);
      const threadId = `resume-${item.name}-thread`;
      const session = await adapter.start({
        cwd: process.cwd(),
        providerThreadId: threadId,
      });
      try {
        const events: AdapterEvent[] = [];
        for await (const event of session.submit(context)) {
          events.push(event);
        }
        const argvEvent = events.find(
          (event) => event.type === "raw.provider"
            && isRecord(event.payload)
            && event.payload.type === "argv",
        );
        assert.ok(argvEvent?.type === "raw.provider" && isRecord(argvEvent.payload), item.name);
        const argv = (argvEvent.payload as { argv: string[] }).argv;
        item.assertResumed(argv, threadId);
      } finally {
        await session.close();
      }
    } finally {
      process.env.PATH = previousPath;
    }
  }
});

test("codex adapter launches child sessions without approval or sandbox prompts", () => {
  const initial = buildCodexCommand(context, { providerSequence: 0 }, { cwd: process.cwd() });
  assert.deepEqual(initial.args.slice(0, 4), [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
  assert.equal(initial.args.at(-1), context.text);

  const resumed = buildCodexCommand(
    context,
    { providerSequence: 0, providerThreadId: "codex-thread-1" },
    { cwd: process.cwd(), model: "gpt-5.5", thinkingLevel: "high" },
  );
  assert.deepEqual(resumed.args.slice(0, 5), [
    "exec",
    "resume",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
  ]);
  assert.ok(resumed.args.includes("--model"));
  assert.ok(resumed.args.includes("--config"));
  assert.ok(resumed.args.includes('model_reasoning_effort="high"'));
  assert.equal(resumed.args.at(-2), "codex-thread-1");
  assert.equal(resumed.args.at(-1), context.text);
});

test("process JSONL session preserves non-JSON stdout as raw provider and status events", async () => {
  const session = new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      args: [
        "-e",
        [
          "console.log('plain progress')",
          "console.log(JSON.stringify({ type: 'done', text: 'finished' }))",
        ].join(";"),
      ],
    }),
    parseEvent: (raw) => {
      if (isRecord(raw) && raw.type === "done") {
        return [{ type: "message.completed", message_id: "m1", role: "assistant", text: String(raw.text) }];
      }
      return [];
    },
  });

  const events: AdapterEvent[] = [];
  for await (const event of session.submit(context)) {
    events.push(event);
  }

  assert.equal(events.filter((event) => event.type === "raw.provider").length, 2);
  assert.equal(events.some((event) => event.type === "status" && event.message === "plain progress"), true);
  assert.equal(events.some((event) => event.type === "message.completed" && event.text === "finished"), true);
});

test("process JSONL session reports unexpected child exit as structured process_exit", async () => {
  const session = new ProcessJsonlSession({
    harness: "codex",
    cwd: process.cwd(),
    buildCommand: () => ({
      command: process.execPath,
      args: ["-e", "process.exit(137)"],
    }),
    parseEvent: () => [],
    captureProcessIdentity: (pid) => ({
      pid,
      process_group_id: pid,
      started_at: "2026-07-25T12:00:00.000Z",
      start_identity: "test-start-identity",
    }),
  });

  const events: AdapterEvent[] = [];
  for await (const event of session.submit(context)) {
    events.push(event);
  }

  const exitEvent = events.find((event) => event.type === "error");
  assert.equal(exitEvent?.type, "error");
  assert.equal(exitEvent?.type === "error" ? exitEvent.code : undefined, "process_exit");
  assert.deepEqual(
    exitEvent?.type === "error" ? exitEvent.details : undefined,
    { exit_code: 137, signal: null },
  );
  assert.equal(exitEvent?.type === "error" ? exitEvent.recoverable : undefined, false);
});

test("process command availability failures are reported as harness unavailable", async () => {
  await assert.rejects(
    () => assertCommandAvailable("definitely-not-a-real-xagent-command", "codex"),
    (error) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "harness_unavailable",
  );
});

async function parseFixture(
  fixtureName: string,
  parseEvent: (raw: unknown, context: AdapterTurnContext, state: ProcessHarnessState) => AdapterEvent[],
): Promise<AdapterEvent[]> {
  const text = await readFile(path.join("tests", "fixtures", fixtureName), "utf8");
  const state: ProcessHarnessState = { providerSequence: 0 };
  const events: AdapterEvent[] = [];
  for (const line of text.trim().split("\n")) {
    const raw = JSON.parse(line) as unknown;
    state.providerSequence += 1;
    events.push({ type: "raw.provider", harness: "codex", payload: raw, provider_sequence: state.providerSequence });
    events.push(...parseEvent(raw, context, state));
  }
  return events;
}

function assertEventTypes(events: AdapterEvent[], expectedTypes: string[]): void {
  assert.deepEqual(
    events.filter((event) => event.type !== "raw.provider").map((event) => event.type),
    expectedTypes,
  );
  assert.equal(events.some((event) => event.type === "raw.provider"), true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("cursor turn completion reports the final assistant segment, not the whole stream", () => {
  const state: ProcessHarnessState = { providerSequence: 0 };
  const events: AdapterEvent[] = [];
  const rawEvents = [
    // Narration segment, flushed before a tool call.
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "I'll read the brief." }] },
      session_id: "cursor-thread-3",
      timestamp_ms: 1,
    },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "I'll read the brief." }] },
      session_id: "cursor-thread-3",
      timestamp_ms: 2,
      model_call_id: "call-1",
    },
    // Final segment, flushed at turn end (no timestamp_ms, no model_call_id).
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "**Status:** DONE" }] },
      session_id: "cursor-thread-3",
      timestamp_ms: 3,
    },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "**Status:** DONE" }] },
      session_id: "cursor-thread-3",
    },
    {
      type: "result",
      subtype: "success",
      session_id: "cursor-thread-3",
      result: "I'll read the brief.**Status:** DONE",
    },
  ];

  for (const raw of rawEvents) {
    events.push(...parseCursorProviderEvent(raw, context, state));
  }

  assert.equal(
    events.find((event) => event.type === "message.completed")?.text,
    "**Status:** DONE",
  );
  assert.equal(
    events.find((event) => event.type === "turn.completed")?.final_text,
    "**Status:** DONE",
  );
});

test("cursor falls back to the result field when no final flush was observed", () => {
  const state: ProcessHarnessState = { providerSequence: 0 };
  const events = parseCursorProviderEvent(
    { type: "result", subtype: "success", result: "only text" },
    context,
    state,
  );
  assert.equal(events.find((event) => event.type === "turn.completed")?.final_text, "only text");
});
