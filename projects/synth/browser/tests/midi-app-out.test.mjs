// The app's one MIDI-out port in the browser, keyed by APP_MIDI_OUT_KEY
// (the largest 32-bit value, matching BrowserMidiBridge.hpp's
// kAppMidiOutBridgeKey) rather than a controller slot index.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { APP_MIDI_OUT_KEY } from "../src/protocol.js";
import { BrowserMidiManager } from "../src/midi.js";

// Three levels up from the COMPILED location (dist/tests) reaches
// projects/synth, the same shape version-drift.test.mjs uses to find the
// repository root from there.
const synthRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function read(relativeToSynthRoot) {
  return readFile(path.join(synthRoot, relativeToSynthRoot), "utf8");
}

function intervalOptions(overrides = {}) {
  return {
    setInterval: () => 1,
    clearInterval: () => {},
    ...overrides,
  };
}

function makePort(id, name) {
  const port = { id, name, state: "connected", sent: [] };
  port.send = (bytes) => port.sent.push(Array.from(bytes));
  return port;
}

function makeTimestampedPort(id, name) {
  const port = { id, name, state: "connected", sent: [] };
  port.send = (bytes, timestamp) => port.sent.push({ bytes: Array.from(bytes), timestamp });
  return port;
}

test("kAppMidiOutBridgeKey is declared equal to the largest uint32_t value", async () => {
  const source = await read("include/synth/browser/BrowserMidiBridge.hpp");
  assert.match(
    source,
    /kAppMidiOutBridgeKey\s*=\s*std::numeric_limits<std::uint32_t>::max\(\)/,
    "kAppMidiOutBridgeKey must stay declared as the largest uint32_t value, the same value protocol.ts's APP_MIDI_OUT_KEY hard-codes",
  );
});

test("APP_MIDI_OUT_KEY matches the C++ kAppMidiOutBridgeKey by value, not just by source pattern", () => {
  // The test above only pattern-matches the C++ declaration's source text; it
  // would stay green even if kAppMidiOutBridgeKey's actual value drifted from
  // the largest uint32_t (e.g. "max() - 1"). This runs the real C++ binary
  // (built by `make test` at projects/synth's root) and compares the printed
  // runtime value against protocol.ts's own constant.
  const binaryPath = path.join(synthRoot, "build", "browser_midi_bridge_tests");
  const output = execFileSync(binaryPath, { encoding: "utf8" });
  const match = output.match(/APP_MIDI_OUT_BRIDGE_KEY=(\d+)/);
  assert.ok(match, "the C++ test binary prints its bridge key's runtime value");
  assert.equal(
    Number(match[1]),
    APP_MIDI_OUT_KEY,
    "the browser's app MIDI-out key must equal the C++ bridge key's actual value",
  );
});

test("drainOutputsNow delivers an app-out payload via port.send with dueTimeMicros/1000, and no controller port receives it", async () => {
  const appOut = makeTimestampedPort("app-out", "App Out");
  const controllerOut = makeTimestampedPort("controller-out", "Controller Out");
  const access = {
    inputs: new Map(),
    outputs: new Map([[appOut.id, appOut], [controllerOut.id, controllerOut]]),
    onstatechange: null,
  };
  const queue = [
    { controllerIx: APP_MIDI_OUT_KEY, bytes: [0xb0, 7, 100], delivery: "scheduled", dueTimeMicros: 5_500_000 },
  ];
  const manager = new BrowserMidiManager({
    submitEndpoints: async () => [
      { type: "open-output", controllerIx: 0, identifier: controllerOut.id, name: controllerOut.name },
      { type: "open-output", controllerIx: APP_MIDI_OUT_KEY, identifier: appOut.id, name: appOut.name },
    ],
    deliverMidi: async () => {},
    dequeueMidiOutput: async () => queue.shift(),
  }, intervalOptions({ requestMIDIAccess: async () => access, nowMicros: () => 100_000 }));

  await manager.startFromUserActivation();

  assert.deepEqual(
    appOut.sent,
    [{ bytes: [0xb0, 7, 100], timestamp: 5_500 }],
    "the app port receives the payload, timestamped at dueTimeMicros/1000",
  );
  assert.deepEqual(controllerOut.sent, [], "a controller port never receives an app-out payload");
  manager.stop();
});

test("releasing the app MIDI-out port sends All Notes Off on all sixteen channels before releasing it", async () => {
  const appOut = makePort("app-out", "App Out");
  let cleared = 0;
  const order = [];
  appOut.clear = () => { cleared += 1; order.push("clear"); };
  const originalSend = appOut.send;
  appOut.send = (...args) => { order.push("send"); return originalSend(...args); };
  const access = { inputs: new Map(), outputs: new Map([[appOut.id, appOut]]), onstatechange: null };
  let connected = true;
  const manager = new BrowserMidiManager({
    submitEndpoints: async () => connected
      ? [{ type: "open-output", controllerIx: APP_MIDI_OUT_KEY, identifier: appOut.id, name: appOut.name }]
      : [{ type: "close-output", controllerIx: APP_MIDI_OUT_KEY }],
    deliverMidi: async () => {},
    dequeueMidiOutput: async () => undefined,
  }, intervalOptions({ requestMIDIAccess: async () => access, nowMicros: () => 100_000 }));

  await manager.startFromUserActivation();
  connected = false;
  await manager.poll();

  assert.equal(appOut.sent.length, 16, "sixteen Control Change 123 messages, one per channel");
  for (let channel = 0; channel < 16; channel++) {
    assert.deepEqual(appOut.sent[channel], [0xb0 + channel, 123, 0]);
  }
  assert.equal(cleared, 1, "the port is still cleared when no controller shares it");
  assert.deepEqual(
    order,
    ["clear", ...Array(16).fill("send")],
    "clear() must land before any All Notes Off send, so clear() cannot drop the just-sent silence",
  );
  manager.stop();
});

test("releasing the app MIDI-out port does not clear() a port a controller key still holds, and times the silence after everything already queued to it", async () => {
  const sharedPort = makeTimestampedPort("shared", "Shared Port");
  const cleared = [];
  sharedPort.clear = () => cleared.push("shared");
  const access = { inputs: new Map(), outputs: new Map([[sharedPort.id, sharedPort]]), onstatechange: null };
  const queue = [
    { controllerIx: APP_MIDI_OUT_KEY, bytes: [0xb0, 7, 100], delivery: "scheduled", dueTimeMicros: 5_500_000 },
  ];
  let connected = true;
  const manager = new BrowserMidiManager({
    submitEndpoints: async () => connected
      ? [
          { type: "open-output", controllerIx: 0, identifier: sharedPort.id, name: sharedPort.name },
          { type: "open-output", controllerIx: APP_MIDI_OUT_KEY, identifier: sharedPort.id, name: sharedPort.name },
        ]
      : [
          { type: "open-output", controllerIx: 0, identifier: sharedPort.id, name: sharedPort.name },
          { type: "close-output", controllerIx: APP_MIDI_OUT_KEY },
        ],
    deliverMidi: async () => {},
    dequeueMidiOutput: async () => queue.shift(),
  }, intervalOptions({ requestMIDIAccess: async () => access, nowMicros: () => 100_000, drainIntervalMs: 16 }));

  await manager.startFromUserActivation();
  connected = false;
  await manager.poll();

  assert.equal(sharedPort.sent.length, 17, "the earlier scheduled app message plus sixteen Control Change 123 messages");
  const allNotesOff = sharedPort.sent.slice(1);
  assert.equal(allNotesOff.length, 16, "All Notes Off still goes out even though the port is shared");
  for (let channel = 0; channel < 16; channel++) {
    assert.deepEqual(allNotesOff[channel].bytes, [0xb0 + channel, 123, 0]);
    // now (100_000us) + the 16ms drain lookahead is 116ms, earlier than the
    // 5,500ms already queued to this port, so the later time governs.
    assert.equal(
      allNotesOff[channel].timestamp,
      5_500,
      "All Notes Off is timestamped no earlier than the latest due time already sent to this port",
    );
  }
  assert.deepEqual(cleared, [], "clear() is skipped: controller key 0 still holds this same port");
  manager.stop();
});

test("controller ports keep their own traffic across a MIDI-out reconnect, and a ninth controller row and the app key never cross", async () => {
  const controllerA = makeTimestampedPort("controller-a", "Controller A");
  const controllerB = makeTimestampedPort("controller-b", "Controller B (ninth row)");
  const appPort1 = makeTimestampedPort("app-1", "App Out 1");
  const appPort2 = makeTimestampedPort("app-2", "App Out 2");
  for (const port of [controllerA, controllerB]) port.clear = () => { port.cleared = (port.cleared ?? 0) + 1; };
  const NINTH_ROW_KEY = 8;

  const access = {
    inputs: new Map(),
    outputs: new Map([[controllerA.id, controllerA], [controllerB.id, controllerB], [appPort1.id, appPort1], [appPort2.id, appPort2]]),
    onstatechange: null,
  };
  let queue = [];
  let reconnected = false;
  const manager = new BrowserMidiManager({
    submitEndpoints: async () => [
      { type: "open-output", controllerIx: 0, identifier: controllerA.id, name: controllerA.name },
      { type: "open-output", controllerIx: NINTH_ROW_KEY, identifier: controllerB.id, name: controllerB.name },
      {
        type: "open-output",
        controllerIx: APP_MIDI_OUT_KEY,
        identifier: reconnected ? appPort2.id : appPort1.id,
        name: reconnected ? appPort2.name : appPort1.name,
      },
    ],
    deliverMidi: async () => {},
    dequeueMidiOutput: async () => queue.shift(),
  }, intervalOptions({ requestMIDIAccess: async () => access, nowMicros: () => 100_000 }));

  await manager.startFromUserActivation();

  // Before any reconnect: a ninth-row message and an app message, queued
  // together, each reach only their own port.
  queue = [
    { controllerIx: NINTH_ROW_KEY, bytes: [0x90, 60, 100], delivery: "scheduled", dueTimeMicros: 1_000_000 },
    { controllerIx: APP_MIDI_OUT_KEY, bytes: [0xb0, 7, 50], delivery: "scheduled", dueTimeMicros: 1_000_000 },
  ];
  await manager.drainOutputs();
  assert.deepEqual(controllerB.sent.map((m) => m.bytes), [[0x90, 60, 100]], "the ninth row's own message reaches it");
  assert.deepEqual(appPort1.sent.map((m) => m.bytes), [[0xb0, 7, 50]], "the app's own message reaches it");
  assert.deepEqual(controllerA.sent, [], "controller A, unaddressed, receives nothing");

  // Reconnect the MIDI-out port to a different device (appPort2). The
  // controller ports' own open-output actions repeat with the same
  // identifier, so they are no-ops; only the app key's binding changes.
  reconnected = true;
  await manager.poll();

  assert.equal(controllerA.cleared, undefined, "reconnecting the MIDI-out port never clears controller A");
  assert.equal(controllerB.cleared, undefined, "reconnecting the MIDI-out port never clears controller B (the ninth row)");

  // After the reconnect, both controller keys must still receive only their
  // own traffic, and the app key's traffic now lands on the NEW app port,
  // never on appPort1 (the old one) or on either controller port.
  queue = [
    { controllerIx: 0, bytes: [0x90, 61, 100], delivery: "scheduled", dueTimeMicros: 2_000_000 },
    { controllerIx: NINTH_ROW_KEY, bytes: [0x90, 62, 100], delivery: "scheduled", dueTimeMicros: 2_000_000 },
    { controllerIx: APP_MIDI_OUT_KEY, bytes: [0xb0, 7, 51], delivery: "scheduled", dueTimeMicros: 2_000_000 },
  ];
  await manager.drainOutputs();

  assert.deepEqual(controllerA.sent.map((m) => m.bytes), [[0x90, 61, 100]], "controller A still gets only its own key's traffic");
  assert.deepEqual(
    controllerB.sent.map((m) => m.bytes),
    [[0x90, 60, 100], [0x90, 62, 100]],
    "controller B (the ninth row) still gets only its own key's traffic, before and after the reconnect",
  );
  assert.deepEqual(appPort2.sent.map((m) => m.bytes), [[0xb0, 7, 51]], "the reconnected app port receives the new app traffic");
  // The old app port is released as part of the reconnect (a different
  // identifier), so it gets its own All Notes Off before being dropped --
  // the app port's own release rule -- on top of the one message already
  // sent to it; no MORE app traffic reaches it after that.
  const allNotesOffOnOldPort = Array.from({ length: 16 }, (_unused, channel) => [0xb0 + channel, 123, 0]);
  assert.deepEqual(
    appPort1.sent.map((m) => m.bytes),
    [[0xb0, 7, 50], ...allNotesOffOnOldPort],
    "the old app port is silenced and released, and receives no further app traffic",
  );

  manager.stop();
});
