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

test("dispatches portable controls and double-click actions", async ({ page }) => {
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
  await page.locator('[data-synth-node-id="row"]').dblclick();
  await page.locator('[data-synth-node-id="draw"] canvas').dblclick();
  const dispatched = await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions);
  expect(dispatched).toEqual([
    { name: "generic.button", value: "press" }, { name: "generic.toggle", value: "1" }, { name: "generic.slider", value: "7" },
    { name: "generic.combo", value: "two" }, { name: "generic.text", value: "after" }, { name: "generic.row", value: "open" },
    { name: "generic.draw", value: "open" },
  ]);
});

test("dispatches real mouse double-clicks on draggable draw controls", async ({ page }) => {
  const encoderFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 120, 120], children: ["encoder"] },
    { id: "encoder", kind: NodeKind.Draw, bounds: [20, 20, 60, 60],
      pointerDragAction: { name: "generic.drag", value: "axis:0" },
      doubleClickAction: { name: "generic.reset", value: "axis" },
      draws: [{ kind: DrawKind.FillEllipse, bounds: [20, 20, 60, 60], color: [20, 80, 90, 255] }] },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const browserWindow = window as unknown as { actions: unknown[] };
    browserWindow.actions = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: unknown) => browserWindow.actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
  }, Array.from(new Uint8Array(encoderFrame)));

  const box = await page.locator('[data-synth-node-id="encoder"]').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.dblclick(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const dispatched = await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions);
  expect(dispatched).toEqual([{ name: "generic.reset", value: "axis" }]);
});

test("appends control values to action prefixes without losing option ids", async ({ page }) => {
  const prefixedFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 320, 120], children: ["combo", "field", "toggle"] },
    { id: "combo", kind: NodeKind.ComboBox, bounds: [0, 0, 120, 24], selectedOption: "dev-a",
      options: [{ id: "dev-a", label: "Device A" }, { id: "dev-b", label: "Device B" }],
      action: { name: "controller.endpoint", value: "0:input" } },
    { id: "field", kind: NodeKind.TextField, bounds: [0, 32, 120, 24], text: "",
      action: { name: "mapping.value", value: "0:encoders:2:5" } },
    { id: "toggle", kind: NodeKind.Toggle, bounds: [0, 64, 120, 24], label: "Feedback", checked: false,
      action: { name: "mapping.value", value: "0:system_messages:1:25" } },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const browserWindow = window as unknown as { actions: unknown[] };
    browserWindow.actions = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: unknown) => browserWindow.actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
  }, Array.from(new Uint8Array(prefixedFrame)));
  await page.locator('[data-synth-node-id="combo"] select').selectOption("dev-b");
  await page.locator('[data-synth-node-id="field"] input').fill("42");
  await page.locator('[data-synth-node-id="toggle"] input').check();
  const dispatched = await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions);
  expect(dispatched).toEqual([
    { name: "controller.endpoint", value: "0:input:dev-b" },
    { name: "mapping.value", value: "0:encoders:2:5:42" },
    { name: "mapping.value", value: "0:system_messages:1:25:1" },
  ]);
});

test("dispatches each generic text input event with one separator-appended value", async ({ page }) => {
  const draftFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 200, 80], children: ["draft"] },
    { id: "draft", kind: NodeKind.TextField, bounds: [0, 0, 160, 24], text: "",
      action: { name: "generic.rename_draft", value: "0:6d616e75616c" } },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const browserWindow = window as unknown as { actions: unknown[] };
    browserWindow.actions = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: unknown) => browserWindow.actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
  }, Array.from(new Uint8Array(draftFrame)));
  await page.locator('[data-synth-node-id="draft"] input').pressSequentially("abc");
  const dispatched = await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions);
  expect(dispatched).toEqual([
    { name: "generic.rename_draft", value: "0:6d616e75616c:a" },
    { name: "generic.rename_draft", value: "0:6d616e75616c:ab" },
    { name: "generic.rename_draft", value: "0:6d616e75616c:abc" },
  ]);
});

const disabledFrame = makeCommandBuffer([
  { id: "root", kind: NodeKind.Root, bounds: [0, 0, 320, 240], children: ["button", "toggle", "slider", "combo", "field", "row", "draw"] },
  { id: "button", kind: NodeKind.Button, bounds: [10, 10, 80, 20], label: "Submit", enabled: false, action: { name: "generic.button", value: "press" } },
  { id: "toggle", kind: NodeKind.Toggle, bounds: [10, 40, 80, 20], label: "Feedback", checked: false, enabled: false, action: { name: "generic.toggle", value: "" } },
  { id: "slider", kind: NodeKind.Slider, bounds: [10, 70, 80, 20], value: 3, minValue: 0, maxValue: 10, step: 1, enabled: false, action: { name: "generic.slider", value: "" } },
  { id: "combo", kind: NodeKind.ComboBox, bounds: [10, 100, 80, 20], selectedOption: "two", enabled: false,
    options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }], action: { name: "generic.combo", value: "" } },
  { id: "field", kind: NodeKind.TextField, bounds: [10, 130, 80, 20], text: "before", enabled: false, action: { name: "generic.text", value: "" } },
  { id: "row", kind: NodeKind.Row, bounds: [120, 10, 80, 20], enabled: false, doubleClickAction: { name: "generic.row", value: "open" } },
  { id: "draw", kind: NodeKind.Draw, bounds: [120, 40, 80, 40], enabled: false,
    pointerDragAction: { name: "generic.drag", value: "axis:0" }, doubleClickAction: { name: "generic.draw", value: "open" } },
]);

test("renders disabled native controls and keeps their portable values", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
  }, Array.from(new Uint8Array(disabledFrame)));

  for (const [id, control] of [["button", ""], ["toggle", " input"], ["slider", " input"], ["combo", " select"], ["field", " input"]] as const)
    await expect(page.locator(`[data-synth-node-id="${id}"]${control}`)).toBeDisabled();
  for (const id of ["button", "toggle", "slider", "combo", "field", "row", "draw"])
    await expect(page.locator(`[data-synth-node-id="${id}"]`)).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator('[data-synth-node-id="combo"] select')).toHaveValue("two");
  await expect(page.locator('[data-synth-node-id="combo"] select option')).toHaveText(["One", "Two"]);
  await expect(page.locator('[data-synth-node-id="field"] input')).toHaveValue("before");
  await expect(page.locator('[data-synth-node-id="slider"] input')).toHaveValue("3");
});

test("suppresses actions from disabled native controls", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const dispatched = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const actions: Array<{ name: string; value: string }> = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: { name: string; value: string }) => actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
    const controlIn = (id: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-synth-node-id="${id}"] :is(input, select)`)!;
    document.querySelector<HTMLButtonElement>('[data-synth-node-id="button"]')!.click();
    const toggle = controlIn("toggle") as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    const slider = controlIn("slider") as HTMLInputElement;
    slider.value = "9";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    const combo = controlIn("combo") as HTMLSelectElement;
    combo.value = "one";
    combo.dispatchEvent(new Event("change", { bubbles: true }));
    const field = controlIn("field") as HTMLInputElement;
    field.value = "after";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return actions;
  }, Array.from(new Uint8Array(disabledFrame)));

  expect(dispatched).toEqual([]);
});

test("suppresses double-click and drag actions from disabled semantic nodes", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const actions: Array<{ name: string; value: string }> = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: { name: string; value: string }) => actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
    const row = document.querySelector<HTMLElement>('[data-synth-node-id="row"]')!;
    const draw = document.querySelector<HTMLElement>('[data-synth-node-id="draw"]')!;
    const captures: number[] = [];
    draw.setPointerCapture = (pointerId) => { captures.push(pointerId); };
    draw.releasePointerCapture = () => {};
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    draw.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    draw.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 5, clientX: 10, clientY: 10 }));
    draw.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 5, clientX: 40, clientY: 10 }));
    draw.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 5, clientX: 40, clientY: 10 }));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    return { actions, captures };
  }, Array.from(new Uint8Array(disabledFrame)));

  expect(result).toEqual({ actions: [], captures: [] });
});

test("stops an in-flight drag when its node becomes disabled", async ({ page }) => {
  const draggableFrames = ([true, false] as const).map((enabled) => makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 200, 100], children: ["drag"] },
    { id: "drag", kind: NodeKind.Draw, bounds: [10, 10, 40, 40], enabled, pointerDragAction: { name: "generic.drag", value: "axis:0" } },
  ]));
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async ([enabledBytes, disabledBytes]) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const actions: Array<{ name: string; value: string }> = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: { name: string; value: string }) => actions.push(action));
    backend.renderFrame(new Uint8Array(enabledBytes).buffer);
    const drag = document.querySelector<HTMLElement>('[data-synth-node-id="drag"]')!;
    const releases: number[] = [];
    drag.setPointerCapture = () => {};
    drag.releasePointerCapture = (pointerId) => { releases.push(pointerId); };
    drag.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 6, clientX: 10, clientY: 10 }));
    backend.renderFrame(new Uint8Array(disabledBytes).buffer);
    drag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 6, clientX: 60, clientY: 10 }));
    drag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 6, clientX: 110, clientY: 10 }));
    return { actions, releases };
  }, [Array.from(new Uint8Array(draggableFrames[0])), Array.from(new Uint8Array(draggableFrames[1]))]);

  expect(result).toEqual({ actions: [], releases: [6] });
});

test("keeps dispatching once a previously disabled node becomes enabled", async ({ page }) => {
  const enabledFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 320, 240], children: ["button", "combo", "field", "row"] },
    { id: "button", kind: NodeKind.Button, bounds: [10, 10, 80, 20], label: "Submit", action: { name: "generic.button", value: "press" } },
    { id: "combo", kind: NodeKind.ComboBox, bounds: [10, 40, 80, 20], selectedOption: "two",
      options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }], action: { name: "generic.combo", value: "" } },
    { id: "field", kind: NodeKind.TextField, bounds: [10, 70, 80, 20], text: "before", action: { name: "generic.text", value: "" } },
    { id: "row", kind: NodeKind.Row, bounds: [120, 10, 80, 20], doubleClickAction: { name: "generic.row", value: "open" } },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  await page.evaluate(async ({ disabled, enabled }) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const browserWindow = window as unknown as { actions: unknown[]; backend: { renderFrame(buffer: ArrayBuffer): void } };
    browserWindow.actions = [];
    browserWindow.backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: unknown) => browserWindow.actions.push(action));
    browserWindow.backend.renderFrame(new Uint8Array(disabled).buffer);
    browserWindow.backend.renderFrame(new Uint8Array(enabled).buffer);
  }, { disabled: Array.from(new Uint8Array(disabledFrame)), enabled: Array.from(new Uint8Array(enabledFrame)) });

  await page.locator('[data-synth-node-id="button"]').click();
  await page.locator('[data-synth-node-id="combo"] select').selectOption("one");
  await page.locator('[data-synth-node-id="field"] input').fill("after");
  await page.locator('[data-synth-node-id="row"]').dblclick();
  expect(await page.evaluate(() => (window as unknown as { actions: unknown[] }).actions)).toEqual([
    { name: "generic.button", value: "press" },
    { name: "generic.combo", value: "one" },
    { name: "generic.text", value: "after" },
    { name: "generic.row", value: "open" },
  ]);
  for (const id of ["button", "combo", "field", "row"])
    await expect(page.locator(`[data-synth-node-id="${id}"]`)).not.toHaveAttribute("aria-disabled");
});

test("preserves focused combo boxes across stale frame refreshes", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const browserWindow = window as unknown as { backend: InstanceType<typeof BrowserUiBackend> };
    browserWindow.backend = new BrowserUiBackend(document.querySelector("#synth-root")!);
    browserWindow.backend.renderFrame(new Uint8Array(bytes).buffer);
  }, Array.from(new Uint8Array(frame)));

  const snapshot = await page.evaluate((bytes) => {
    const select = document.querySelector<HTMLSelectElement>('[data-synth-node-id="combo"] select')!;
    select.focus();
    select.value = "two";
    const firstOption = select.options[0];
    (window as unknown as { firstComboOption: HTMLOptionElement }).firstComboOption = firstOption;
    const browserWindow = window as unknown as { backend: { renderFrame(buffer: ArrayBuffer): void } };
    browserWindow.backend.renderFrame(new Uint8Array(bytes).buffer);
    return {
      value: select.value,
      firstOptionPreserved: select.options[0] === (window as unknown as { firstComboOption: HTMLOptionElement }).firstComboOption,
      optionLabels: Array.from(select.options).map((option) => option.textContent),
    };
  }, Array.from(new Uint8Array(frame)));

  expect(snapshot).toEqual({
    value: "two",
    firstOptionPreserved: true,
    optionLabels: ["One", "Two"],
  });
});

test("maps portable arc angles into the canvas angle basis", async ({ page }) => {
  const arcFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 120, 120], children: ["draw"] },
    { id: "draw", kind: NodeKind.Draw, bounds: [0, 0, 80, 80], draws: [
      { kind: DrawKind.Arc, bounds: [10, 10, 40, 40], startRadians: 0, endRadians: Math.PI / 2 },
    ] },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const calls = await page.evaluate(async (bytes) => {
    const arcCalls: Array<{ start: number; end: number }> = [];
    const originalArc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function(...args: Parameters<CanvasRenderingContext2D["arc"]>) {
      arcCalls.push({ start: args[3], end: args[4] });
      return originalArc.apply(this, args);
    };
    try {
      const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
      const backend = new BrowserUiBackend(document.querySelector("#synth-root")!);
      backend.renderFrame(new Uint8Array(bytes).buffer);
      return arcCalls;
    } finally {
      CanvasRenderingContext2D.prototype.arc = originalArc;
    }
  }, Array.from(new Uint8Array(arcFrame)));
  expect(calls).toHaveLength(1);
  expect(calls[0].start).toBeCloseTo(-Math.PI / 2, 6);
  expect(calls[0].end).toBeCloseTo(0, 6);
});

test("captures pointer drags and dispatches accepted incremental two-axis deltas", async ({ page }) => {
  const dragFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 200, 100], children: ["drag", "plain"] },
    { id: "drag", kind: NodeKind.Draw, bounds: [10, 10, 40, 40], pointerDragAction: { name: "generic.drag", value: "0:3:0" } },
    { id: "plain", kind: NodeKind.Button, bounds: [60, 10, 60, 30], label: "Plain" },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const actions: Array<{ name: string; value: string }> = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: { name: string; value: string }) => actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
    const drag = document.querySelector<HTMLElement>('[data-synth-node-id="drag"]')!;
    const plain = document.querySelector<HTMLElement>('[data-synth-node-id="plain"]')!;
    const captures: number[] = [];
    const releases: number[] = [];
    drag.setPointerCapture = (pointerId) => { captures.push(pointerId); };
    drag.releasePointerCapture = (pointerId) => { releases.push(pointerId); };
    plain.setPointerCapture = (pointerId) => { captures.push(pointerId + 100); };

    plain.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 4, clientX: 1, clientY: 1 }));
    drag.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 7, clientX: 10, clientY: 20 }));
    drag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, clientX: 18, clientY: 16 }));
    drag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, clientX: 20, clientY: 20 }));
    drag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, clientX: 20.2, clientY: 20 }));
    drag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, clientX: 20.6, clientY: 20 }));
    drag.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 7, clientX: 20.6, clientY: 20 }));
    return { actions, captures, releases };
  }, Array.from(new Uint8Array(dragFrame)));

  expect(result.captures).toEqual([7]);
  expect(result.releases).toEqual([7]);
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0].name).toBe("generic.drag");
  expect(Number(result.actions[0].value.split(":").at(-1))).toBeCloseTo(0.0265, 10);
});

test("compensates pointer movement for the current surface scale", async ({ page }) => {
  const dragFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 200, 100], children: ["drag"] },
    { id: "drag", kind: NodeKind.Draw, bounds: [10, 10, 40, 40], pointerDragAction: { name: "generic.drag", value: "axis:0" } },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const host = document.querySelector<HTMLElement>("#synth-root")!;
    host.style.width = "100px";
    const actions: Array<{ name: string; value: string }> = [];
    const backend = new BrowserUiBackend(host, (action: { name: string; value: string }) => actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
    const drag = document.querySelector<HTMLElement>('[data-synth-node-id="drag"]')!;
    drag.setPointerCapture = () => {};
    drag.releasePointerCapture = () => {};
    drag.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 3, clientX: 10, clientY: 20 }));
    drag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 3, clientX: 14, clientY: 18 }));
    drag.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, clientX: 14, clientY: 18 }));
    return actions;
  }, Array.from(new Uint8Array(dragFrame)));

  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("generic.drag");
  expect(Number(result[0].value.slice("axis:".length))).toBeCloseTo(0.03, 10);
});

test("keeps captured drags alive outside and clears them on cancel and lost capture", async ({ page }) => {
  const dragFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 100, 100], children: ["drag"] },
    { id: "drag", kind: NodeKind.Draw, bounds: [10, 10, 20, 20], pointerDragAction: { name: "generic.drag", value: "axis:0" } },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const actions: Array<{ name: string; value: string }> = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: { name: string; value: string }) => actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
    const drag = document.querySelector<HTMLElement>('[data-synth-node-id="drag"]')!;
    const captures: number[] = [];
    const releases: number[] = [];
    drag.setPointerCapture = (pointerId) => { captures.push(pointerId); };
    drag.releasePointerCapture = (pointerId) => { releases.push(pointerId); };
    const send = (type: string, pointerId: number, clientX: number) =>
      drag.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, clientX, clientY: 10 }));

    send("pointerdown", 1, 10);
    send("pointermove", 1, 1000);
    send("pointercancel", 1, 1000);
    send("pointermove", 1, 1010);
    send("pointerdown", 2, 10);
    send("pointermove", 2, 20);
    send("lostpointercapture", 2, 20);
    send("pointermove", 2, 30);
    return { actions, captures, releases };
  }, Array.from(new Uint8Array(dragFrame)));

  expect(result.actions).toHaveLength(2);
  expect(Number(result.actions[0].value.slice("axis:".length))).toBeCloseTo(2.475, 10);
  expect(Number(result.actions[1].value.slice("axis:".length))).toBeCloseTo(0.025, 10);
  expect(result.captures).toEqual([1, 2]);
  expect(result.releases).toEqual([1]);
});

test("does not begin a drag when pointer capture fails", async ({ page }) => {
  const dragFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 100, 100], children: ["drag"] },
    { id: "drag", kind: NodeKind.Draw, bounds: [10, 10, 20, 20], pointerDragAction: { name: "generic.drag", value: "axis:0" } },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const actions: Array<{ name: string; value: string }> = [];
    const errors: string[] = [];
    window.addEventListener("error", (event) => { errors.push(event.message); event.preventDefault(); });
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: { name: string; value: string }) => actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
    const drag = document.querySelector<HTMLElement>('[data-synth-node-id="drag"]')!;
    drag.setPointerCapture = () => { throw new DOMException("capture unavailable", "InvalidStateError"); };
    drag.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 4, clientX: 10, clientY: 10 }));
    drag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 4, clientX: 20, clientY: 10 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { actions, errors };
  }, Array.from(new Uint8Array(dragFrame)));

  expect(result).toEqual({ actions: [], errors: [] });
});

test("allows only one pointer to drive each drag element", async ({ page }) => {
  const dragFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 100, 100], children: ["drag"] },
    { id: "drag", kind: NodeKind.Draw, bounds: [10, 10, 20, 20], pointerDragAction: { name: "generic.drag", value: "axis:0" } },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const actions: Array<{ name: string; value: string }> = [];
    const captures: number[] = [];
    const releases: number[] = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: { name: string; value: string }) => actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
    const drag = document.querySelector<HTMLElement>('[data-synth-node-id="drag"]')!;
    drag.setPointerCapture = (pointerId) => { captures.push(pointerId); };
    drag.releasePointerCapture = (pointerId) => { releases.push(pointerId); };
    const send = (type: string, pointerId: number, clientX: number) =>
      drag.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, clientX, clientY: 10 }));

    send("pointerdown", 1, 10);
    send("pointerdown", 2, 10);
    send("pointermove", 2, 30);
    send("pointermove", 1, 14);
    send("pointerup", 2, 30);
    send("pointerup", 1, 14);
    return { actions, captures, releases };
  }, Array.from(new Uint8Array(dragFrame)));

  expect(result.captures).toEqual([1]);
  expect(result.releases).toEqual([1]);
  expect(result.actions).toHaveLength(1);
  expect(result.actions[0].name).toBe("generic.drag");
  expect(Number(result.actions[0].value.slice("axis:".length))).toBeCloseTo(0.01, 10);
});

test("uses the current surface scale for each accepted drag increment", async ({ page }) => {
  const dragFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 200, 100], children: ["drag"] },
    { id: "drag", kind: NodeKind.Draw, bounds: [10, 10, 20, 20], pointerDragAction: { name: "generic.drag", value: "axis:0" } },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const actions = await page.evaluate(async (bytes) => {
    let resize: ResizeObserverCallback = () => {};
    class ResizeObserverSpy {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = ResizeObserverSpy as unknown as typeof ResizeObserver;
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const host = document.querySelector<HTMLElement>("#synth-root")!;
    host.style.width = "200px";
    const actions: Array<{ name: string; value: string }> = [];
    const backend = new BrowserUiBackend(host, (action: { name: string; value: string }) => actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
    const drag = document.querySelector<HTMLElement>('[data-synth-node-id="drag"]')!;
    drag.setPointerCapture = () => {};
    drag.releasePointerCapture = () => {};
    drag.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 8, clientX: 10, clientY: 5 }));
    host.style.width = "100px";
    resize([], {} as ResizeObserver);
    drag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 8, clientX: 14, clientY: 5 }));
    drag.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 8, clientX: 14, clientY: 5 }));
    return actions;
  }, Array.from(new Uint8Array(dragFrame)));

  expect(actions).toHaveLength(1);
  expect(actions[0].name).toBe("generic.drag");
  expect(Number(actions[0].value.slice("axis:".length))).toBeCloseTo(0.02, 10);
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

test("draws arcs with isolated round cap and join state", async ({ page }) => {
  const arcFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 40, 40], children: ["draw"] },
    { id: "draw", kind: NodeKind.Draw, bounds: [0, 0, 40, 40], draws: [
      { kind: DrawKind.Arc, bounds: [5, 5, 10, 10], startRadians: 0, endRadians: 0.0001 },
      { kind: DrawKind.Line, from: { x: 0, y: 0 }, to: { x: 10, y: 10 } },
    ] },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const calls = await page.evaluate(async (bytes) => {
    const calls: string[] = [];
    let lineCap = "butt";
    let lineJoin = "miter";
    const stack: Array<[string, string]> = [];
    const context = {
      fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "left",
      get lineCap() { return lineCap; },
      set lineCap(value: string) { lineCap = value; calls.push(`lineCap:${value}`); },
      get lineJoin() { return lineJoin; },
      set lineJoin(value: string) { lineJoin = value; calls.push(`lineJoin:${value}`); },
      save() { stack.push([lineCap, lineJoin]); calls.push("save"); },
      restore() { [lineCap, lineJoin] = stack.pop()!; calls.push("restore"); },
      translate() {}, beginPath() {}, moveTo() {}, lineTo() {},
      arc() { calls.push("arc"); },
      stroke() { calls.push(`stroke:${lineCap}:${lineJoin}`); },
      fillRect() {}, strokeRect() {}, fillText() {}, ellipse() {}, fill() {}, roundRect() {},
    };
    (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => context;
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    return calls;
  }, Array.from(new Uint8Array(arcFrame)));

  expect(calls).toEqual([
    "save", "lineCap:round", "lineJoin:round", "arc", "stroke:round:round", "restore", "stroke:butt:miter",
  ]);
});

test("flows unbounded controls after explicit draw content", async ({ page }) => {
  const layoutFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 320, 240], children: ["draw", "label", "button", "slider"] },
    { id: "draw", kind: NodeKind.Draw, bounds: [20, 16, 280, 80] },
    { id: "label", kind: NodeKind.Label, text: "Controls" },
    { id: "button", kind: NodeKind.Button, label: "Trigger" },
    { id: "slider", kind: NodeKind.Slider, value: 0.5, minValue: 0, maxValue: 1, step: 0.01 },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const bounds = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const read = (id: string) => {
      const rect = document.querySelector(`[data-synth-node-id="${id}"]`)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    return { root: read("root"), label: read("label"), button: read("button"), slider: read("slider") };
  }, Array.from(new Uint8Array(layoutFrame)));

  expect(bounds.root).toEqual({ x: 0, y: 0, width: 320, height: 240 });
  expect(bounds.label).toEqual({ x: 12, y: 104, width: 120, height: 22 });
  expect(bounds.button).toEqual({ x: 140, y: 104, width: 72, height: 28 });
  expect(bounds.slider).toEqual({ x: 12, y: 140, width: 140, height: 28 });
});

test("auto-sized controls contain long generic labels", async ({ page }) => {
  const labelFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 320, 120], children: ["toggle", "button"] },
    { id: "toggle", kind: NodeKind.Toggle, label: "Long Modifier", checked: false },
    { id: "button", kind: NodeKind.Button, label: "Following" },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const layout = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const toggle = document.querySelector('[data-synth-node-id="toggle"]')! as HTMLElement;
    const button = document.querySelector('[data-synth-node-id="button"]')! as HTMLElement;
    const toggleBounds = toggle.getBoundingClientRect();
    const buttonBounds = button.getBoundingClientRect();
    return {
      toggleRight: toggleBounds.right,
      buttonLeft: buttonBounds.left,
      toggleClientWidth: toggle.clientWidth,
      toggleScrollWidth: toggle.scrollWidth,
    };
  }, Array.from(new Uint8Array(labelFrame)));

  expect(layout.toggleScrollWidth).toBeLessThanOrEqual(layout.toggleClientWidth);
  expect(layout.toggleRight).toBeLessThanOrEqual(layout.buttonLeft);
});

test("sizes long status text within its nearest root before placing the next control", async ({ page }) => {
  const text = "x".repeat(80);
  const labelFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 400, 60], children: ["status", "button"] },
    { id: "status", kind: NodeKind.StatusText, text },
    { id: "button", kind: NodeKind.Button, label: "Following" },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const layout = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const status = document.querySelector<HTMLElement>('[data-synth-node-id="status"]')!.getBoundingClientRect();
    const button = document.querySelector<HTMLElement>('[data-synth-node-id="button"]')!.getBoundingClientRect();
    return {
      status: { left: status.left, right: status.right, width: status.width, bottom: status.bottom },
      button: { left: button.left, top: button.top },
    };
  }, Array.from(new Uint8Array(labelFrame)));

  expect(layout.status.width).toBe(376);
  expect(layout.status.right).toBeLessThanOrEqual(388);
  expect(layout.button.top).toBeGreaterThanOrEqual(layout.status.bottom + 8);
});

test("clips realistic label and status text to their fixed auto-layout height", async ({ page }) => {
  const labelFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 260, 120], children: ["label", "status", "button"] },
    { id: "label", kind: NodeKind.Label, text: "MIDI OUTPUT DEVICE CONFIGURATION STATUS" },
    { id: "status", kind: NodeKind.StatusText, text: "SYSTEM DEFAULT AUDIO OUTPUT IS READY FOR PERFORMANCE" },
    { id: "button", kind: NodeKind.Button, label: "Following" },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const layout = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const read = (id: string) => {
      const element = document.querySelector<HTMLElement>(`[data-synth-node-id="${id}"]`)!;
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return {
        top: bounds.top, bottom: bounds.bottom,
        clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
        whiteSpace: style.whiteSpace, overflow: style.overflow, textOverflow: style.textOverflow,
      };
    };
    return { label: read("label"), status: read("status"), button: read("button") };
  }, Array.from(new Uint8Array(labelFrame)));

  for (const text of [layout.label, layout.status]) {
    expect(text.whiteSpace).toBe("nowrap");
    expect(text.overflow).toBe("hidden");
    expect(text.textOverflow).toBe("ellipsis");
    expect(text.scrollHeight).toBeLessThanOrEqual(text.clientHeight);
  }
  expect(layout.status.top).toBeGreaterThanOrEqual(layout.label.bottom + 8);
  expect(layout.button.top).toBeGreaterThanOrEqual(layout.status.bottom + 8);
});

test("includes auto-flow below a declared root in the resolved host height", async ({ page }) => {
  const overflowFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 200, 30], children: ["label", "button"] },
    { id: "label", kind: NodeKind.Label, text: "A label that consumes the available row width" },
    { id: "button", kind: NodeKind.Button, label: "Below" },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const layout = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const host = document.querySelector<HTMLElement>("#synth-root")!.getBoundingClientRect();
    const button = document.querySelector<HTMLElement>('[data-synth-node-id="button"]')!.getBoundingClientRect();
    return { hostBottom: host.bottom, hostHeight: host.height, buttonBottom: button.bottom };
  }, Array.from(new Uint8Array(overflowFrame)));

  expect(layout.hostHeight).toBeGreaterThan(30);
  expect(layout.hostBottom).toBeGreaterThanOrEqual(layout.buttonBottom);
});

test("keeps scroll descendants out of the outer surface extent", async ({ page }) => {
  const scrollFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 300, 160], children: ["scroll"] },
    { id: "scroll", kind: NodeKind.ScrollArea, bounds: [10, 10, 100, 100], scrollContentWidth: 100, scrollContentHeight: 2000, children: ["deep"] },
    { id: "deep", kind: NodeKind.Label, bounds: [10, 1900, 80, 20], text: "Deep content" },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const layout = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const host = document.querySelector<HTMLElement>("#synth-root")!;
    const scroll = document.querySelector<HTMLElement>('[data-synth-node-id="scroll"]')!;
    const deep = document.querySelector<HTMLElement>('[data-synth-node-id="deep"]')!;
    scroll.scrollTop = deep.offsetTop;
    const scrollBounds = scroll.getBoundingClientRect();
    const deepBounds = deep.getBoundingClientRect();
    return {
      hostHeight: host.getBoundingClientRect().height,
      scrollHeight: scroll.scrollHeight,
      deepVisible: deepBounds.top >= scrollBounds.top && deepBounds.bottom <= scrollBounds.bottom,
    };
  }, Array.from(new Uint8Array(scrollFrame)));

  expect(layout.hostHeight).toBe(160);
  expect(layout.scrollHeight).toBe(2000);
  expect(layout.deepVisible).toBeTruthy();
});

test("keeps absolute surface bounds while nesting composite roots", async ({ page }) => {
  const compositeFrame = makeCommandBuffer([
    { id: "main", kind: NodeKind.Root, bounds: [0, 0, 996, 200], children: ["app", "sidebar"] },
    { id: "app", kind: NodeKind.Root, bounds: [0, 0, 900, 200], children: ["app-status", "app-button"] },
    { id: "app-status", kind: NodeKind.StatusText, text: "x".repeat(160) },
    { id: "app-button", kind: NodeKind.Button, label: "Next" },
    { id: "sidebar", kind: NodeKind.Root, bounds: [900, 0, 96, 200], children: ["side-button"] },
    { id: "side-button", kind: NodeKind.Button, bounds: [900, 0, 96, 28], label: "Side" },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const layout = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const read = (id: string) => {
      const element = document.querySelector<HTMLElement>(`[data-synth-node-id="${id}"]`)!;
      const rect = element.getBoundingClientRect();
      return { styleLeft: element.style.left, left: rect.left, right: rect.right, top: rect.top };
    };
    return { main: read("main"), appStatus: read("app-status"), appButton: read("app-button"), sidebar: read("sidebar"), sideButton: read("side-button") };
  }, Array.from(new Uint8Array(compositeFrame)));

  expect(layout.sidebar.styleLeft).toBe("900px");
  expect(layout.sideButton.styleLeft).toBe("0px");
  expect(layout.sidebar.left).toBe(900);
  expect(layout.sideButton.left).toBe(900);
  expect(layout.appStatus.right).toBeLessThanOrEqual(900);
  expect(layout.appButton.right).toBeLessThanOrEqual(900);
  expect(layout.appButton.top).toBeGreaterThan(layout.appStatus.top);
});

test("keeps the scale transform only on the current parentless root", async ({ page }) => {
  const firstFrame = makeCommandBuffer([
    { id: "app", kind: NodeKind.Root, bounds: [0, 0, 200, 100] },
  ]);
  const compositeFrame = makeCommandBuffer([
    { id: "main", kind: NodeKind.Root, bounds: [0, 0, 300, 100], children: ["app", "sidebar"] },
    { id: "app", kind: NodeKind.Root, bounds: [0, 0, 200, 100] },
    { id: "sidebar", kind: NodeKind.Root, bounds: [200, 0, 100, 100] },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const transforms = await page.evaluate(async ({ first, composite }) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const host = document.querySelector<HTMLElement>("#synth-root")!;
    host.style.width = "100px";
    const backend = new BrowserUiBackend(host);
    backend.renderFrame(new Uint8Array(first).buffer);
    const firstTransform = document.querySelector<HTMLElement>('[data-synth-node-id="app"]')!.style.transform;
    backend.renderFrame(new Uint8Array(composite).buffer);
    const main = document.querySelector<HTMLElement>('[data-synth-node-id="main"]')!;
    const app = document.querySelector<HTMLElement>('[data-synth-node-id="app"]')!;
    return { firstTransform, mainTransform: main.style.transform, appTransform: app.style.transform, appWidth: app.getBoundingClientRect().width };
  }, { first: Array.from(new Uint8Array(firstFrame)), composite: Array.from(new Uint8Array(compositeFrame)) });

  expect(transforms.firstTransform).toBe("scale(0.5)");
  expect(transforms.mainTransform).toMatch(/^scale\(0\.333/);
  expect(transforms.appTransform).toBe("");
  expect(transforms.appWidth).toBeCloseTo(200 / 3, 4);
});

test("rejects cyclic node graphs without recursive overflow", async ({ page }) => {
  const cyclicFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 100, 100], children: ["a"] },
    { id: "a", kind: NodeKind.Row, bounds: [0, 0, 10, 10], children: ["b"] },
    { id: "b", kind: NodeKind.Row, bounds: [0, 0, 10, 10], children: ["a"] },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const message = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    try {
      new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
      return "no error";
    } catch (error) {
      return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }, Array.from(new Uint8Array(cyclicFrame)));

  expect(message).toMatch(/cycle/i);
});

test("reports stable generic errors for malformed node trees", async ({ page }) => {
  const cases = [
    {
      expected: "duplicate node id (node 1)",
      bytes: makeCommandBuffer([
        { id: "same", kind: NodeKind.Root, bounds: [0, 0, 10, 10] },
        { id: "same", kind: NodeKind.Root, bounds: [0, 0, 10, 10] },
      ]),
    },
    {
      expected: "unknown child node (node 0)",
      bytes: makeCommandBuffer([{ id: "root", kind: NodeKind.Root, bounds: [0, 0, 10, 10], children: ["missing"] }]),
    },
    {
      expected: "node child has multiple parents",
      bytes: makeCommandBuffer([
        { id: "root", kind: NodeKind.Root, bounds: [0, 0, 10, 10], children: ["a", "b"] },
        { id: "a", kind: NodeKind.Row, bounds: [0, 0, 10, 10], children: ["child"] },
        { id: "b", kind: NodeKind.Row, bounds: [0, 0, 10, 10], children: ["child"] },
        { id: "child", kind: NodeKind.Label, bounds: [0, 0, 10, 10] },
      ]),
    },
    {
      expected: "browser UI frame requires one parentless root, found 2",
      bytes: makeCommandBuffer([
        { id: "one", kind: NodeKind.Root, bounds: [0, 0, 10, 10] },
        { id: "two", kind: NodeKind.Root, bounds: [0, 0, 10, 10] },
      ]),
    },
    {
      expected: "browser UI frame requires one parentless root, found 0",
      bytes: makeCommandBuffer([
        { id: "a", kind: NodeKind.Row, bounds: [0, 0, 10, 10], children: ["b"] },
        { id: "b", kind: NodeKind.Row, bounds: [0, 0, 10, 10], children: ["a"] },
      ]),
    },
    {
      expected: "parentless browser UI node must be a root",
      bytes: makeCommandBuffer([{ id: "row", kind: NodeKind.Row, bounds: [0, 0, 10, 10] }]),
    },
  ];
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const messages = await page.evaluate(async (serializedCases) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    return serializedCases.map(({ bytes }) => {
      try {
        new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
        return "no error";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
  }, cases.map(({ bytes }) => ({ bytes: Array.from(new Uint8Array(bytes)) })));

  expect(messages).toEqual(cases.map(({ expected }) => expected));
});

test("a version-mismatched buffer fails loudly and renders no frame", async ({ page }) => {
  const staleFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 40, 40], children: ["label"] },
    { id: "label", kind: NodeKind.Label, bounds: [0, 0, 40, 20], text: "stale" },
  ], [], 1);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const host = document.querySelector("#synth-root")!;
    let message = "no error";
    try {
      new BrowserUiBackend(host).renderFrame(new Uint8Array(bytes).buffer);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    return { message, childCount: host.childElementCount, html: host.innerHTML };
  }, Array.from(new Uint8Array(staleFrame)));

  expect(result.message).toMatch(/unsupported command buffer version/);
  expect(result.childCount).toBe(0);
  expect(result.html).not.toContain("stale");
});

test("dispose disconnects resize observation and releases active pointer capture", async ({ page }) => {
  const dragFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 100, 100], children: ["drag"] },
    { id: "drag", kind: NodeKind.Draw, bounds: [0, 0, 20, 20], pointerDragAction: { name: "generic.drag", value: "axis:0" } },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async (bytes) => {
    let disconnects = 0;
    class ResizeObserverSpy {
      observe() {}
      disconnect() { disconnects++; }
    }
    (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = ResizeObserverSpy as unknown as typeof ResizeObserver;
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const actions: Array<{ name: string; value: string }> = [];
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!, (action: { name: string; value: string }) => actions.push(action));
    backend.renderFrame(new Uint8Array(bytes).buffer);
    const drag = document.querySelector<HTMLElement>('[data-synth-node-id="drag"]')!;
    const releases: number[] = [];
    drag.setPointerCapture = () => {};
    drag.releasePointerCapture = (pointerId) => { releases.push(pointerId); };
    drag.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9, clientX: 1, clientY: 1 }));
    backend.dispose();
    drag.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 9, clientX: 20, clientY: 1 }));
    return { actions, disconnects, releases };
  }, Array.from(new Uint8Array(dragFrame)));

  expect(result).toEqual({ actions: [], disconnects: 1, releases: [9] });
});

test("dispose is idempotent and renderFrame cannot revive a disposed backend", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const result = await page.evaluate(async (bytes) => {
    let disconnects = 0;
    class ResizeObserverSpy {
      observe() {}
      disconnect() { disconnects++; }
    }
    (window as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver = ResizeObserverSpy as unknown as typeof ResizeObserver;
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    const backend = new BrowserUiBackend(document.querySelector("#synth-root")!);
    backend.dispose();
    backend.dispose();
    let message = "no error";
    try {
      backend.renderFrame(new Uint8Array(bytes).buffer);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    return { disconnects, message };
  }, Array.from(new Uint8Array(frame)));

  expect(result).toEqual({ disconnects: 1, message: "cannot render a disposed browser UI backend" });
});

test("paints surface-space draw commands into positioned canvases", async ({ page }) => {
  const positionedFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 100, 100], children: ["draw"] },
    { id: "draw", kind: NodeKind.Draw, bounds: [40, 50, 20, 20], draws: [
      { kind: DrawKind.Fill, bounds: [40, 50, 20, 20], color: [12, 34, 56, 255] },
    ] },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const pixel = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const context = document.querySelector<HTMLCanvasElement>('[data-synth-node-id="draw"] canvas')!.getContext("2d")!;
    return Array.from(context.getImageData(1, 1, 1, 1).data);
  }, Array.from(new Uint8Array(positionedFrame)));

  expect(pixel).toEqual([12, 34, 56, 255]);
});

test("classifies both endpoints of a line in one coordinate space", async ({ page }) => {
  const positionedFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 220, 180], children: ["draw"] },
    { id: "draw", kind: NodeKind.Draw, bounds: [30, 70, 160, 100], draws: [
      { kind: DrawKind.Line,
        from: { x: 35, y: 90 },
        to: { x: 185, y: 90 },
        color: [40, 100, 230, 255],
        strokeWidth: 3 },
    ] },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const pixel = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const context = document.querySelector<HTMLCanvasElement>('[data-synth-node-id="draw"] canvas')!.getContext("2d")!;
    return Array.from(context.getImageData(5, 20, 1, 1).data);
  }, Array.from(new Uint8Array(positionedFrame)));

  expect(pixel).toEqual([40, 100, 230, 255]);
});

test("classifies a complete draw-node buffer in one coordinate space", async ({ page }) => {
  const positionedFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 220, 180], children: ["draw"] },
    { id: "draw", kind: NodeKind.Draw, bounds: [30, 70, 160, 100], draws: [
      { kind: DrawKind.Line,
        from: { x: 35, y: 90 },
        to: { x: 100, y: 90 },
        color: [230, 170, 30, 255],
        strokeWidth: 3 },
      { kind: DrawKind.Line,
        from: { x: 100, y: 100 },
        to: { x: 185, y: 100 },
        color: [40, 100, 230, 255],
        strokeWidth: 3 },
    ] },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const pixel = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const context = document.querySelector<HTMLCanvasElement>('[data-synth-node-id="draw"] canvas')!.getContext("2d")!;
    return Array.from(context.getImageData(5, 20, 1, 1).data);
  }, Array.from(new Uint8Array(positionedFrame)));

  expect(pixel).toEqual([230, 170, 30, 255]);
});

test("ignores geometry-free commands when classifying a draw-node buffer", async ({ page }) => {
  const positionedFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 100, 100], children: ["draw"] },
    { id: "draw", kind: NodeKind.Draw, bounds: [30, 40, 40, 30], draws: [
      { kind: DrawKind.FillEllipse, color: [10, 20, 30, 255] },
      { kind: DrawKind.Fill, bounds: [0, 0, 40, 30], color: [30, 180, 70, 255] },
    ] },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const pixel = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const context = document.querySelector<HTMLCanvasElement>('[data-synth-node-id="draw"] canvas')!.getContext("2d")!;
    return Array.from(context.getImageData(1, 1, 1, 1).data);
  }, Array.from(new Uint8Array(positionedFrame)));

  expect(pixel).toEqual([30, 180, 70, 255]);
});

test("fits a fixed portable surface into a narrow browser viewport", async ({ page }) => {
  await page.setViewportSize({ width: 342, height: 500 });
  const fixedFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 900, 560], children: ["button"] },
    { id: "button", kind: NodeKind.Button, bounds: [780, 500, 100, 40], label: "Edge" },
  ]);
  await page.goto("http://127.0.0.1:4173/public/index.html");
  const bounds = await page.evaluate(async (bytes) => {
    const { BrowserUiBackend } = await import("../dist/src/" + "ui.js");
    new BrowserUiBackend(document.querySelector("#synth-root")!).renderFrame(new Uint8Array(bytes).buffer);
    const root = document.querySelector('[data-synth-node-id="root"]')!.getBoundingClientRect();
    const button = document.querySelector('[data-synth-node-id="button"]')!.getBoundingClientRect();
    const host = document.querySelector("#synth-root")!.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      root: { left: root.left, right: root.right, width: root.width, height: root.height },
      button: { right: button.right, bottom: button.bottom },
      host: { width: host.width, height: host.height },
    };
  }, Array.from(new Uint8Array(fixedFrame)));

  expect(bounds.root.left).toBe(0);
  expect(bounds.root.right).toBeCloseTo(bounds.viewportWidth, 4);
  expect(bounds.root.width).toBeCloseTo(342, 4);
  expect(bounds.root.height).toBeCloseTo(560 * 342 / 900, 4);
  expect(bounds.button.right).toBeLessThanOrEqual(bounds.root.right);
  expect(bounds.button.bottom).toBeLessThanOrEqual(bounds.root.left + bounds.root.height);
  expect(bounds.host.height).toBeCloseTo(bounds.root.height, 2);
});

test("preserves semantic nodes and reports structural buffer errors", () => {
  const decoded = decodeCommandBuffer(frame);
  expect(decoded.nodes).toHaveLength(10);
  expect(() => decodeCommandBuffer(new ArrayBuffer(4))).toThrow(CommandBufferError);
});

test("carries node colour and text style behind explicit presence flags", () => {
  const styledFrame = makeCommandBuffer([
    { id: "root", kind: NodeKind.Root, bounds: [0, 0, 200, 100], children: ["styled", "plain", "transparent"] },
    {
      id: "styled", kind: NodeKind.Button, bounds: [10, 20, 80, 24],
      color: [0, 200, 0, 255], textStyle: { size: 16, color: [255, 255, 255, 255], align: 1 },
    },
    { id: "plain", kind: NodeKind.Button, bounds: [10, 50, 80, 24] },
    { id: "transparent", kind: NodeKind.Section, bounds: [10, 80, 80, 24], color: [0, 0, 0, 0] },
  ]);
  const byId = new Map(decodeCommandBuffer(styledFrame).nodes.map((node) => [node.id, node]));

  expect(byId.get("styled")!.bounds).toEqual({ x: 10, y: 20, width: 80, height: 24 });
  expect(byId.get("styled")!.color).toEqual({ r: 0, g: 200, b: 0, a: 255 });
  expect(byId.get("styled")!.textStyle).toEqual({ size: 16, color: { r: 255, g: 255, b: 255, a: 255 }, align: 1 });
  expect(byId.get("plain")!.color).toBeUndefined();
  expect(byId.get("plain")!.textStyle).toBeUndefined();
  // A sentinel colour would make this indistinguishable from "absent".
  expect(byId.get("transparent")!.color).toEqual({ r: 0, g: 0, b: 0, a: 0 });
});

test("rejects a command buffer whose version is not the shell's", () => {
  const staleFrame = makeCommandBuffer([{ id: "root", kind: NodeKind.Root, bounds: [0, 0, 10, 10] }], [], 1);
  expect(() => decodeCommandBuffer(staleFrame)).toThrow(/unsupported command buffer version/);
});
