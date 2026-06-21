import assert from "node:assert/strict";
import test from "node:test";

import { parseInputLine } from "../src/protocol.js";

test("parses control.exit input", () => {
  assert.deepEqual(parseInputLine('{"type":"control.exit"}'), { type: "control.exit" });
});

test("parses user.message input", () => {
  assert.deepEqual(parseInputLine('{"type":"user.message","text":"hello"}'), {
    type: "user.message",
    text: "hello",
  });
});

test("parses user.message metadata objects", () => {
  assert.deepEqual(parseInputLine('{"type":"user.message","text":"hello","metadata":{"turn":1}}'), {
    type: "user.message",
    text: "hello",
    metadata: { turn: 1 },
  });
});

test("rejects invalid JSON input", () => {
  assert.equal(parseInputLine("{").type, "error");
});

test("rejects non-object JSON input", () => {
  assert.equal(parseInputLine('"hello"').code, "invalid_input_command");
});

test("rejects unsupported input commands", () => {
  assert.equal(parseInputLine('{"type":"unknown"}').code, "unsupported_input_command");
});

test("rejects empty user text", () => {
  assert.equal(parseInputLine('{"type":"user.message","text":""}').code, "invalid_user_message");
});

test("rejects non-string user text", () => {
  assert.equal(parseInputLine('{"type":"user.message","text":123}').code, "invalid_user_message");
});

test("rejects non-object user metadata", () => {
  assert.equal(
    parseInputLine('{"type":"user.message","text":"hello","metadata":[]}').code,
    "invalid_input_command",
  );
});

test("rejects extra fields on control.exit", () => {
  assert.equal(
    parseInputLine('{"type":"control.exit","reason":"done"}').code,
    "invalid_input_command",
  );
});

test("rejects extra fields on user.message", () => {
  assert.equal(
    parseInputLine('{"type":"user.message","text":"hello","extra":true}').code,
    "invalid_input_command",
  );
});
