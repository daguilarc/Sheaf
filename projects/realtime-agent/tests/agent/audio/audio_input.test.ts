import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateFakeMicrophoneCapture,
  PcmFrameProcessor,
  REALTIME_PCM_SAMPLE_RATE,
  ResolveRequestedInputDeviceId,
  ResampleInt16Mono,
} from "../../../src/agent/src/audio_input.js";

test("PcmFrameProcessor emits base64 frames at the configured chunk size", () =>
{
  const frames: string[] = [];
  const processor = new PcmFrameProcessor((frame) =>
  {
    frames.push(frame);
  });

  const chunk = Buffer.alloc(9600, 0);
  processor.Push(chunk);

  assert.equal(frames.length, 2);
  assert.equal(Buffer.from(frames[0]!, "base64").length, 4800);
});

test("ResampleInt16Mono converts 48kHz buffer to 24kHz", () =>
{
  const input = Buffer.alloc(4);
  input.writeInt16LE(1000, 0);
  input.writeInt16LE(-1000, 2);

  const output = ResampleInt16Mono(input, 48000, REALTIME_PCM_SAMPLE_RATE);
  assert.equal(output.length, 2);
});

test("CreateFakeMicrophoneCapture forwards frames to sendAudioFrame callback", () =>
{
  const received: string[] = [];
  const capture = CreateFakeMicrophoneCapture({
    frames: ["Zm9v", "YmFy"],
    onFrame: (frame) =>
    {
      received.push(frame);
    },
    onError: () =>
    {
      assert.fail("unexpected audio error");
    },
  });

  capture.start();
  assert.deepEqual(received, ["Zm9v", "YmFy"]);
  capture.stop();
});

test("ResolveRequestedInputDeviceId uses PortAudio default without enumerating devices", () =>
{
  const deviceId = ResolveRequestedInputDeviceId(undefined, () =>
  {
    assert.fail("default input should not enumerate devices");
  });

  assert.equal(deviceId, -1);
});

test("ResolveRequestedInputDeviceId enumerates only for explicit selectors", () =>
{
  const deviceId = ResolveRequestedInputDeviceId("Studio", () => [
    {
      id: 7,
      name: "Studio Mic",
      hostAPIName: "Core Audio",
      maxInputChannels: 1,
      maxOutputChannels: 0,
      defaultSampleRate: 48000,
      defaultLowInputLatency: 0,
      defaultLowOutputLatency: 0,
      defaultHighInputLatency: 0,
      defaultHighOutputLatency: 0,
    },
  ]);

  assert.equal(deviceId, 7);
});

test("fake session wiring forwards audio frames through sendAudioFrame", () =>
{
  const sent: string[] = [];
  const session = {
    sendAudioFrame(pcmBase64: string): void
    {
      sent.push(pcmBase64);
    },
  };

  const capture = CreateFakeMicrophoneCapture({
    frames: [Buffer.from("pcm-bytes").toString("base64")],
    onFrame: (frame) =>
    {
      session.sendAudioFrame(frame);
    },
    onError: () =>
    {
      assert.fail("unexpected audio error");
    },
  });

  capture.start();
  assert.deepEqual(sent, [Buffer.from("pcm-bytes").toString("base64")]);
});
