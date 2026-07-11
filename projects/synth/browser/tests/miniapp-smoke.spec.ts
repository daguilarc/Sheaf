import { expect, test, type Page } from "@playwright/test";

type FrameNode = {
  id: string;
  children: string[];
  drawCount?: number;
  pointerDragAction?: { name: string; value: string };
  doubleClickAction?: { name: string; value: string };
};

type FrameObservation = { nodes: FrameNode[] };

test.beforeAll(async () => {
  const processInfo = (globalThis as any).process as { env: Record<string, string | undefined>; ppid: number };
  if (processInfo.env.SYNTH_BROWSER_FAKE_GATE_CONFIRMED === "1") return;
  const gateFile = processInfo.env.SYNTH_BROWSER_FAKE_GATE ?? `/tmp/sheaf-synth-browser-fake-app-${processInfo.ppid}`;
  const { stat } = await (new Function("return import('node:fs/promises')")() as Promise<{ stat(path: string): Promise<unknown> }>);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      await stat(gateFile);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("generic fake-app acceptance did not succeed before miniapp smoke");
});

async function installRealMiniapp(page: Page, options: { fakeMidi?: boolean; frameIntervalMs?: number } = {}): Promise<void> {
  await page.route("**/dist/src/main.js*", (route) => {
    if (new URL(route.request().url()).search) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  await page.goto("http://127.0.0.1:4174/public/index.html");
  await page.evaluate(async ({ fakeMidi, frameIntervalMs }) => {
    document.querySelector<HTMLElement>("#synth-root")!.dataset.synthAuto = "false";
    const main = await (new Function("return import('/dist/src/main.js?task5-miniapp')")() as Promise<any>);
    const { decodeCommandBuffer } = await (new Function("return import('/dist/src/protocol.js')")() as Promise<any>);
    if (fakeMidi) {
      class InputPort {
        readonly type = "input";
        state = "connected";
        onmidimessage: ((event: { data: Uint8Array; timeStamp: number }) => void) | null = null;
        constructor(readonly id: string, readonly name: string) {}
        emit(bytes: number[]) { this.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp: 17 }); }
      }
      class OutputPort {
        readonly type = "output";
        state = "connected";
        readonly sent: number[][] = [];
        constructor(readonly id: string, readonly name: string) {}
        send(bytes: number[] | Uint8Array) { this.sent.push(Array.from(bytes)); }
      }
      const input = new InputPort("in-a", "Input A");
      const output = new OutputPort("out-a", "Output A");
      const access = { inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]), onstatechange: null };
      Object.defineProperty(navigator, "requestMIDIAccess", {
        configurable: true,
        value: async (request: unknown) => {
          (window as any).__task5MidiRequest = request;
          return access;
        },
      });
      (window as any).__task5MidiPorts = { input, output };
    }
    const client = main.createWorkerRuntimeClient();
    const observations = {
      commands: [] as Array<{ type: string; name?: string; value?: string }>,
      statuses: [] as Array<{ type: string; status?: string }>,
      frames: [] as FrameObservation[],
      terminated: false,
    };
    const runtimeClient = {
      async request(command: { type: string; name?: string; value?: string }) {
        observations.commands.push({ ...command });
        const response = await client.request(command);
        if (response.type === "ui-frame") {
          observations.frames.push({ nodes: decodeCommandBuffer(Uint8Array.from(response.frame).buffer).nodes });
        }
        return response;
      },
      onStatus: (handler: (response: unknown) => void) => client.onStatus?.((response: { type: string; status?: string }) => {
        observations.statuses.push(response);
        handler(response);
      }),
      terminate: () => {
        observations.terminated = true;
        client.terminate?.();
      },
    };
    class TestAudioContext {
      readonly sampleRate = 48_000;
      readonly destination = {};
      readonly audioWorklet = { addModule: async () => {} };
      async resume() {}
      async close() {}
    }
    class TestAudioWorkletNode {
      readonly port = { postMessage() {} };
      connect() {}
      disconnect() {}
    }
    const app = await main.installSynthBrowserApp(document.querySelector("#synth-root")!, {
      moduleUrl: new URL("/dist/wasm/miniapp.js", location.href).href,
      frameIntervalMs: frameIntervalMs ?? 60_000,
      runtimeClient,
      audioOptions: {
        audioContextFactory: () => new TestAudioContext(),
        audioWorkletNodeFactory: () => new TestAudioWorkletNode(),
      },
    });
    if (observations.frames.length === 0) throw new Error("miniapp did not produce an initial UI frame");
    (window as any).__task5Miniapp = { app, observations };
  }, options);
}

async function stopRealMiniapp(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as any).__task5Miniapp;
    if (!state) return;
    state.app.stop();
    if (!state.observations.terminated) throw new Error("SynthBrowserApp.stop() did not terminate the runtime client");
    delete (window as any).__task5Miniapp;
  });
}

test.afterEach(async ({ page }) => {
  await stopRealMiniapp(page);
});

async function settleVisuals(page: Page): Promise<void> {
  await page.addStyleTag({ content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }" });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForTimeout(100);
}

test("miniapp smoke wiring keeps the generic fake-app gate first", async () => {
  const { readFile } = await (new Function("return import('node:fs/promises')")() as Promise<{
    readFile(path: URL, encoding: "utf8"): Promise<string>;
  }>);
  const browserMakefile = await readFile(new URL("../Makefile", import.meta.url), "utf8");
  const entry = await readFile(new URL("../cpp/miniapp_entry.cpp", import.meta.url), "utf8");
  expect(browserMakefile).toMatch(/browser-miniapp-smoke:\s+browser-fake-app-test/);
  expect(entry).toBe('#include "MiniApp.hpp"\n#include "synth/browser/BrowserAppEntry.hpp"\n\nSYNTH_BROWSER_APP(synth_miniapp::MiniApp)\n');
});

test("real miniapp WASM renders the complete shared shell and portable pages", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await installRealMiniapp(page);
  await expect(page.locator('[data-synth-node-id="runtime.main.root"]')).toHaveCount(1);
  await expect(page.locator('[data-synth-node-id="miniapp.root"]')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="runtime.sidebar.root"]')).toBeVisible();
  await expect(page.locator('[data-synth-node-id^="miniapp.encoder."] canvas')).toHaveCount(7);
  await expect(page.locator('[data-synth-node-id="miniapp.vco.scope"] canvas')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="miniapp.lfo.scope"] canvas')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="miniapp.bank.vco"]')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="miniapp.scene.blend"]')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('[data-synth-node-id="miniapp.root"]')!.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.sidebar.root"]')!.getBoundingClientRect();
    const composite = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.main.root"]')!.getBoundingClientRect();
    const appCanvases = [...document.querySelectorAll<HTMLCanvasElement>('[data-synth-node-id^="miniapp."] canvas')].map((canvas) => canvas.getBoundingClientRect());
    return { appRight: app.right, sidebarLeft: sidebar.left, sidebarRight: sidebar.right, compositeRight: composite.right,
      rightmostCanvas: Math.max(...appCanvases.map((bounds) => bounds.right)) };
  });
  expect(geometry.appRight).toBeLessThanOrEqual(geometry.sidebarLeft + 0.5);
  expect(geometry.rightmostCanvas).toBeLessThanOrEqual(geometry.appRight + 0.5);
  expect(geometry.sidebarRight).toBeLessThanOrEqual(geometry.compositeRight + 0.5);

  for (const pageName of ["audio", "controllers", "file"] as const) {
    await page.locator(`[data-synth-node-id="runtime.sidebar.${pageName}"]`).click();
    await expect(page.locator(`[data-synth-node-id="runtime.${pageName}.root"]`)).toBeVisible();
    await page.locator(`[data-synth-node-id="runtime.${pageName}.back"]`).click();
    await expect(page.locator('[data-synth-node-id="miniapp.root"]')).toBeVisible();
  }

  const rootIds = await page.evaluate(() => {
    const frame = ((window as any).__task5Miniapp.observations.frames as FrameObservation[])[0];
    const children = new Set(frame.nodes.flatMap((node) => node.children));
    return frame.nodes.filter((node) => !children.has(node.id)).map((node) => node.id);
  });
  expect(rootIds).toEqual(["runtime.main.root"]);

  await settleVisuals(page);
  await page.screenshot({ path: new URL("./screenshots/runtime-shell-desktop.png", import.meta.url).pathname });
});

test("real miniapp WASM preserves gestures across fresh frames", async ({ page }) => {
  await installRealMiniapp(page);
  const gesture = await page.evaluate(() => {
    const frame = ((window as any).__task5Miniapp.observations.frames as FrameObservation[])[0];
    const drag = frame.nodes.find((node) => node.pointerDragAction && !node.id.startsWith("runtime."));
    const doubleClick = frame.nodes.find((node) => node.doubleClickAction && !node.id.startsWith("runtime."));
    return { dragId: drag?.id, dragAction: drag?.pointerDragAction?.name,
      doubleClickId: doubleClick?.id, doubleClickAction: doubleClick?.doubleClickAction?.name };
  });
  expect(gesture.dragId).toBeTruthy();
  expect(gesture.doubleClickId).toBeTruthy();
  const target = page.locator(`[data-synth-node-id="${gesture.dragId}"]`);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 30, box!.y + 30);
  await page.mouse.down();
  await page.mouse.move(box!.x + 38, box!.y + 27, { steps: 2 });
  await page.mouse.move(box!.x + 48, box!.y + 22, { steps: 2 });
  await page.mouse.up();
  await page.locator(`[data-synth-node-id="${gesture.doubleClickId}"] canvas`).dispatchEvent("dblclick");
  await expect.poll(() => page.evaluate(() =>
    (window as any).__task5Miniapp.observations.commands.filter((command: { type: string }) => command.type === "dispatch-action").length,
  )).toBeGreaterThanOrEqual(3);
  const actions = await page.evaluate(() =>
    (window as any).__task5Miniapp.observations.commands.filter((command: { type: string }) => command.type === "dispatch-action"),
  );
  expect(actions.filter((action: { name?: string }) => action.name === gesture.dragAction).length).toBeGreaterThanOrEqual(2);
  expect(actions.some((action: { name?: string }) => action.name === gesture.doubleClickAction)).toBe(true);
});

test("real miniapp controller page selects Web MIDI endpoints through visible controls", async ({ page }) => {
  await installRealMiniapp(page, { fakeMidi: true, frameIntervalMs: 25 });
  await page.locator('[data-synth-node-id="runtime.sidebar.controllers"]').click();
  await expect(page.locator('[data-synth-node-id="runtime.controllers.root"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__task5MidiRequest)).toEqual({ sysex: true });
  await expect.poll(() => page.evaluate(() =>
    (window as any).__task5Miniapp.observations.commands
      .filter((command: { type: string }) => command.type === "midi-endpoints")
      .flatMap((command: { endpoints?: Array<{ identifier: string }> }) => command.endpoints?.map((endpoint) => endpoint.identifier) ?? []),
  )).toEqual(expect.arrayContaining(["in-a", "out-a"]));
  await page.locator('[data-synth-node-id="runtime.controllers.add_name"] input').fill("webctl");
  await page.locator('[data-synth-node-id="runtime.controllers.add_kind"] select').selectOption("generic");
  await expect.poll(() => page.evaluate(() =>
    (window as any).__task5Miniapp.observations.commands
      .filter((command: { type: string }) => command.type === "dispatch-action")
      .map((command: { name?: string; value?: string }) => [command.name, command.value]),
  )).toEqual(expect.arrayContaining([
    ["runtime.controllers.add_name_draft", "webctl"],
    ["runtime.controllers.add_kind_draft", "generic"],
  ]));
  await page.locator('[data-synth-node-id="runtime.controllers.add_button"]').click();
  await expect(page.locator('[data-synth-node-id="runtime.controllers.row.0.input"] select')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="runtime.controllers.row.0.input"] select')).toContainText("Input A");
  await expect(page.locator('[data-synth-node-id="runtime.controllers.row.0.output"] select')).toContainText("Output A");

  await page.locator('[data-synth-node-id="runtime.controllers.row.0.input"] select').selectOption("in-a");
  await page.locator('[data-synth-node-id="runtime.controllers.row.0.output"] select').selectOption("out-a");
  await expect.poll(() => page.locator('[data-synth-node-id="runtime.controllers.status"]').textContent())
    .toMatch(/Selected (Input|Output) A/);

  await page.locator('[data-synth-node-id="runtime.controllers.add_name"] input').fill("webpad");
  await page.locator('[data-synth-node-id="runtime.controllers.add_kind"] select').selectOption("launchpad");
  await expect.poll(() => page.evaluate(() =>
    (window as any).__task5Miniapp.observations.commands
      .filter((command: { type: string }) => command.type === "dispatch-action")
      .map((command: { name?: string; value?: string }) => [command.name, command.value]),
  )).toEqual(expect.arrayContaining([
    ["runtime.controllers.add_name_draft", "webpad"],
    ["runtime.controllers.add_kind_draft", "launchpad"],
  ]));
  await page.locator('[data-synth-node-id="runtime.controllers.add_button"]').click();
  const variantSelect = page.locator('[data-synth-node-id^="runtime.controllers.row."][data-synth-node-id$=".variant"] select').last();
  await expect(variantSelect).toBeVisible();
  const variantNodeId = await variantSelect.locator("xpath=..").getAttribute("data-synth-node-id");
  const variantControllerIx = variantNodeId?.match(/runtime\.controllers\.row\.(\d+)\.variant/)?.[1];
  expect(variantControllerIx).toBeTruthy();
  await variantSelect.selectOption("1");

  await expect.poll(() => page.evaluate(() =>
    (window as any).__task5Miniapp.observations.commands
      .filter((command: { type: string }) => command.type === "dispatch-action")
      .map((command: { name?: string; value?: string }) => [command.name, command.value]),
  )).toEqual(expect.arrayContaining([
    ["runtime.controllers.add_name_draft", "webctl"],
    ["runtime.controllers.add_kind_draft", "generic"],
    ["runtime.controllers.add_controller", ""],
    ["runtime.controllers.endpoint_select", "0:input:in-a"],
    ["runtime.controllers.endpoint_select", "0:output:out-a"],
    ["runtime.controllers.add_name_draft", "webpad"],
    ["runtime.controllers.add_kind_draft", "launchpad"],
    ["runtime.controllers.variant_select", `${variantControllerIx}:1`],
  ]));

  await expect.poll(() => page.locator('[data-synth-node-id="runtime.controllers.status"]').textContent())
    .toMatch(/Selected Launchpad/);
});

test("real miniapp patch saves survive browser runtime restart through IDBFS", async ({ page }) => {
  const patchName = `codex-persist-${Date.now()}`;
  await installRealMiniapp(page, { frameIntervalMs: 25 });
  await page.locator('[data-synth-node-id="runtime.sidebar.file"]').click();
  await page.locator('[data-synth-node-id="runtime.file.save_as"]').click();
  await page.locator('[data-synth-node-id="runtime.file.browser.save_name"] input').fill(patchName);
  await page.locator('[data-synth-node-id="runtime.file.browser.confirm"]').click();
  await expect.poll(() => page.locator('[data-synth-node-id="runtime.file.patch_name"]').textContent())
    .toBe(patchName);
  await expect.poll(() => page.evaluate(() =>
    (window as any).__task5Miniapp.observations.statuses
      .filter((status: { type: string; status?: string }) => status.type === "page-status" && status.status === "persistence succeeded").length,
  )).toBeGreaterThanOrEqual(2);

  await stopRealMiniapp(page);
  await installRealMiniapp(page, { frameIntervalMs: 25 });
  await page.locator('[data-synth-node-id="runtime.sidebar.file"]').click();
  await page.locator('[data-synth-node-id="runtime.file.load"]').click();
  await expect(page.locator('[data-synth-node-id^="runtime.file.browser.entry."]').filter({ hasText: patchName }).first()).toBeVisible();
});

test("real miniapp shared shell scales as one non-overlapping narrow surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRealMiniapp(page);
  await page.locator('[data-synth-node-id="runtime.sidebar.audio"]').click();
  await expect(page.locator('[data-synth-node-id="runtime.audio.root"]')).toBeVisible();
  await page.waitForTimeout(100);
  await page.locator('[data-synth-node-id="runtime.audio.back"]').click();
  await expect(page.locator('[data-synth-node-id="miniapp.root"]')).toBeVisible();
  const encoderRendering = await page.evaluate(() => {
    const frame = ((window as any).__task5Miniapp.observations.frames as FrameObservation[]).at(-1)!;
    const drawCounts = frame.nodes.filter((node) => node.id.startsWith("miniapp.encoder.")).map((node) => node.drawCount ?? 0);
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('[data-synth-node-id^="miniapp.encoder."] canvas')];
    return {
      drawCounts,
      canvases: canvases.map((canvas) => {
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set<string>();
        for (let offset = 0; offset < pixels.length; offset += 4) {
          colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]},${pixels[offset + 3]}`);
        }
        const rect = canvas.getBoundingClientRect();
        return { backingWidth: canvas.width, backingHeight: canvas.height, cssWidth: rect.width, cssHeight: rect.height, colors: colors.size };
      }),
    };
  });
  expect(encoderRendering.drawCounts).toHaveLength(7);
  expect(encoderRendering.drawCounts.every((count) => count > 0), JSON.stringify(encoderRendering)).toBe(true);
  expect(encoderRendering.canvases).toHaveLength(7);
  expect(encoderRendering.canvases.every((canvas) => canvas.cssWidth > 0 && canvas.cssHeight > 0 && canvas.colors > 3), JSON.stringify(encoderRendering)).toBe(true);
  const geometry = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('[data-synth-node-id="miniapp.root"]')!.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.sidebar.root"]')!.getBoundingClientRect();
    const composite = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.main.root"]')!.getBoundingClientRect();
    return { appRight: app.right, sidebarLeft: sidebar.left, sidebarRight: sidebar.right,
      compositeRight: composite.right, viewportWidth: document.documentElement.clientWidth };
  });
  expect(geometry.appRight).toBeLessThanOrEqual(geometry.sidebarLeft + 0.5);
  expect(geometry.sidebarRight).toBeLessThanOrEqual(geometry.compositeRight + 0.5);
  expect(geometry.compositeRight).toBeLessThanOrEqual(geometry.viewportWidth + 0.5);
  await settleVisuals(page);
  await page.screenshot({ path: new URL("./screenshots/runtime-shell-narrow.png", import.meta.url).pathname });
});
