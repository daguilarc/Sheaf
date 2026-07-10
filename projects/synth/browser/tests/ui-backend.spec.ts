import { expect, test } from "@playwright/test";
import { BrowserUiBackend, CommandBufferError, decodeCommandBuffer } from "../src/ui.js";
import { DrawKind, NodeKind, makeCommandBuffer } from "./fixtures/command-buffer.js";

const frame = makeCommandBuffer([
  { id: "root", kind: NodeKind.Root, bounds: [0, 0, 320, 160], children: ["scroll", "button", "toggle", "slider", "combo", "field", "draw"] },
  { id: "scroll", kind: NodeKind.ScrollArea, bounds: [0, 0, 100, 40], scrollContentWidth: 100, scrollContentHeight: 160, children: ["row"] },
  { id: "row", kind: NodeKind.Row, bounds: [0, 0, 90, 20], children: ["bottom"], doubleClickAction: { name: "generic.row", value: "open" } },
  { id: "bottom", kind: NodeKind.Label, bounds: [0, 120, 90, 20], text: "Bottom content" },
  { id: "button", kind: NodeKind.Button, bounds: [110, 0, 80, 20], label: "Activate", action: { name: "generic.button", value: "press" } },
  { id: "toggle", kind: NodeKind.Toggle, bounds: [110, 25, 80, 20], label: "Enabled", checked: false, action: { name: "generic.toggle", value: "" } },
  { id: "slider", kind: NodeKind.Slider, bounds: [110, 50, 80, 20], value: 3, minValue: 0, maxValue: 10, step: 1, action: { name: "generic.slider", value: "" }, pointerDragAction: { name: "generic.drag", value: "axis:0" } },
  { id: "combo", kind: NodeKind.ComboBox, bounds: [110, 75, 80, 20], selectedOption: "one", options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }], action: { name: "generic.combo", value: "" } },
  { id: "field", kind: NodeKind.TextField, bounds: [110, 100, 80, 20], text: "before", action: { name: "generic.text", value: "" } },
  { id: "draw", kind: NodeKind.Draw, bounds: [210, 0, 80, 40], doubleClickAction: { name: "generic.draw", value: "open" }, draws: [
    { kind: DrawKind.Fill, color: [20, 30, 40, 255] },
    { kind: DrawKind.StrokeRect, bounds: [1, 2, 20, 15], color: [255, 0, 0, 255] },
    { kind: DrawKind.Line, from: { x: 0, y: 0 }, to: { x: 30, y: 20 }, color: [0, 255, 0, 255] },
    { kind: DrawKind.Arc, bounds: [4, 4, 12, 12], startRadians: 0, endRadians: 3.14 },
    { kind: DrawKind.Text, bounds: [2, 2, 40, 10], text: "draw" },
    { kind: DrawKind.FillEllipse, bounds: [3, 3, 10, 8] }, { kind: DrawKind.StrokeEllipse, bounds: [3, 3, 10, 8] },
    { kind: DrawKind.FillRoundedRect, bounds: [2, 2, 10, 8], cornerRadius: 2 }, { kind: DrawKind.StrokeRoundedRect, bounds: [2, 2, 10, 8], cornerRadius: 2 },
    { kind: DrawKind.Polyline, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }, { kind: DrawKind.FillPolygon, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 2, y: 4 }] },
  ] },
]);

test.beforeEach(async ({ page }) => {
  await page.route("**/dist/src/main.js", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "",
  }));
});

test("renders portable controls, canvas draws, and reachable scroll content", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const browserWindow = window as unknown as { backend: InstanceType<typeof BrowserUiBackend> };
    browserWindow.backend = new BrowserUiBackend(document.querySelector("#synth-root")!);
    browserWindow.backend.renderFrame(new Uint8Array(bytes).buffer);
  }, Array.from(new Uint8Array(frame)));
  await expect(page.locator('[data-synth-node-id="button"][data-synth-node-kind="button"]')).toHaveText("Activate");
  await expect(page.locator('[data-synth-node-id="draw"] canvas')).toBeVisible();
  const scroll = page.locator('[data-synth-node-id="scroll"]');
  await expect(scroll).toHaveJSProperty("scrollHeight", 160);
  await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('[data-synth-node-id="bottom"]')).toBeInViewport();
  await page.locator('[data-synth-node-id="button"]').evaluate((element) => { (window as unknown as { firstButton: Element }).firstButton = element; });
  await page.evaluate(async (bytes) => {
    const browserWindow = window as unknown as { backend: { renderFrame(buffer: ArrayBuffer): void } };
    browserWindow.backend.renderFrame(new Uint8Array(bytes).buffer);
  }, Array.from(new Uint8Array(frame)));
  expect(await page.locator('[data-synth-node-id="button"]').evaluate((element) => element === (window as unknown as { firstButton: Element }).firstButton)).toBeTruthy();
  expect(await page.locator("[data-synth-node-id]").evaluateAll((nodes) => nodes.some((node) => /miniapp|fake/i.test(node.outerHTML)))).toBeFalsy();
});

test("dispatches controls and browser gestures without retaining drag state", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const actions = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const browserWindow = window as unknown as { actions: unknown[] };
    browserWindow.actions = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: unknown) => browserWindow.actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
    return browserWindow.actions;
  }, Array.from(new Uint8Array(frame)));
  expect(actions).toEqual([]);
  await page.locator('[data-synth-node-id="button"]').click();
  await page.locator('[data-synth-node-id="toggle"] input').check();
  await page.locator('[data-synth-node-id="slider"] input').fill("7");
  await page.locator('[data-synth-node-id="combo"] select').selectOption("two");
  await page.locator('[data-synth-node-id="field"] input').fill("after");
  await page.locator('[data-synth-node-id="slider"]').dispatchEvent("pointerdown", { clientX: 20 });
  await page.locator('[data-synth-node-id="slider"]').dispatchEvent("pointerup", { clientX: 26 });
  await page.locator('[data-synth-node-id="row"]').dblclick();
  await page.locator('[data-synth-node-id="draw"] canvas').dblclick();
  const dispatched = await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions);
  expect(dispatched).toEqual([
    { name: "generic.button", value: "press" }, { name: "generic.toggle", value: "true" }, { name: "generic.slider", value: "7" },
    { name: "generic.combo", value: "two" }, { name: "generic.text", value: "after" }, { name: "generic.drag", value: "axis:6" }, { name: "generic.row", value: "open" },
    { name: "generic.draw", value: "open" },
  ]);
});

test("preserves focused edits while a stale frame is rendered", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const browserWindow = window as unknown as { backend: InstanceType<typeof BrowserUiBackend> };
    browserWindow.backend = new BrowserUiBackend(document.querySelector("#synth-root")!);
    browserWindow.backend.renderFrame(new Uint8Array(bytes).buffer);
  }, Array.from(new Uint8Array(frame)));

  const slider = page.locator('[data-synth-node-id="slider"] input');
  const field = page.locator('[data-synth-node-id="field"] input');
  await slider.focus();
  await slider.fill("7");
  await page.evaluate(async (bytes) => {
    (window as unknown as { backend: { renderFrame(buffer: ArrayBuffer): void } }).backend.renderFrame(new Uint8Array(bytes).buffer);
  }, Array.from(new Uint8Array(frame)));
  await expect(slider).toHaveValue("7");

  await field.focus();
  await field.fill("after");
  await page.evaluate(async (bytes) => {
    (window as unknown as { backend: { renderFrame(buffer: ArrayBuffer): void } }).backend.renderFrame(new Uint8Array(bytes).buffer);
  }, Array.from(new Uint8Array(frame)));
  await expect(field).toHaveValue("after");
});

test("fills explicit draw bounds without changing whole-canvas fills", async ({ page }) => {
  const fillFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 20, 20], children: ["draw"] },
    { id: "draw", kind: NodeKind.Draw, bounds: [0, 0, 20, 20], draws: [
      { kind: DrawKind.Fill, color: [0, 0, 0, 255] },
      { kind: DrawKind.Fill, bounds: [5, 5, 10, 10], color: [255, 0, 0, 255] },
    ] },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const pixels = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const context = document.querySelector<HTMLCanvasElement>('[data-synth-node-id="draw"] canvas')!.getContext("2d")!;
    return {
      outside: Array.from(context.getImageData(1, 1, 1, 1).data),
      inside: Array.from(context.getImageData(6, 6, 1, 1).data),
    };
  }, Array.from(new Uint8Array(fillFrame)));
  expect(pixels).toEqual({ outside: [0, 0, 0, 255], inside: [255, 0, 0, 255] });
});

test("preserves semantic nodes and reports structural buffer errors", () => {
  const decoded = decodeCommandBuffer(frame);
  expect(decoded.nodes).toHaveLength(10);
  expect(() => decodeCommandBuffer(new ArrayBuffer(4))).toThrow(CommandBufferError);
});
