// sbw-13: the app's one MIDI-out port in the browser, keyed by
// APP_MIDI_OUT_KEY (the largest 32-bit value, matching
// BrowserMidiBridge.hpp's kAppMidiOutBridgeKey) rather than a controller
// slot index.
import assert from "node:assert/strict";
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

test("kAppMidiOutBridgeKey is declared equal to the largest uint32_t value", async () => {
  const source = await read("include/synth/browser/BrowserMidiBridge.hpp");
  assert.match(
    source,
    /kAppMidiOutBridgeKey\s*=\s*std::numeric_limits<std::uint32_t>::max\(\)/,
    "kAppMidiOutBridgeKey must stay declared as the largest uint32_t value, the same value protocol.ts's APP_MIDI_OUT_KEY hard-codes",
  );
});

test("releasing the app MIDI-out port sends All Notes Off on all sixteen channels before releasing it", async () => {
  const appOut = makePort("app-out", "App Out");
  let cleared = 0;
  appOut.clear = () => { cleared += 1; };
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
  manager.stop();
});

test("releasing the app MIDI-out port does not clear() a port a controller key still holds", async () => {
  const sharedPort = makePort("shared", "Shared Port");
  const cleared = [];
  sharedPort.clear = () => cleared.push("shared");
  const access = { inputs: new Map(), outputs: new Map([[sharedPort.id, sharedPort]]), onstatechange: null };
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
    dequeueMidiOutput: async () => undefined,
  }, intervalOptions({ requestMIDIAccess: async () => access, nowMicros: () => 100_000 }));

  await manager.startFromUserActivation();
  connected = false;
  await manager.poll();

  assert.equal(sharedPort.sent.length, 16, "All Notes Off still goes out even though the port is shared");
  assert.deepEqual(cleared, [], "clear() is skipped: controller key 0 still holds this same port");
  manager.stop();
});
