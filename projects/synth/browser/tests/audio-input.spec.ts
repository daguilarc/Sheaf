import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_APPS, installRealFakeApp, stopRealFakeApp, synthNode } from "./helpers/fake-app.js";

type RuntimeResponse = { type: string; [key: string]: unknown };

const AUDIO_INPUT_PROBE = (FIXTURE_APPS as typeof FIXTURE_APPS & {
  audioInputProbe: { appId: string; displayName: string; uiHeight: number };
}).audioInputProbe;

const INPUT_VALUES = {
  singleChannel: [0.125],
  stereoPair: [0.125, -0.25],
  fourLiveMonoClamp: [0.125, 0.75, 0.875, 0.9375],
  fourLiveStereoClamp: [0.125, -0.25, 0.875, 0.9375],
  quadOut0Dominant: [0.25, 0.01, 0.5, 0.02],
  quadOut1Dominant: [0.01, -0.25, 0.02, 0.5],
} as const;

const AUDIO_INPUT_STATUS = {
  online: 2,
  channelCountUnreported: 7,
} as const;

const PINNED_CAPTURE_CONSTRAINTS = {
  audio: {
    channelCount: { ideal: 4 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  },
} as const;

// 2,000 microunits is 0.002 full-scale. That leaves room for browser
// AudioWorklet/float scheduling noise while staying far below the separation
// between the deterministic probe peaks in this file.
const PEAK_TOLERANCE_MICROUNITS = 2_000;

test.setTimeout(120_000);

test.afterEach(async ({ page }) => {
  await stopRealFakeApp(page);
});

function expectedProbePeakMicrounits(values: readonly number[], activeChannels: number): number {
  const sample = (channel: number) => channel < activeChannels ? (values[channel] ?? 0) : 0;
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
  await waitForNativeStats(page, (candidate) =>
    candidate.blocks > 0 &&
    Number.isFinite(candidate.deadlineMicrounits) &&
    Math.abs(candidate.peakMicrounits - expectedPeakMicrounits) <= PEAK_TOLERANCE_MICROUNITS);
}

async function expectExactNativePeak(page: Page, expectedPeakMicrounits: number): Promise<void> {
  await waitForNativeStats(page, (candidate) =>
    candidate.blocks > 0 &&
    Number.isFinite(candidate.deadlineMicrounits) &&
    candidate.peakMicrounits === expectedPeakMicrounits);
}

async function audioResources(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__task4Fake.resources);
}

async function expectGrantedInputAcquisition(
  page: Page,
  expected: { sourceChannels: number; physicalChannels: number; statusCode?: number },
): Promise<void> {
  await expect.poll(async () => {
    const resources = await audioResources(page);
    const registrations = resources.inputSourceRegistrations.map((registration: { physicalChannels: number; statusCode: number; nativeHandle: number }) => ({
      physicalChannels: registration.physicalChannels,
      statusCode: registration.statusCode,
      nativeHandlePositive: registration.nativeHandle > 0,
    }));
    return {
      getUserMediaCalls: resources.getUserMediaCalls,
      getUserMediaConstraints: resources.getUserMediaConstraints,
      mediaStreamSourceCreations: resources.mediaStreamSourceCreations,
      registrationCount: registrations.length,
      registrations,
      distinctNativeHandles: new Set(resources.inputSourceRegistrations.map((registration: { nativeHandle: number }) => registration.nativeHandle)).size,
      connections: resources.inputSourceConnections,
    };
  }, { timeout: 5_000 }).toEqual({
    getUserMediaCalls: 1,
    getUserMediaConstraints: [PINNED_CAPTURE_CONSTRAINTS],
    mediaStreamSourceCreations: 1,
    registrationCount: expect.any(Number),
    registrations: expect.arrayContaining([{
      physicalChannels: expected.physicalChannels,
      statusCode: expected.statusCode ?? AUDIO_INPUT_STATUS.online,
      nativeHandlePositive: true,
    }]),
    distinctNativeHandles: 1,
    connections: [{
      destination: "native-worklet",
      outputIndex: 0,
      inputIndex: 0,
      sourceChannels: expected.sourceChannels,
      physicalChannels: expected.physicalChannels,
    }],
  });
  const acquiredResources = await audioResources(page);
  expect(acquiredResources.inputSourceRegistrations.length).toBeGreaterThanOrEqual(1);
  for (const registration of acquiredResources.inputSourceRegistrations) {
    expect(registration.physicalChannels).toBe(expected.physicalChannels);
    expect(registration.statusCode).toBe(expected.statusCode ?? AUDIO_INPUT_STATUS.online);
    expect(registration.nativeHandle).toBe(acquiredResources.inputSourceRegistrations[0].nativeHandle);
  }
  const resources = await audioResources(page);
  expect(resources.inputSourceConnections).not.toEqual(expect.arrayContaining([
    expect.objectContaining({ destination: "audio-context-destination" }),
  ]));
}

async function expectNoInputSourceAcquisition(page: Page): Promise<void> {
  const resources = await audioResources(page);
  expect(resources.getUserMediaCalls).toBe(1);
  expect(resources.getUserMediaConstraints).toEqual([PINNED_CAPTURE_CONSTRAINTS]);
  expect(resources.mediaStreamSourceCreations).toBe(0);
  expect(resources.inputSourceRegistrations).toEqual([]);
  expect(resources.inputSourceConnections).toEqual([]);
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
  {
    name: "one-channel source shape with one published physical channel",
    sourceChannels: 1,
    physicalChannels: 1,
    values: INPUT_VALUES.singleChannel,
    status: "Input requested 4 / active 1 - input channel shortfall",
  },
  {
    name: "two-channel source shape with two published physical channels",
    sourceChannels: 2,
    physicalChannels: 2,
    values: INPUT_VALUES.stereoPair,
    status: "Input requested 4 / active 2 - input channel shortfall",
  },
  {
    name: "four-channel source shape with four published physical channels out0",
    sourceChannels: 4,
    physicalChannels: 4,
    values: INPUT_VALUES.quadOut0Dominant,
    status: "Input requested 4 / active 4",
  },
  {
    name: "four-channel source shape with four published physical channels out1",
    sourceChannels: 4,
    physicalChannels: 4,
    values: INPUT_VALUES.quadOut1Dominant,
    status: "Input requested 4 / active 4",
  },
] as const) {
  test(`real Wasm probe transforms ${scenario.name}`, async ({ page }) => {
    await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
      audioInput: {
        capture: "deterministic",
        sourceChannels: scenario.sourceChannels,
        physicalChannels: scenario.physicalChannels,
        channelValues: scenario.values,
      },
    });

    await expectAudioStatus(page, scenario.status);
    await expectGrantedInputAcquisition(page, scenario);
    await expectNativePeak(page, expectedProbePeakMicrounits(scenario.values, scenario.physicalChannels));
  });
}

for (const scenario of [
  {
    name: "four-live-channel source clamped to one published physical channel",
    sourceChannels: 4,
    physicalChannels: 1,
    values: INPUT_VALUES.fourLiveMonoClamp,
    status: "Input requested 4 / active 1 - input channel shortfall",
  },
  {
    name: "four-live-channel source clamped to two published physical channels",
    sourceChannels: 4,
    physicalChannels: 2,
    values: INPUT_VALUES.fourLiveStereoClamp,
    status: "Input requested 4 / active 2 - input channel shortfall",
  },
] as const) {
  test(`real Wasm probe honors published physical-count clamp for ${scenario.name}`, async ({ page }) => {
    await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
      audioInput: {
        capture: "deterministic",
        sourceChannels: scenario.sourceChannels,
        physicalChannels: scenario.physicalChannels,
        channelValues: scenario.values,
      },
    });

    await expectAudioStatus(page, scenario.status);
    await expectGrantedInputAcquisition(page, scenario);
    await expectNativePeak(page, expectedProbePeakMicrounits(scenario.values, scenario.physicalChannels));
  });
}

test("literal zero deterministic input remains exactly silent through the real Wasm callback", async ({ page }) => {
  await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
    audioInput: {
      capture: "deterministic",
      sourceChannels: 1,
      physicalChannels: 1,
      channelValues: [0],
    },
  });

  await expectAudioStatus(page, "Input requested 4 / active 1 - input channel shortfall");
  await expectGrantedInputAcquisition(page, { sourceChannels: 1, physicalChannels: 1 });
  await expectExactNativePeak(page, 0);
});

test("permission denial keeps the real Wasm runtime live with safe silent input", async ({ page }) => {
  await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
    audioInput: { capture: "denied", physicalChannels: 0, channelValues: [0, 0, 0, 0] },
  });

  await expectAudioStatus(page, "Input requested 4 / active 0 - microphone permission denied");
  await expect(page.locator(synthNode("runtime.audio.input.retry"))).toBeVisible();
  await expectNoInputSourceAcquisition(page);
  await expectExactNativePeak(page, 0);
  await expectRuntimeFunctionsLive(page);
});

test("unreported shortfall keeps deterministic input and non-audio runtime functions live", async ({ page }) => {
  const values = [0.2, -0.125, 0.8, 0.7];
  await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
    audioInput: {
      capture: "deterministic",
      sourceChannels: 4,
      physicalChannels: 2,
      channelValues: values,
      omitTrackChannelCount: true,
    },
  });

  await expectAudioStatus(page, "Input requested 4 / active 2 - microphone channel count unreported, input channel shortfall");
  await expectGrantedInputAcquisition(page, {
    sourceChannels: 4,
    physicalChannels: 2,
    statusCode: AUDIO_INPUT_STATUS.channelCountUnreported,
  });
  await expectNativePeak(page, expectedProbePeakMicrounits(values, 2));
  await expectRuntimeFunctionsLive(page);
});

test("persistent deferred source attach failure releases capture while output, UI, and MIDI stay live", async ({ page }) => {
  await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
    audioInput: {
      capture: "deterministic",
      sourceChannels: 4,
      physicalChannels: 4,
      channelValues: INPUT_VALUES.quadOut0Dominant,
      forceDeferredAttach: true,
      failNativeConnect: true,
    },
  });

  await expectAudioStatus(page, "Input requested 4 / active 0 - microphone capture unavailable");
  await expectExactNativePeak(page, 0);
  await expectRuntimeFunctionsLive(page);
  await expect.poll(async () => {
    const resources = await audioResources(page);
    return {
      getUserMediaCalls: resources.getUserMediaCalls,
      mediaStreamSourceCreations: resources.mediaStreamSourceCreations,
      registrationAttempts: resources.inputSourceRegistrations.length,
      connections: resources.inputSourceConnections,
      sourceDisconnects: resources.inputSourceDisconnects,
      trackStops: resources.inputTrackStops,
    };
  }, { timeout: 5_000 }).toEqual({
    getUserMediaCalls: 1,
    mediaStreamSourceCreations: 1,
    registrationAttempts: 1,
    connections: [],
    sourceDisconnects: 1,
    trackStops: 1,
  });
});

test("successful deferred source attach remains connected and is not spuriously released", async ({ page }) => {
  const values = INPUT_VALUES.quadOut1Dominant;
  await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
    audioInput: {
      capture: "deterministic",
      sourceChannels: 4,
      physicalChannels: 4,
      channelValues: values,
      forceDeferredAttach: true,
    },
  });

  await expectAudioStatus(page, "Input requested 4 / active 4");
  await expectNativePeak(page, expectedProbePeakMicrounits(values, 4));
  await expectRuntimeFunctionsLive(page);
  const resources = await audioResources(page);
  expect(resources.getUserMediaCalls).toBe(1);
  expect(resources.inputSourceRegistrations).toEqual([
    expect.objectContaining({ physicalChannels: 4, statusCode: AUDIO_INPUT_STATUS.online }),
    expect.objectContaining({ physicalChannels: 4, statusCode: AUDIO_INPUT_STATUS.online }),
  ]);
  expect(new Set(resources.inputSourceRegistrations.map((registration: { nativeHandle: number }) => registration.nativeHandle)).size).toBe(1);
  expect(resources.inputSourceConnections).toEqual([{
    destination: "native-worklet",
    outputIndex: 0,
    inputIndex: 0,
    sourceChannels: 4,
    physicalChannels: 4,
  }]);
  expect(resources.inputSourceDisconnects).toBe(0);
  expect(resources.inputTrackStops).toBe(0);
});

test("stream termination clears active input while output, UI, persistence, and MIDI stay live", async ({ page }) => {
  const values = INPUT_VALUES.quadOut0Dominant;
  await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
    audioInput: { capture: "deterministic", sourceChannels: 4, physicalChannels: 4, channelValues: values },
  });
  await expectAudioStatus(page, "Input requested 4 / active 4");
  await expectGrantedInputAcquisition(page, { sourceChannels: 4, physicalChannels: 4 });
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

test("teardown stops a granted audio input track exactly once", async ({ page }) => {
  await installRealFakeApp(page, AUDIO_INPUT_PROBE, {
    audioInput: {
      capture: "deterministic",
      sourceChannels: 2,
      physicalChannels: 2,
      channelValues: INPUT_VALUES.stereoPair,
    },
  });

  await expectAudioStatus(page, "Input requested 4 / active 2 - input channel shortfall");
  await expectGrantedInputAcquisition(page, { sourceChannels: 2, physicalChannels: 2 });
  const teardown = await stopRealFakeApp(page);
  expect(teardown.inputTrackStops).toBe(1);
  expect(teardown.expectedInputTrackStops).toBe(1);
});
