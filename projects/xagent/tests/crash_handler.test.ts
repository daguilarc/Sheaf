import assert from "node:assert/strict";
import test from "node:test";

import { createUncaughtExceptionHandler } from "../src/service/crash_handler.js";

// C1 regression: service_main installs a top-level uncaughtException
// handler so a stray unhandled error (e.g. a stream `error` event that
// escaped the per-spawn stdin guards) closes owned runs before the
// process exits instead of orphaning every detached provider group.
//
test("uncaughtException handler logs, closes owned runs, then exits non-zero", async () => {
  const logged: Array<{ message: string; error: unknown }> = [];
  const exits: number[] = [];
  let closeAllCalls = 0;
  const closeAllPromise = Promise.resolve();
  const runManager = {
    closeAll(): Promise<void> {
      closeAllCalls += 1;
      return closeAllPromise;
    },
  };
  const handler = createUncaughtExceptionHandler({
    runManager,
    log: (message, error) => {
      logged.push({ message, error });
    },
    exit: (code) => {
      exits.push(code);
    },
  });

  handler(new Error("stray stream error"));

  // The handler does not await closeAll synchronously; let the microtask
  // queue drain so the `.finally(() => exit(1))` runs.
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(closeAllCalls, 1);
  assert.deepEqual(exits, [1]);
  assert.equal(logged.length, 1);
  assert.equal(logged[0]?.message, "xagent service uncaughtException:");
});

test("uncaughtException handler is idempotent and does not close runs twice", async () => {
  const exits: number[] = [];
  let closeAllCalls = 0;
  const runManager = {
    closeAll(): Promise<void> {
      closeAllCalls += 1;
      return Promise.resolve();
    },
  };
  const handler = createUncaughtExceptionHandler({
    runManager,
    log: () => {},
    exit: (code) => {
      exits.push(code);
    },
  });

  handler(new Error("first"));
  handler(new Error("second"));

  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(closeAllCalls, 1);
  assert.deepEqual(exits, [1]);
});

test("uncaughtException handler still exits non-zero when closeAll rejects", async () => {
  const exits: number[] = [];
  const logged: Array<{ message: string; error: unknown }> = [];
  const runManager = {
    closeAll(): Promise<void> {
      return Promise.reject(new Error("close failed"));
    },
  };
  const handler = createUncaughtExceptionHandler({
    runManager,
    log: (message, error) => {
      logged.push({ message, error });
    },
    exit: (code) => {
      exits.push(code);
    },
  });

  handler(new Error("stray"));

  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(exits, [1]);
  assert.ok(
    logged.some((entry) =>
      entry.message === "xagent service closeAll during uncaughtException failed:"
    ),
  );
});
