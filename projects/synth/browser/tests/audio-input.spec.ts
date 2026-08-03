import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_APPS, installRealFakeApp, stopRealFakeApp, synthNode } from "./helpers/fake-app.js";

type RuntimeResponse = { type: string; [key: string]: unknown };

const AUDIO_INPUT_PROBE = (FIXTURE_APPS as typeof FIXTURE_APPS & {
  audioInputProbe: { appId: string; displayName: string; uiHeight: number };
}).audioInputProbe;

const INPUT_VALUES = {
  mono: [0.125, 0.75, 0.875, 0.9375],
  stereo: [0.125, -0.25, 0.875, 0.9375],
  quadOut0Dominant: [0.25, 0.01, 0.5, 0.02],
  quadOut1Dominant: [0.01, -0.25, 0.02, 0.5],
} as const;

const PEAK_TOLERANCE_MICROUNITS = 2_000;

test.setTimeout(120_000);

test.afterEach(async ({ page }) => {
  await stopRealFakeApp(page);
});

function expectedProbePeakMicrounits(values: readonly number[], activeChannels: number): number {
  const sample = (channel: number) => channel < activeChannels ? values[channel] : 0;
  const out0 = sample(0) + 0.5 * sample(2);
  const out1 = sample(1) - sample(3);
  return Math.round(Math.max(Math.abs(out0), Math.abs(out1)) * 1_000_000);
}

async function runtimeRequest<T extends RuntimeResponse = RuntimeResponse>(
  page: Page,
  command: Record<string, unknown>,
): Promise<T> {
  const response = await page.evaluate(async (command) => {
    const state = (window as any).__task4Fake;
    if (!state?.runtime) throw new Error("fake runtime handle is not exposed");
    return state.runtime.request(command);
  }, command);
  if (response.type === "error") throw new Error(String(response.error));
  return response as T;
}

async function waitForNativeStats(page: Page, predicate: (stats: { blocks: number; peakMicrounits: number; deadlineMicrounits: number }) => boolean) {
  let latest = { blocks: 0, peakMicrounits: 0, deadlineMicrounits: 0 };
  await expect.poll(async () => {
    const response = await runtimeRequest<{ type: "audio-worklet-stats"; blocks: number; peakMicrounits: number; deadlineMicrounits: number }>(
      page,
      { type: "audio-worklet-stats" },
    );
    latest = {
      blocks: response.blocks,
      peakMicrounits: response.peakMicrounits,
      deadlineMicrounits: response.deadlineMicrounits,
    };
    return predicate(response);
  }, { timeout: 10_000 }).toBe(true);
  return latest;
}

async function expectAudioStatus(page: Page, text: string): Promise<void> {
  await page.locator(synthNode("runtime.sidebar.audio")).click();
  await expect(page.locator(synthNode("runtime.audio.input"))).toBeVisible();
  await expect(page.locator(synthNode("runtime.audio.status_line"))).toHaveText(text);
}

async function expectNativePeak(page: Page, expectedPeakMicrounits: number): Promise<void> {
  const stats = await waitForNativeStats(page, (candidate) =>
    Math.abs(candidate.peakMicrounits - expectedPeakMicrounits) <= PEAK_TOLERANCE_MICROUNITS);
  expect(stats.blocks).toBeGreaterThan(0);
  expect(Math.abs(stats.peakMicrounits - expectedPeakMicrounits)).toBeLessThanOrEqual(PEAK_TOLERANCE_MICROUNITS);
  expect(Number.isFinite(stats.deadlineMicrounits)).toBe(true);
}

async function expectRuntimeFunctionsLive(page: Page): Promise<void> {
  const beforeFrames = await page.evaluate(() => ((window as any).__task4Fake.observations.frames as unknown[]).length);
  await page.locator(synthNode("runtime.sidebar.file")).click();
  await expect(page.locator(synthNode("runtime.file.root"))).toBeVisible();
  await expect.poll(() => page.evaluate(() => ((window as any).__task4Fake.observations.frames as unknown[]).length))
    .toBeGreaterThan(beforeFrames);

  await expect(runtimeRequest(page, { type: "persistence-status" }))
    .resolves.toMatchObject({ type: "page-status" });
  await expect(runtimeRequest(page, { type: "midi-diagnostics" }))
    .resolves.toMatchObject({ type: "midi-diagnostics" });
  const first = await runtimeRequest<{ type: "audio-worklet-stats"; blocks: number; peakMicrounits: number; deadlineMicrounits: number }>(
    page,
    { type: "audio-worklet-stats" },
  );
  await waitForNativeStats(page, (candidate) => candidate.blocks > first.blocks);
}

for (const scenario of [
  { name: "mono", physicalChannels: 1, values: INPUT_VALUES.mono, status: "Input requested 4 / active 1 - input channel shortfall" },
  { name: "stereo", physicalChannels: 2, values: INPUT_VALUES.stereo, status: "Input requested 4 / active 2 - input channel shortfall" },
  { name: "quad out0", physicalChannels: 4, values: INPUT_VALUES.quadOut0Dominant, status: "Input requested 4 / active 4" },
  { name: "quad out1", physicalChannels: 4, values: INPUT_VALUES.quadOut1Dominant, status: "Input requested 4 / active 4" },
] as const) {
  test(`real Wasm probe transforms ${scenario.name} deterministic registered input`, async ({ page }) => {
    await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
      audioInput: {
        capture: "deterministic",
        physicalChannels: scenario.physicalChannels,
        channelValues: scenario.values,
      },
    });

    await expectAudioStatus(page, scenario.status);
    await expectNativePeak(page, expectedProbePeakMicrounits(scenario.values, scenario.physicalChannels));
    const registrations = await page.evaluate(() => (window as any).__task4Fake.resources.inputSourceRegistrations);
    expect(registrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ physicalChannels: scenario.physicalChannels, statusCode: 2 }),
    ]));
  });
}

test("permission denial keeps the real Wasm runtime live with safe silent input", async ({ page }) => {
  await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
    audioInput: { capture: "denied", physicalChannels: 0, channelValues: [0, 0, 0, 0] },
  });

  await expectAudioStatus(page, "Input requested 4 / active 0 - microphone permission denied");
  await expect(page.locator(synthNode("runtime.audio.input.retry"))).toBeVisible();
  await expectNativePeak(page, 0);
  await expectRuntimeFunctionsLive(page);
});

test("unreported shortfall keeps deterministic input and non-audio runtime functions live", async ({ page }) => {
  const values = [0.2, -0.125, 0.8, 0.7];
  await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
    audioInput: {
      capture: "deterministic",
      physicalChannels: 2,
      channelValues: values,
      omitTrackChannelCount: true,
    },
  });

  await expectAudioStatus(page, "Input requested 4 / active 2 - microphone channel count unreported, input channel shortfall");
  await expectNativePeak(page, expectedProbePeakMicrounits(values, 2));
  await expectRuntimeFunctionsLive(page);
});

test("stream termination clears active input while output, UI, persistence, and MIDI stay live", async ({ page }) => {
  const values = INPUT_VALUES.quadOut0Dominant;
  await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
    audioInput: { capture: "deterministic", physicalChannels: 4, channelValues: values },
  });
  await expectAudioStatus(page, "Input requested 4 / active 4");
  await expectNativePeak(page, expectedProbePeakMicrounits(values, 4));

  await page.evaluate(async () => {
    const input = (window as any).__task4Fake.audioInput;
    if (!input?.endCurrentTrack) throw new Error("audio input fixture cannot end the current track");
    await input.endCurrentTrack();
  });

  await expectAudioStatus(page, "Input requested 4 / active 0 - microphone stream ended");
  await expect(page.locator(synthNode("runtime.audio.input.retry"))).toBeVisible();
  await expectRuntimeFunctionsLive(page);
});
