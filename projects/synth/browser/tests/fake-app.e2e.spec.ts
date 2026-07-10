import { expect, test, type Page } from "@playwright/test";

type FrameNode = {
  id: string;
  children: string[];
  pointerDragAction?: { name: string; value: string };
  doubleClickAction?: { name: string; value: string };
};

type FrameObservation = { nodes: FrameNode[] };

const fakeAcceptance = { shell: false, gestures: false, narrow: false };

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
  await page.route("**/dist/src/main.js*", (route) => {
    if (new URL(route.request().url()).search) return route.continue();
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  await page.goto("http://127.0.0.1:4174/public/index.html");
  await page.evaluate(async () => {
    document.querySelector<HTMLElement>("#synth-root")!.dataset.synthAuto = "false";
    const main = await (new Function("return import('/dist/src/main.js?task5')")() as Promise<any>);
    const { decodeCommandBuffer } = await (new Function("return import('/dist/src/protocol.js')")() as Promise<any>);
    const client = main.createWorkerRuntimeClient();
    const observations = {
      commands: [] as Array<{ type: string; name?: string; value?: string }>,
      responses: [] as Array<{ type: string; error?: string }>,
      frames: [] as FrameObservation[],
      terminated: false,
    };
    const observingClient = {
      async request(command: { type: string; name?: string; value?: string }) {
        observations.commands.push({ type: command.type, name: command.name, value: command.value });
        const response = await client.request(command);
        observations.responses.push({ type: response.type, error: response.type === "error" ? response.error : undefined });
        if (response.type === "ui-frame") {
          const frame = decodeCommandBuffer(Uint8Array.from(response.frame).buffer);
          observations.frames.push({ nodes: frame.nodes });
        }
        return response;
      },
      onStatus: client.onStatus,
      terminate: () => {
        observations.terminated = true;
        client.terminate?.();
      },
    };
    const app = await main.installSynthBrowserApp(document.querySelector("#synth-root")!, {
      moduleUrl: new URL("/dist/wasm/fake_browser_app.js", location.href).href,
      frameIntervalMs: 60_000,
      runtimeClient: observingClient,
    });
    if (observations.frames.length === 0) throw new Error(JSON.stringify(observations.responses));
    (window as any).__task5Fake = { app, observations };
  });
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    const state = (window as any).__task5Fake;
    if (!state) return;
    state.app.stop();
    if (!state.observations.terminated) throw new Error("SynthBrowserApp.stop() did not terminate the runtime client");
    delete (window as any).__task5Fake;
  });
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

test("real fake-app WASM renders and refreshes the shared runtime shell", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await installRealFakeApp(page);

  await expect(page.locator('[data-synth-node-id="runtime.main.root"]')).toHaveCount(1);
  await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toBeVisible();
  await expect(page.locator('[data-synth-node-id="runtime.sidebar.root"]')).toBeVisible();
  await assertNoContentSidebarOverlap(page);

  for (const pageName of ["audio", "controllers", "file"] as const) {
    await page.locator(`[data-synth-node-id="runtime.sidebar.${pageName}"]`).click();
    await expect(page.locator(`[data-synth-node-id="runtime.${pageName}.root"]`)).toBeVisible();
    await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toHaveCount(0);
    await page.locator(`[data-synth-node-id="runtime.${pageName}.back"]`).click();
    await expect(page.locator('[data-synth-node-id="fake-browser-root"]')).toBeVisible();
  }

  const frameShape = await page.evaluate(() => {
    const frames = (window as any).__task5Fake.observations.frames as FrameObservation[];
    const initial = frames[0];
    const childIds = new Set(initial.nodes.flatMap((node) => node.children));
    return {
      roots: initial.nodes.filter((node) => !childIds.has(node.id)).map((node) => node.id),
      frameCount: frames.length,
    };
  });
  expect(frameShape.roots).toEqual(["runtime.main.root"]);
  expect(frameShape.frameCount).toBeGreaterThanOrEqual(7);
  fakeAcceptance.shell = true;
});

test("real fake-app WASM dispatches incremental drag and double-click actions", async ({ page }) => {
  await installRealFakeApp(page);
  const gesture = await page.evaluate(() => {
    const frame = ((window as any).__task5Fake.observations.frames as FrameObservation[])[0];
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
    (window as any).__task5Fake.observations.commands.filter((command: { type: string }) => command.type === "dispatch-action").length,
  )).toBeGreaterThanOrEqual(3);
  const actions = await page.evaluate(() =>
    (window as any).__task5Fake.observations.commands.filter((command: { type: string }) => command.type === "dispatch-action"),
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
