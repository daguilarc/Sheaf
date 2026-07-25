import { expect, test, type Page } from "@playwright/test";
import { installTwisterPair, removeTwisterPair, TWISTER_DEVICE_NAME } from "./helpers/fake-midi.js";

type FrameNode = {
  id: string;
  children: string[];
  pointerDragAction?: { name: string; value: string };
  doubleClickAction?: { name: string; value: string };
};

type FrameObservation = { nodes: FrameNode[] };

const fakeAcceptance = { shell: false, sync: false, gestures: false, narrow: false };

async function builtFakeCatalogApp() {
  const { createHash } = await (new Function("return import('node:crypto')")() as Promise<{
    createHash(name: string): { update(bytes: Uint8Array): { digest(encoding: "hex"): string } };
  }>);
  const { readFile } = await (new Function("return import('node:fs/promises')")() as Promise<{
    readFile(path: URL): Promise<Uint8Array>;
  }>);
  const buildId = "fake-browser-app-build-1";
  const packageRoot = `packages/fake-browser-app/${buildId}`;
  const emissionRoot = "fixture-apps/fake-browser-app";
  const files = await Promise.all([
    ["fake-browser-app.js", "text/javascript"],
    ["fake-browser-app.wasm", "application/wasm"],
  ].map(async ([name, mediaType]) => {
    const bytes = await readFile(new URL(`../dist/wasm/${emissionRoot}/${name}`, import.meta.url));
    return {
      path: `${packageRoot}/${name}`,
      url: `http://127.0.0.1:4174/dist/wasm/${emissionRoot}/${name}`,
      mediaType,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }));
  return {
    globalId: "test/fake-browser-app",
    catalogUrl: "https://test.example/catalog.json",
    publisher: { id: "test", name: "Generic Test Publisher" },
    appId: "fake-browser-app",
    displayName: "Generic Fake App",
    author: "Sheaf Tests",
    category: "Instrument",
    buildId,
    browser: {
      abiVersion: 2,
      uiProtocolVersion: 1,
      runtimeConfigVersion: 1,
      entry: `${packageRoot}/fake-browser-app.js`,
      entryUrl: files[0].url,
      files,
    },
  };
}

test.afterAll(async () => {
  if (!Object.values(fakeAcceptance).every(Boolean)) return;
  const processInfo = (globalThis as any).process as { env: Record<string, string | undefined>; ppid: number };
  const gateFile = processInfo.env.SYNTH_BROWSER_FAKE_GATE ?? `/tmp/sheaf-synth-browser-fake-app-${processInfo.ppid}`;
  const { writeFile } = await (new Function("return import('node:fs/promises')")() as Promise<{
    writeFile(path: string, contents: string): Promise<void>;
  }>);
  await writeFile(gateFile, "passed\n");
});

async function installRealFakeApp(page: Page): Promise<void> {
  const application = await builtFakeCatalogApp();
  await page.route("**/dist/src/main.js*", (route) => {
    if (new URL(route.request().url()).search) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  await page.goto("http://127.0.0.1:4174/public/index.html");
  await page.evaluate(async (application) => {
    const controllerWizardMidi = (window as any).__controllerWizardMidi ??= {
      access: { inputs: new Map(), outputs: new Map(), onstatechange: null },
    };
    const root = document.querySelector<HTMLElement>("#synth-root")!;
    root.dataset.synthAuto = "false";
    root.dataset.synthLauncher = "false";
    const main = await (new Function("return import('/dist/src/main.js?task4-fake')")() as Promise<any>);
    const { decodeCommandBuffer } = await (new Function("return import('/dist/src/protocol.js')")() as Promise<any>);
    const { materializePackage } = await (new Function("return import('/dist/src/package-loader.js')")() as Promise<any>);
    const { ActivationLease } = await (new Function("return import('/dist/src/activation.js')")() as Promise<any>);
    const client = main.createDirectRuntimeClient();
    const observations = {
      commands: [] as Array<Record<string, unknown> & { type: string; name?: string; value?: string }>,
      responses: [] as Array<{ type: string; error?: string }>,
      frames: [] as FrameObservation[],
      terminated: false,
    };
    const resources = {
      contexts: 0,
      resumes: 0,
      closes: 0,
      midiRequests: 0,
      runtimeClients: 0,
      nodeConnects: 0,
      nodeDisconnects: 0,
      materializations: 0,
      packageDisposals: 0,
    };
    const observingClient = {
      ...client,
      async request(command: { type: string; name?: string; value?: string }) {
        observations.commands.push({ ...command });
        const response = await client.request(command);
        observations.responses.push({ type: response.type, error: response.type === "error" ? response.error : undefined });
        if (response.type === "ui-frame") {
          const frame = decodeCommandBuffer(Uint8Array.from(response.frame).buffer);
          observations.frames.push({ nodes: frame.nodes });
        }
        return response;
      },
      onStatus: client.onStatus,
      terminate: async () => {
        observations.terminated = true;
        await client.terminate?.();
      },
    };

    const NativeAudioWorkletNode = globalThis.AudioWorkletNode;
    Object.defineProperty(globalThis, "AudioWorkletNode", {
      configurable: true,
      value: new Proxy(NativeAudioWorkletNode, {
        construct(target, argumentsList, newTarget) {
          const node = Reflect.construct(target, argumentsList, newTarget) as AudioWorkletNode;
          const instrumented = node as any;
          const nativeConnect = instrumented.connect.bind(node);
          const nativeDisconnect = instrumented.disconnect.bind(node);
          instrumented.connect = (...args: unknown[]) => {
            resources.nodeConnects += 1;
            return nativeConnect(...args);
          };
          instrumented.disconnect = (...args: unknown[]) => {
            resources.nodeDisconnects += 1;
            return nativeDisconnect(...args);
          };
          return node;
        },
      }),
    });
    await main.installSheafPatchLauncher(root, {
      client: { loadSources: async () => ({ apps: [application], diagnostics: [], duplicateDiagnostics: [] }) },
      runtimeClientFactory: () => { resources.runtimeClients += 1; return observingClient; },
      activationLeaseFactory: () => {
        if (resources.contexts !== 0) throw new Error("second AudioContext");
        const context = new AudioContext();
        resources.contexts += 1;
        const nativeResume = context.resume.bind(context);
        const nativeClose = context.close.bind(context);
        context.resume = async () => {
          resources.resumes += 1;
          await nativeResume();
        };
        context.close = async () => {
          resources.closes += 1;
          await nativeClose();
        };
        return ActivationLease.acquire({
          audioContextFactory: () => context,
          requestMIDIAccess: async () => {
            resources.midiRequests += 1;
            return controllerWizardMidi.access;
          },
        });
      },
      materializePackage: async (app: unknown) => {
        resources.materializations += 1;
        const packageLease = await materializePackage(app);
        let disposed = false;
        return {
          ...packageLease,
          dispose() {
            if (disposed) return;
            disposed = true;
            resources.packageDisposals += 1;
            packageLease.dispose();
          },
        };
      },
      frameIntervalMs: 60_000,
    });
    (window as any).__task4Fake = { observations, resources };
  }, application);
  await page.getByRole("button", { name: /launch generic fake app/i }).click();
  await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toBeVisible();
}

async function stopRealFakeApp(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const state = (window as any).__task4Fake;
    if (!state) return;
    dispatchEvent(new Event("pagehide"));
    const deadline = performance.now() + 5_000;
    while (performance.now() < deadline &&
           (!state.observations.terminated || state.resources.closes !== 1 ||
            state.resources.nodeDisconnects !== 1 || state.resources.packageDisposals !== 1)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!state.observations.terminated) throw new Error("SynthBrowserApp.stop() did not terminate the runtime client");
    if (state.resources.closes !== 1 || state.resources.nodeDisconnects !== 1 || state.resources.packageDisposals !== 1)
      throw new Error(`runtime resources were not released exactly once: ${JSON.stringify(state.resources)}`);
    delete (window as any).__task4Fake;
  });
}

test.afterEach(async ({ page }) => {
  await stopRealFakeApp(page);
});

async function assertNoContentSidebarOverlap(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('[data-synth-node-id="fake-browser-root"]')!.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.sidebar.root"]')!.getBoundingClientRect();
    const composite = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.main.root"]')!.getBoundingClientRect();
    return {
      contentRight: content.right,
      sidebarLeft: sidebar.left,
      sidebarRight: sidebar.right,
      compositeRight: composite.right,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(geometry.contentRight).toBeLessThanOrEqual(geometry.sidebarLeft + 0.5);
  expect(geometry.sidebarRight).toBeLessThanOrEqual(geometry.compositeRight + 0.5);
  expect(geometry.compositeRight).toBeLessThanOrEqual(geometry.viewportWidth + 0.5);
}

const TWISTER_DISPLAY_NAME = "MIDI Fighter Twister";
const TWISTER_WIZARD_DEFAULTS = [
  "Hold Reset",
  "Hold Random",
  "Hold Random Mod",
  "Next Bank",
  "Start",
  "Previous Bank",
] as const;
const TWISTER_WIZARD_CHOICES = [
  "Toggle Reset",
  "Hold Reset",
  "Toggle Random",
  "Hold Random",
  "Toggle Random Mod",
  "Hold Random Mod",
  "Toggle Gesture Select",
  "Hold Gesture Select",
  "Bank Select",
  "Next Bank",
  "Previous Bank",
  "Start",
  "Continue",
  "Stop",
  "Clock",
  "Scene Select",
] as const;
const TWISTER_SIDE_CCS = [8, 9, 10, 11, 12, 13] as const;

function synthNode(id: string): string {
  return `[data-synth-node-id="${id}"]`;
}

function wizardMessage(page: Page, index: number) {
  return page.locator(synthNode(`runtime.controllers.wizard.message.${index}`));
}

function wizardArgument(page: Page, index: number) {
  return page.locator(synthNode(`runtime.controllers.wizard.argument.${index}`));
}

function controllerRow(page: Page, index: number) {
  return page.locator(synthNode(`runtime.controllers.record.${index}`));
}

async function latestMidiEndpoints(page: Page): Promise<Array<{ identifier: string; name: string; kind: string }>> {
  return page.evaluate(() => {
    const commands = ((window as any).__task4Fake?.observations.commands ?? []) as Array<any>;
    const snapshot = commands.filter((command) => command.type === "midi-endpoints").at(-1);
    return snapshot?.endpoints ?? [];
  });
}

async function waitForTwisterEndpointSnapshot(page: Page, ordinal: number): Promise<void> {
  await expect.poll(() => latestMidiEndpoints(page)).toEqual(expect.arrayContaining([
    { identifier: `twister-in-${ordinal}`, name: TWISTER_DEVICE_NAME, kind: "input" },
    { identifier: `twister-out-${ordinal}`, name: TWISTER_DEVICE_NAME, kind: "output" },
  ]));
}

async function selectedWizardMessageLabels(page: Page): Promise<string[]> {
  return page.locator('[data-synth-node-id^="runtime.controllers.wizard.message."]').evaluateAll((controls) =>
    controls.map((control) => {
      const select = control.querySelector("select");
      return select?.selectedOptions[0]?.textContent?.trim() ?? control.textContent?.trim() ?? "";
    }),
  );
}

async function wizardMessageChoices(page: Page, index: number): Promise<string[]> {
  return wizardMessage(page, index).locator("select option").evaluateAll((options) =>
    options.map((option) => option.textContent?.trim() ?? ""),
  );
}

async function assertTwisterWizardDefaults(page: Page): Promise<void> {
  await expect(page.locator(synthNode("runtime.controllers.wizard.encoder_slot"))).toHaveCount(1);
  await expect(page.locator(`${synthNode("runtime.controllers.wizard.encoder_slot")} input`)).toHaveValue("0");
  await expect(page.locator('[data-synth-node-id^="runtime.controllers.wizard.message."]')).toHaveCount(6);
  await expect(page.locator('[data-synth-node-id^="runtime.controllers.wizard.argument."]')).toHaveCount(6);
  expect(await selectedWizardMessageLabels(page)).toEqual([...TWISTER_WIZARD_DEFAULTS]);
  expect(await wizardMessageChoices(page, 0)).toEqual([...TWISTER_WIZARD_CHOICES]);
  for (let index = 0; index < 6; index += 1)
    await expect(wizardArgument(page, index).locator("input")).toBeDisabled();
}

async function assertTwisterWizardColumnGeometry(page: Page): Promise<void> {
  const boxes = await Promise.all([...Array(6).keys()].map((index) => wizardMessage(page, index).boundingBox()));
  expect(boxes.every(Boolean), JSON.stringify(boxes)).toBe(true);
  const [left0, left1, left2, right0, right1, right2] = boxes as NonNullable<(typeof boxes)[number]>[];
  for (const box of [left1, left2]) expect(Math.abs(box.x - left0.x)).toBeLessThanOrEqual(1);
  for (const box of [right1, right2]) expect(Math.abs(box.x - right0.x)).toBeLessThanOrEqual(1);
  for (const [left, right] of [[left0, right0], [left1, right1], [left2, right2]] as const) {
    expect(right.x).toBeGreaterThan(left.x + left.width);
    expect(Math.abs(right.y - left.y)).toBeLessThanOrEqual(1);
  }
  expect(left1.y).toBeGreaterThan(left0.y);
  expect(left2.y).toBeGreaterThan(left1.y);
}

async function assertActiveTwisterRecord(page: Page, index: number, name: string, ordinal: number, slot: string): Promise<void> {
  const row = controllerRow(page, index);
  await expect(row).toContainText(name);
  await expect(row.locator(synthNode(`runtime.controllers.record.${index}.disposition`))).toHaveText("Active");
  await expect(row.locator(synthNode(`runtime.controllers.record.${index}.wizard_id`))).toHaveText(/\S+/);
  await expect(row.locator(synthNode(`runtime.controllers.record.${index}.input`))).toContainText(`twister-in-${ordinal}`);
  await expect(row.locator(synthNode(`runtime.controllers.record.${index}.input`))).toContainText(TWISTER_DEVICE_NAME);
  await expect(row.locator(synthNode(`runtime.controllers.record.${index}.output`))).toContainText(`twister-out-${ordinal}`);
  await expect(row.locator(synthNode(`runtime.controllers.record.${index}.output`))).toContainText(TWISTER_DEVICE_NAME);

  for (const section of ["turn", "push", "output"] as const) {
    const mappings = row.locator(`[data-synth-node-id^="runtime.controllers.record.${index}.mapping.encoder.${section}."]`);
    await expect(mappings).toHaveCount(16);
    for (let encoder = 0; encoder < 16; encoder += 1)
      await expect(row.locator(synthNode(`runtime.controllers.record.${index}.mapping.encoder.${section}.${encoder}`))).toContainText(`slot ${slot}`);
  }

  const sideMappings = row.locator(`[data-synth-node-id^="runtime.controllers.record.${index}.mapping.side."]`);
  await expect(sideMappings).toHaveCount(6);
  for (let side = 0; side < 6; side += 1) {
    const mapping = row.locator(synthNode(`runtime.controllers.record.${index}.mapping.side.${side}`));
    await expect(mapping).toContainText(`CC ${TWISTER_SIDE_CCS[side]}`);
    await expect(mapping).toContainText(TWISTER_WIZARD_DEFAULTS[side]);
  }
}

async function expectControllersWarning(page: Page, visible: boolean): Promise<void> {
  const warning = page.locator(synthNode("runtime.sidebar.controllers.warning"));
  if (visible) await expect(warning).toBeVisible();
  else await expect(warning).toHaveCount(0);
}

async function stopAndRelaunchRealFakeApp(page: Page): Promise<void> {
  await stopRealFakeApp(page);
  await installRealFakeApp(page);
}

test("controller wizard unique candidate configures a default Twister profile in exactly three clicks", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await waitForTwisterEndpointSnapshot(page, 1);

  await page.locator('[data-synth-node-id="runtime.sidebar.controllers"]').click();
  await page.locator('[data-synth-node-id="runtime.controllers.wizard.open"]').click();
  await assertTwisterWizardDefaults(page);
  await assertTwisterWizardColumnGeometry(page);
  await page.locator('[data-synth-node-id="runtime.controllers.wizard.submit"]').click();

  await assertActiveTwisterRecord(page, 0, TWISTER_DISPLAY_NAME, 1, "0");
  await expectControllersWarning(page, false);
  await stopAndRelaunchRealFakeApp(page);
  await installTwisterPair(page, 1);
  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await assertActiveTwisterRecord(page, 0, TWISTER_DISPLAY_NAME, 1, "0");
});

test("controller wizard disables configuration when no candidate exists", async ({ page }) => {
  await installRealFakeApp(page);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await expect(page.locator(synthNode("runtime.controllers.wizard.open"))).toBeDisabled();
  await expect(page.locator(synthNode("runtime.controllers.available.empty"))).toContainText(
    "No recognized unconfigured controller pair is present",
  );
});

test("controller wizard presents a chooser for duplicate available Twisters", async ({ page }) => {
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await installTwisterPair(page, 2);
  await waitForTwisterEndpointSnapshot(page, 1);
  await waitForTwisterEndpointSnapshot(page, 2);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await page.locator(synthNode("runtime.controllers.wizard.open")).click();
  const choices = page.locator('[data-synth-node-id^="runtime.controllers.wizard.candidate."]');
  await expect(choices).toHaveCount(2);
  await expect(page.locator(synthNode("runtime.controllers.wizard.candidate.0"))).toContainText(TWISTER_DISPLAY_NAME);
  await expect(page.locator(synthNode("runtime.controllers.wizard.candidate.0"))).toContainText("twister-in-1");
  await expect(page.locator(synthNode("runtime.controllers.wizard.candidate.0"))).toContainText("twister-out-1");
  await expect(page.locator(synthNode("runtime.controllers.wizard.candidate.1"))).toContainText(TWISTER_DISPLAY_NAME);
  await expect(page.locator(synthNode("runtime.controllers.wizard.candidate.1"))).toContainText("twister-in-2");
  await expect(page.locator(synthNode("runtime.controllers.wizard.candidate.1"))).toContainText("twister-out-2");
  await page.locator(synthNode("runtime.controllers.wizard.candidate.1.configure")).click();
  await assertTwisterWizardDefaults(page);
});

test("controller wizard uses deterministic names for duplicate submitted Twisters", async ({ page }) => {
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await installTwisterPair(page, 2);
  await waitForTwisterEndpointSnapshot(page, 1);
  await waitForTwisterEndpointSnapshot(page, 2);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await page.locator(synthNode("runtime.controllers.wizard.open")).click();
  await page.locator(synthNode("runtime.controllers.wizard.candidate.1.configure")).click();
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await assertActiveTwisterRecord(page, 0, TWISTER_DISPLAY_NAME, 2, "0");
  await page.locator(synthNode("runtime.controllers.wizard.open")).click();
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await assertActiveTwisterRecord(page, 1, `${TWISTER_DISPLAY_NAME} 2`, 1, "0");
});

test("controller wizard ignores an available row and restores warning after blacklist removal", async ({ page }) => {
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await waitForTwisterEndpointSnapshot(page, 1);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await page.locator(synthNode("runtime.controllers.available.0.ignore")).click();
  await expect(controllerRow(page, 0)).toContainText("Blacklisted");
  await expect(controllerRow(page, 0)).toContainText("twister-in-1");
  await expect(controllerRow(page, 0).locator('[data-synth-node-id*=".mapping."]')).toHaveCount(0);
  await expectControllersWarning(page, false);
  await page.locator(synthNode("runtime.controllers.record.0.remove_blacklist")).click();
  await expect(controllerRow(page, 0)).toHaveCount(0);
  await expect(page.locator(synthNode("runtime.controllers.available.0"))).toContainText(TWISTER_DISPLAY_NAME);
  await expectControllersWarning(page, true);
});

test("controller wizard ignores from a new-candidate form", async ({ page }) => {
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await waitForTwisterEndpointSnapshot(page, 1);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await page.locator(synthNode("runtime.controllers.wizard.open")).click();
  await page.locator(synthNode("runtime.controllers.wizard.ignore")).click();
  await expect(controllerRow(page, 0)).toContainText("Blacklisted");
  await expect(controllerRow(page, 0)).toContainText("twister-in-1");
  await expectControllersWarning(page, false);
});

test("controller wizard stale and invalid submit preserve entered values", async ({ page }) => {
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await waitForTwisterEndpointSnapshot(page, 1);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await page.locator(synthNode("runtime.controllers.wizard.open")).click();
  await page.locator(`${synthNode("runtime.controllers.wizard.encoder_slot")} input`).fill("4");
  await wizardMessage(page, 0).locator("select").selectOption({ label: "Bank Select" });
  await wizardArgument(page, 0).locator("input").fill("7");
  await wizardMessage(page, 1).locator("select").selectOption({ label: "Scene Select" });
  await wizardArgument(page, 1).locator("input").fill("999999999999999999999999999999999999999");
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await expect(page.locator(synthNode("runtime.controllers.wizard.status"))).toContainText("button 1");
  await expect(page.locator(`${synthNode("runtime.controllers.wizard.encoder_slot")} input`)).toHaveValue("4");
  await expect(wizardArgument(page, 0).locator("input")).toHaveValue("7");
  await expect(wizardArgument(page, 1).locator("input")).toHaveValue("999999999999999999999999999999999999999");
  await removeTwisterPair(page, 1);
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await expect(page.locator(synthNode("runtime.controllers.wizard.status"))).toContainText("reconnect");
  await expect(controllerRow(page, 0)).toHaveCount(0);
});

test("controller wizard supports rename and delete on active records", async ({ page }) => {
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await waitForTwisterEndpointSnapshot(page, 1);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await page.locator(synthNode("runtime.controllers.wizard.open")).click();
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await page.locator(synthNode("runtime.controllers.record.0.rename")).click();
  await page.locator(`${synthNode("runtime.controllers.rename.name")} input`).fill("Studio Twister");
  await page.locator(synthNode("runtime.controllers.rename.submit")).click();
  await expect(controllerRow(page, 0)).toContainText("Studio Twister");
  await page.locator(synthNode("runtime.controllers.record.0.delete")).click();
  await page.locator(synthNode("runtime.controllers.delete.confirm")).click();
  await expect(controllerRow(page, 0)).toHaveCount(0);
  await expectControllersWarning(page, true);
});

test("controller wizard retains dormant profile when an active record is blacklisted", async ({ page }) => {
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await waitForTwisterEndpointSnapshot(page, 1);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await page.locator(synthNode("runtime.controllers.wizard.open")).click();
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await page.locator(synthNode("runtime.controllers.record.0.blacklist")).click();
  await expect(controllerRow(page, 0)).toContainText("Blacklisted");
  await expect(controllerRow(page, 0).locator('[data-synth-node-id*=".mapping."]')).toHaveCount(0);
  await expect(controllerRow(page, 0)).toContainText("dormant profile retained");
});

test("controller wizard configures a blacklisted record through its wizard", async ({ page }) => {
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await waitForTwisterEndpointSnapshot(page, 1);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await page.locator(synthNode("runtime.controllers.available.0.ignore")).click();
  await expect(controllerRow(page, 0)).toContainText("Blacklisted");
  await page.locator(synthNode("runtime.controllers.record.0.configure")).click();
  await assertTwisterWizardDefaults(page);
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await assertActiveTwisterRecord(page, 0, TWISTER_DISPLAY_NAME, 1, "0");
});

test("controller wizard reconfigure seeds exact-shape profiles", async ({ page }) => {
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await waitForTwisterEndpointSnapshot(page, 1);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await page.locator(synthNode("runtime.controllers.wizard.open")).click();
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await page.locator(synthNode("runtime.controllers.record.0.reconfigure")).click();
  await expect(page.locator(`${synthNode("runtime.controllers.wizard.encoder_slot")} input`)).toHaveValue("0");
  await expect(page.locator(synthNode("runtime.controllers.wizard.ignore"))).toHaveCount(0);
  await page.locator(`${synthNode("runtime.controllers.wizard.encoder_slot")} input`).fill("4");
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await assertActiveTwisterRecord(page, 0, TWISTER_DISPLAY_NAME, 1, "4");
});

test("controller wizard reconfigure warns and replaces incompatible profiles", async ({ page }) => {
  await installRealFakeApp(page);
  await installTwisterPair(page, 1);
  await waitForTwisterEndpointSnapshot(page, 1);

  await page.locator(synthNode("runtime.sidebar.controllers")).click();
  await page.locator(synthNode("runtime.controllers.wizard.open")).click();
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await page.locator(synthNode("runtime.controllers.record.0.mapping.add_extra")).click();
  await page.locator(synthNode("runtime.controllers.record.0.reconfigure")).click();
  await expect(page.locator(synthNode("runtime.controllers.wizard.warning"))).toContainText("replaces the whole profile");
  await expect(page.locator(`${synthNode("runtime.controllers.wizard.encoder_slot")} input`)).toHaveValue("0");
  await page.locator(synthNode("runtime.controllers.wizard.submit")).click();
  await assertActiveTwisterRecord(page, 0, TWISTER_DISPLAY_NAME, 1, "0");
  await expect(controllerRow(page, 0).locator(synthNode("runtime.controllers.record.0.mapping.extra"))).toHaveCount(0);
});

test("real fake-app WASM renders and refreshes the shared runtime shell", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await installRealFakeApp(page);

  await expect(page.locator('[data-synth-node-id="runtime.main.root"]')).toHaveCount(1);
  await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="runtime.sidebar.root"]')).toBeVisible();
  await assertNoContentSidebarOverlap(page);

  for (const pageName of ["audio", "controllers", "sync", "file"] as const) {
    await page.locator(`[data-synth-node-id="runtime.sidebar.${pageName}"]`).click();
    await expect(page.locator(`[data-synth-node-id="runtime.${pageName}.root"]`)).toBeVisible();
    await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toHaveCount(0);
    await page.locator(`[data-synth-node-id="runtime.${pageName}.back"]`).click();
    await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toBeVisible();
  }

  const frameShape = await page.evaluate(() => {
    const frames = (window as any).__task4Fake.observations.frames as FrameObservation[];
    const initial = frames[0];
    const childIds = new Set(initial.nodes.flatMap((node) => node.children));
    return {
      roots: initial.nodes.filter((node) => !childIds.has(node.id)).map((node) => node.id),
      frameCount: frames.length,
    };
  });
  expect(frameShape.roots).toEqual(["runtime.main.root"]);
  expect(frameShape.frameCount).toBeGreaterThanOrEqual(7);
  const resources = await page.evaluate(() => (window as any).__task4Fake.resources);
  expect(resources).toMatchObject({
    contexts: 1,
    closes: 0,
    midiRequests: 1,
    runtimeClients: 1,
    nodeConnects: 1,
    nodeDisconnects: 0,
    materializations: 1,
    packageDisposals: 0,
  });
  expect(resources.resumes).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() =>
    (window as any).__task4Fake.observations.commands.filter((command: { type: string }) => command.type === "load").length,
  )).toBe(1);
  fakeAcceptance.shell = true;
});

test("real fake-app WASM stages, validates, saves, and reopens Sync", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRealFakeApp(page);
  await page.locator('[data-synth-node-id="runtime.sidebar.sync"]').click();
  await expect(page.locator('[data-synth-node-id="runtime.sync.root"]')).toBeVisible();

  const sendClock = page.locator('[data-synth-node-id="runtime.sync.send_clock"] input');
  const receiveClock = page.locator('[data-synth-node-id="runtime.sync.receive_clock"] input');
  const sendTransport = page.locator('[data-synth-node-id="runtime.sync.send_transport"] input');
  const receiveTransport = page.locator('[data-synth-node-id="runtime.sync.receive_transport"] input');
  const ppqn = page.locator('[data-synth-node-id="runtime.sync.ppqn"] input');
  await expect(sendClock).not.toBeChecked();
  await expect(ppqn).toHaveValue("24");
  await sendClock.check();
  await receiveClock.check();
  await sendTransport.check();
  await receiveTransport.check();

  await ppqn.fill("96x");
  await expect(page.locator('[data-synth-node-id="runtime.sync.validation"]')).toContainText("1 to 960");
  await ppqn.fill("96");
  await expect(page.locator('[data-synth-node-id="runtime.sync.validation"]')).toHaveText("");
  await expect(page.locator('[data-synth-node-id="runtime.sync.warning"]')).toContainText("nonstandard");
  await expect(page.locator('[data-synth-node-id="runtime.sync.bpm"]')).toContainText("Current BPM: 120.00");
  await expect(page.locator('[data-synth-node-id="runtime.sync.lock"]')).toContainText("Internal");
  await expect(page.locator('[data-synth-node-id="runtime.sync.source"]')).toContainText("no external source");

  const containment = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.sync.root"]')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('[data-synth-node-id^="runtime.sync."]')]
      .every((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.left >= root.left - 0.5 && bounds.top >= root.top - 0.5 &&
          bounds.right <= root.right + 0.5 && bounds.bottom <= root.bottom + 0.5;
      });
  });
  expect(containment).toBe(true);

  await page.locator('[data-synth-node-id="runtime.sync.back"]').click();
  await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toBeVisible();
  await page.locator('[data-synth-node-id="runtime.sidebar.sync"]').click();
  await expect(page.locator('[data-synth-node-id="runtime.sync.ppqn"] input')).toHaveValue("96");
  await expect(page.locator('[data-synth-node-id="runtime.sync.send_clock"] input')).toBeChecked();
  await expect(page.locator('[data-synth-node-id="runtime.sync.receive_clock"] input')).toBeChecked();
  await expect(page.locator('[data-synth-node-id="runtime.sync.send_transport"] input')).toBeChecked();
  await expect(page.locator('[data-synth-node-id="runtime.sync.receive_transport"] input')).toBeChecked();

  const actions = await page.evaluate(() =>
    (window as any).__task4Fake.observations.commands
      .filter((command: { type: string }) => command.type === "dispatch-action")
      .map((command: { name?: string; value?: string }) => [command.name, command.value]),
  );
  expect(actions).toEqual(expect.arrayContaining([
    ["runtime.sync.send_clock", "1"],
    ["runtime.sync.receive_clock", "1"],
    ["runtime.sync.send_transport", "1"],
    ["runtime.sync.receive_transport", "1"],
    ["runtime.sync.ppqn", "96"],
    ["runtime.sync.back", ""],
  ]));
  fakeAcceptance.sync = true;
});

test("real fake-app WASM dispatches incremental drag and double-click actions", async ({ page }) => {
  await installRealFakeApp(page);
  const gesture = await page.evaluate(() => {
    const frame = ((window as any).__task4Fake.observations.frames as FrameObservation[])[0];
    const drag = frame.nodes.find((node) => node.pointerDragAction);
    const doubleClick = frame.nodes.find((node) => node.doubleClickAction);
    return {
      dragId: drag?.id,
      dragAction: drag?.pointerDragAction?.name,
      doubleClickId: doubleClick?.id,
      doubleClickAction: doubleClick?.doubleClickAction?.name,
    };
  });
  expect(gesture.dragId).toBeTruthy();
  expect(gesture.doubleClickId).toBeTruthy();

  const dragTarget = page.locator(`[data-synth-node-id="${gesture.dragId}"]`);
  const box = await dragTarget.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 20, box!.y + 20);
  await page.mouse.down();
  await page.mouse.move(box!.x + 27, box!.y + 18, { steps: 2 });
  await page.mouse.move(box!.x + 35, box!.y + 14, { steps: 2 });
  await page.mouse.up();
  await page.locator(`[data-synth-node-id="${gesture.doubleClickId}"] canvas`).dispatchEvent("dblclick");

  await expect.poll(() => page.evaluate(() =>
    (window as any).__task4Fake.observations.commands.filter((command: { type: string }) => command.type === "dispatch-action").length,
  )).toBeGreaterThanOrEqual(3);
  const actions = await page.evaluate(() =>
    (window as any).__task4Fake.observations.commands.filter((command: { type: string }) => command.type === "dispatch-action"),
  );
  expect(actions.length, JSON.stringify(actions)).toBeGreaterThanOrEqual(3);
  expect(actions.filter((action: { name?: string }) => action.name === gesture.dragAction).length).toBeGreaterThanOrEqual(2);
  expect(actions.some((action: { name?: string }) => action.name === gesture.doubleClickAction)).toBe(true);
  fakeAcceptance.gestures = true;
});

test("real fake-app shared shell remains non-overlapping at narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRealFakeApp(page);
  await expect(page.locator('[data-synth-node-id="runtime.main.root"]')).toBeVisible();
  await assertNoContentSidebarOverlap(page);
  fakeAcceptance.narrow = true;
});
