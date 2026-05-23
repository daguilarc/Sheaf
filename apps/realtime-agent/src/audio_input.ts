import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";

import portAudio, { type DeviceInfo } from "naudiodon";

export const REALTIME_PCM_SAMPLE_RATE = 24000;

const x_pcmSampleFormat = portAudio.SampleFormat16Bit;
const x_channelCount = 1;
const x_frameDurationMs = 100;
const x_frameBytes =
  (REALTIME_PCM_SAMPLE_RATE * x_frameDurationMs * 2) / 1000 / x_channelCount;

export interface AudioInputDevice
{
  id: number;
  name: string;
  hostAPIName: string;
  defaultSampleRate: number;
}

export interface MicrophoneCaptureOptions
{
  inputDevice?: string;
  onFrame: (pcmBase64: string) => void;
  onError: (error: Error) => void;
}

export interface MicrophoneCapture
{
  start(): void;
  stop(): void;
}

export interface FakeMicrophoneCaptureOptions
{
  frames: Array<string | Buffer>;
  frameIntervalMs?: number;
  onFrame: (pcmBase64: string) => void;
  onError: (error: Error) => void;
}

export function ListInputDevices(): AudioInputDevice[]
{
  return portAudio
    .getDevices()
    .filter((device) => device.maxInputChannels > 0)
    .map((device) => MapDeviceInfo(device));
}

export function FormatInputDeviceList(devices: AudioInputDevice[]): string
{
  if (devices.length === 0)
  {
    return "No input devices found.";
  }

  return devices
    .map(
      (device) =>
        `${device.id}\t${device.name}\t${device.hostAPIName}\t${device.defaultSampleRate}`,
    )
    .join("\n");
}

export function ResolveInputDeviceId(
  devices: DeviceInfo[],
  inputDevice?: string,
): number
{
  const inputDevices = devices.filter((device) => device.maxInputChannels > 0);
  if (inputDevices.length === 0)
  {
    throw new Error("No microphone input devices are available.");
  }

  if (inputDevice === undefined || inputDevice.trim().length === 0)
  {
    return -1;
  }

  const trimmed = inputDevice.trim();
  const numericId = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numericId))
  {
    const byId = inputDevices.find((device) => device.id === numericId);
    if (byId === undefined)
    {
      throw new Error(`No input device found with id ${numericId}.`);
    }

    return byId.id;
  }

  const normalized = trimmed.toLowerCase();
  const matches = inputDevices.filter((device) =>
    device.name.toLowerCase().includes(normalized),
  );

  if (matches.length === 0)
  {
    throw new Error(`No input device matched "${inputDevice}".`);
  }

  if (matches.length > 1)
  {
    throw new Error(
      `Input device "${inputDevice}" matched multiple devices; use --list-input-devices and pass an id.`,
    );
  }

  return matches[0]!.id;
}

export function ResolveRequestedInputDeviceId(
  inputDevice: string | undefined,
  getDevices: () => DeviceInfo[] = () => portAudio.getDevices(),
): number
{
  if (inputDevice === undefined || inputDevice.trim().length === 0)
  {
    return -1;
  }

  return ResolveInputDeviceId(getDevices(), inputDevice);
}

export function CreateMicrophoneCapture(
  options: MicrophoneCaptureOptions,
): MicrophoneCapture
{
  if (
    process.platform === "darwin" &&
    (options.inputDevice === undefined || options.inputDevice.trim().length === 0)
  )
  {
    return CreateSoxMicrophoneCapture(options);
  }

  const deviceId = ResolveRequestedInputDeviceId(options.inputDevice);
  const processor = new PcmFrameProcessor(options.onFrame);
  let stream: Readable & { start?: () => void; quit?: (mode: string) => void };
  let stopped = false;

  try
  {
    stream = portAudio.AudioIO({
      inOptions: {
        deviceId,
        sampleRate: REALTIME_PCM_SAMPLE_RATE,
        channelCount: x_channelCount,
        sampleFormat: x_pcmSampleFormat,
        framesPerBuffer: Math.floor(
          (REALTIME_PCM_SAMPLE_RATE * x_frameDurationMs) / 1000,
        ),
      },
    }) as unknown as Readable & { start?: () => void; quit?: (mode: string) => void };
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to open microphone input: ${message}`);
  }

  stream.on("data", (chunk: Buffer) =>
  {
    try
    {
      processor.Push(chunk);
    }
    catch (pushError)
    {
      const err =
        pushError instanceof Error ? pushError : new Error(String(pushError));
      options.onError(err);
    }
  });

  stream.on("error", (error: Error) =>
  {
    options.onError(error);
  });

  return {
    start(): void
    {
      stream.start?.();
    },
    stop(): void
    {
      if (stopped)
      {
        return;
      }

      stopped = true;
      stream.removeAllListeners("data");
      stream.removeAllListeners("error");
      stream.quit?.("ABORT");
    },
  };
}

export function CreateSoxMicrophoneCapture(
  options: MicrophoneCaptureOptions,
): MicrophoneCapture
{
  const recPath = ResolveRecPath();
  const processor = new PcmFrameProcessor(options.onFrame);
  let processHandle: ChildProcessWithoutNullStreams | undefined;
  let stopped = false;

  return {
    start(): void
    {
      if (processHandle !== undefined)
      {
        return;
      }

      processHandle = spawn(recPath, [
        "-q",
        "-t",
        "raw",
        "-b",
        "16",
        "-e",
        "signed-integer",
        "-L",
        "-",
        "channels",
        String(x_channelCount),
        "rate",
        String(REALTIME_PCM_SAMPLE_RATE),
      ]);

      processHandle.stdout.on("data", (chunk: Buffer) =>
      {
        try
        {
          processor.Push(chunk);
        }
        catch (pushError)
        {
          const err =
            pushError instanceof Error ? pushError : new Error(String(pushError));
          options.onError(err);
        }
      });

      processHandle.stderr.on("data", (chunk: Buffer) =>
      {
        const message = chunk.toString("utf8").trim();
        if (message.length > 0 && !message.includes(" WARN "))
        {
          options.onError(new Error(`microphone recorder error: ${message}`));
        }
      });

      processHandle.on("error", (error) =>
      {
        options.onError(error);
      });

      processHandle.on("exit", (code, signal) =>
      {
        if (stopped)
        {
          return;
        }

        options.onError(
          new Error(`microphone recorder exited unexpectedly: code=${code ?? "null"} signal=${signal ?? "null"}`),
        );
      });
    },
    stop(): void
    {
      stopped = true;
      processHandle?.kill("SIGTERM");
      processHandle = undefined;
    },
  };
}

export function CreateFakeMicrophoneCapture(
  options: FakeMicrophoneCaptureOptions,
): MicrophoneCapture
{
  const intervalMs = options.frameIntervalMs ?? 0;
  let timer: NodeJS.Timeout | undefined;
  let index = 0;
  let stopped = false;

  const emitNext = (): void =>
  {
    if (stopped || index >= options.frames.length)
    {
      return;
    }

    const frame = options.frames[index];
    index += 1;

    const pcmBase64 =
      typeof frame === "string" ? frame : frame.toString("base64");
    options.onFrame(pcmBase64);

    if (index < options.frames.length)
    {
      if (intervalMs <= 0)
      {
        emitNext();
        return;
      }

      timer = setTimeout(emitNext, intervalMs);
    }
  };

  return {
    start(): void
    {
      emitNext();
    },
    stop(): void
    {
      stopped = true;
      if (timer !== undefined)
      {
        clearTimeout(timer);
      }
    },
  };
}

function ResolveRecPath(): string
{
  const configured = process.env.REALTIME_AGENT_REC_PATH?.trim();
  if (configured !== undefined && configured.length > 0)
  {
    return configured;
  }

  if (existsSync("/opt/homebrew/bin/rec"))
  {
    return "/opt/homebrew/bin/rec";
  }

  return "rec";
}

export function ResampleInt16Mono(
  input: Buffer,
  inputSampleRate: number,
  outputSampleRate: number,
): Buffer
{
  if (inputSampleRate === outputSampleRate)
  {
    return input;
  }

  const inputSamples = Math.floor(input.length / 2);
  if (inputSamples === 0)
  {
    return Buffer.alloc(0);
  }

  const ratio = outputSampleRate / inputSampleRate;
  const outputSamples = Math.max(1, Math.floor(inputSamples * ratio));
  const output = Buffer.alloc(outputSamples * 2);

  for (let outputIndex = 0; outputIndex < outputSamples; outputIndex += 1)
  {
    const sourcePosition = outputIndex / ratio;
    const lowerIndex = Math.floor(sourcePosition);
    const upperIndex = Math.min(lowerIndex + 1, inputSamples - 1);
    const fraction = sourcePosition - lowerIndex;

    const lower = input.readInt16LE(lowerIndex * 2);
    const upper = input.readInt16LE(upperIndex * 2);
    const sample = Math.round(lower + (upper - lower) * fraction);
    output.writeInt16LE(sample, outputIndex * 2);
  }

  return output;
}

export class PcmFrameProcessor
{
  private m_pending = Buffer.alloc(0);
  private m_onFrame: (pcmBase64: string) => void;

  constructor(onFrame: (pcmBase64: string) => void)
  {
    this.m_onFrame = onFrame;
  }

  Push(chunk: Buffer): void
  {
    this.m_pending = Buffer.concat([this.m_pending, chunk]);

    while (this.m_pending.length >= x_frameBytes)
    {
      const frame = this.m_pending.subarray(0, x_frameBytes);
      this.m_pending = this.m_pending.subarray(x_frameBytes);
      this.m_onFrame(frame.toString("base64"));
    }
  }
}

function MapDeviceInfo(device: DeviceInfo): AudioInputDevice
{
  return {
    id: device.id,
    name: device.name,
    hostAPIName: device.hostAPIName,
    defaultSampleRate: device.defaultSampleRate,
  };
}
