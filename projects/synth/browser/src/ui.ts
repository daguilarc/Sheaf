import { Action, CommandBufferError, CommandBufferFrame, Color, DrawCommand, DrawKind, Node, NodeKind, decodeCommandBuffer } from "./protocol.js";
import type { Bounds } from "./protocol.js";

export { CommandBufferError, decodeCommandBuffer } from "./protocol.js";
export type { Action, CommandBufferFrame } from "./protocol.js";

type PointerHandlers = {
  down: (event: PointerEvent) => void;
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  cancel: (event: PointerEvent) => void;
  lostCapture: (event: PointerEvent) => void;
};
type NodeElement = HTMLElement & { synthNode?: Node; scrollContent?: HTMLElement; pointerHandlers?: PointerHandlers };
type CapturedPointer = { element: NodeElement; action: Action; anchorClientX: number; anchorClientY: number };
type PendingDrag = { action: Action; delta: number };
// The surface the frame resolves to: which node is the parentless root, and the
// extent the host is sized to. Nothing else needs resolving — every node's
// bounds are already in its parent's space (sru-46), so the DOM's own
// absolute-positioning-within-a-positioned-parent does the fold.
type ResolvedSurface = { rootId?: string; width: number; height: number };
export type ActionDispatcher = (action: Action) => void;

export class BrowserUiBackend {
  private readonly elements = new Map<string, NodeElement>();
  private readonly capturedPointers = new Map<number, CapturedPointer>();
  private readonly pendingDrags = new Map<string, PendingDrag>();
  private readonly resizeObserver: ResizeObserver;
  private dragFrame = 0;
  private surfaceRootId?: string;
  private surfaceWidth = 0;
  private surfaceHeight = 0;
  private surfaceScale = 1;
  private disposed = false;
  constructor(private readonly root: HTMLElement, private readonly dispatchBrowserAction: ActionDispatcher = () => {}) {
    this.root.style.position = "relative";
    this.resizeObserver = new ResizeObserver(() => this.fitSurface());
    this.resizeObserver.observe(root);
  }

  renderFrame(buffer: ArrayBuffer | CommandBufferFrame) {
    if (this.disposed) throw new Error("cannot render a disposed browser UI backend");
    const frame = buffer instanceof ArrayBuffer ? decodeCommandBuffer(buffer) : buffer;
    const nodes = new Map(frame.nodes.map((node) => [node.id, node]));
    const surface = resolveFrameSurface(frame.nodes, nodes);
    for (const node of frame.nodes) this.updateNode(node);
    for (const [id, element] of this.elements) {
      if (nodes.has(id)) continue;
      this.removePointerGesture(element);
      element.remove();
      this.elements.delete(id);
    }
    const rootNode = surface.rootId ? nodes.get(surface.rootId) : undefined;
    this.replaceChildrenIfChanged(this.root, rootNode ? [this.elementFor(rootNode)] : []);
    for (const node of frame.nodes)
      if (node.kind === NodeKind.Root || node.kind === NodeKind.Row || node.kind === NodeKind.Section || node.kind === NodeKind.ScrollArea)
        this.attachChildren(node, nodes);
    for (const node of frame.nodes) {
      if (node.kind !== NodeKind.Draw) continue;
      this.paint(this.elementFor(node).querySelector("canvas")!, frame.drawCommands.slice(node.drawStart, node.drawStart + node.drawCount), node.bounds);
    }
    this.surfaceRootId = surface.rootId;
    this.surfaceWidth = surface.width;
    this.surfaceHeight = surface.height;
    this.fitSurface();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.dragFrame !== 0) cancelAnimationFrame(this.dragFrame);
    this.dragFrame = 0;
    this.pendingDrags.clear();
    this.resizeObserver.disconnect();
    for (const pointerId of [...this.capturedPointers.keys()]) this.clearPointer(pointerId, true);
    for (const element of this.elements.values()) this.removePointerGesture(element);
  }

  private updateNode(node: Node) {
    const element = this.elementFor(node);
    const kind = kindAttribute(node.kind);
    element.synthNode = node;
    element.dataset.synthNodeId = node.id;
    element.dataset.synthNodeKind = kind;
    element.dataset.nodeId = node.id;
    element.dataset.nodeKind = kind;
    element.style.position = "absolute";
    // Bounds are parent-relative (sru-46) and this element is an absolutely
    // positioned child of its parent's element, which is what parent-relative
    // means in the DOM. So the CSS offset is the wire value itself: no origin
    // subtraction, no coordinate-space classification.
    element.style.left = `${node.bounds.x}px`;
    element.style.top = `${node.bounds.y}px`;
    element.style.transform = "";
    element.style.transformOrigin = "";
    // A node arriving with no resolved bounds renders at its parent's origin
    // with zero extent (sprs-6). The backend never flows or sizes it.
    element.style.width = `${node.bounds.width}px`;
    element.style.height = `${node.bounds.height}px`;
    const acceptsPointer = acceptsPointerEvents(node);
    element.style.pointerEvents = acceptsPointer ? "auto" : "none";
    element.style.zIndex = acceptsPointer ? "1" : "0";
    if (node.enabled) element.removeAttribute("aria-disabled");
    else element.setAttribute("aria-disabled", "true");
    applyCarriedStyle(element, node);
    this.updateControl(element, node);
    this.updatePointerGesture(element, node);
  }

  private elementFor(node: Node): NodeElement {
    const existing = this.elements.get(node.id);
    if (existing) return existing;
    const element = this.createElement(node);
    this.elements.set(node.id, element);
    return element;
  }

  private createElement(node: Node): NodeElement {
    const element = document.createElement(node.kind === NodeKind.Button ? "button" : node.kind === NodeKind.Section ? "section" : "div") as NodeElement;
    if (node.kind === NodeKind.Toggle) { const input = document.createElement("input"); input.type = "checkbox"; element.append(input, document.createElement("span")); input.addEventListener("change", () => this.dispatchValue(element, input.checked ? "1" : "0")); }
    if (node.kind === NodeKind.Slider) { const input = document.createElement("input"); input.type = "range"; element.append(input); input.addEventListener("input", () => this.dispatchValue(element, input.value)); }
    if (node.kind === NodeKind.ComboBox) { const select = document.createElement("select"); element.append(select); select.addEventListener("change", () => this.dispatchValue(element, select.value)); }
    if (node.kind === NodeKind.TextField) { const input = document.createElement("input"); input.type = "text"; element.append(input); input.addEventListener("input", () => this.dispatchValue(element, input.value)); }
    if (node.kind === NodeKind.Draw) { const canvas = document.createElement("canvas"); element.append(canvas); }
    if (node.kind === NodeKind.ScrollArea) { const content = document.createElement("div"); content.style.position = "relative"; element.scrollContent = content; element.append(content); element.style.overflow = "auto"; }
    if (node.kind === NodeKind.Button) element.addEventListener("click", () => this.dispatchValue(element));
    element.addEventListener("dblclick", () => this.dispatchDoubleClick(element));
    return element;
  }

  private updatePointerGesture(element: NodeElement, node: Node) {
    if (node.pointerDragAction && !element.pointerHandlers) {
      const handlers: PointerHandlers = {
        down: (event) => this.beginPointerDrag(element, event),
        move: (event) => this.continuePointerDrag(element, event),
        up: (event) => this.clearPointer(event.pointerId, true),
        cancel: (event) => this.clearPointer(event.pointerId, true),
        lostCapture: (event) => this.clearPointer(event.pointerId, false),
      };
      element.addEventListener("pointerdown", handlers.down);
      element.addEventListener("pointermove", handlers.move);
      element.addEventListener("pointerup", handlers.up);
      element.addEventListener("pointercancel", handlers.cancel);
      element.addEventListener("lostpointercapture", handlers.lostCapture);
      element.pointerHandlers = handlers;
    } else if (!node.pointerDragAction && element.pointerHandlers) {
      this.removePointerGesture(element);
    }
  }

  private beginPointerDrag(element: NodeElement, event: PointerEvent) {
    const action = enabledNodeOf(element)?.pointerDragAction;
    if (!action) return;
    for (const captured of this.capturedPointers.values())
      if (captured.element === element) return;
    this.clearPointer(event.pointerId, true);
    try { element.setPointerCapture(event.pointerId); } catch { return; }
    this.capturedPointers.set(event.pointerId, {
      element,
      action: { ...action },
      anchorClientX: event.clientX,
      anchorClientY: event.clientY,
    });
  }

  private continuePointerDrag(element: NodeElement, event: PointerEvent) {
    const captured = this.capturedPointers.get(event.pointerId);
    if (!captured || captured.element !== element) return;
    if (!enabledNodeOf(element)) return this.clearPointer(event.pointerId, true);
    const delta = (((event.clientX - captured.anchorClientX) / this.surfaceScale) -
      ((event.clientY - captured.anchorClientY) / this.surfaceScale)) * 0.0025;
    if (Math.abs(delta) < 0.001) return;
    this.dispatchDrag(captured.action, delta);
    captured.anchorClientX = event.clientX;
    captured.anchorClientY = event.clientY;
  }

  private clearPointer(pointerId: number, releaseCapture: boolean) {
    const captured = this.capturedPointers.get(pointerId);
    if (!captured) return;
    this.capturedPointers.delete(pointerId);
    if (releaseCapture) {
      try { captured.element.releasePointerCapture(pointerId); } catch { /* Capture may already have been released by the browser. */ }
    }
    this.flushDrags();
  }

  private removePointerGesture(element: NodeElement) {
    const handlers = element.pointerHandlers;
    if (!handlers) return;
    for (const [pointerId, captured] of this.capturedPointers)
      if (captured.element === element) this.clearPointer(pointerId, true);
    element.removeEventListener("pointerdown", handlers.down);
    element.removeEventListener("pointermove", handlers.move);
    element.removeEventListener("pointerup", handlers.up);
    element.removeEventListener("pointercancel", handlers.cancel);
    element.removeEventListener("lostpointercapture", handlers.lostCapture);
    delete element.pointerHandlers;
  }

  private updateControl(element: NodeElement, node: Node) {
    if (node.kind === NodeKind.Button) { element.textContent = node.label; element.toggleAttribute("disabled", !node.enabled); }
    if (node.kind === NodeKind.Label || node.kind === NodeKind.StatusText) element.textContent = node.text || node.label;
    if (node.kind === NodeKind.Toggle) { const input = element.querySelector("input")!; input.checked = node.checked; input.disabled = !node.enabled; element.querySelector("span")!.textContent = node.label; }
    if (node.kind === NodeKind.Slider) {
      const input = element.querySelector("input")!;
      input.min = String(node.minValue); input.max = String(node.maxValue); input.step = String(node.step);
      if (document.activeElement !== input) input.value = String(node.value);
      input.disabled = !node.enabled;
    }
    if (node.kind === NodeKind.ComboBox) {
      const select = element.querySelector("select")!;
      const optionsChanged = select.options.length !== node.options.length ||
        node.options.some((option, index) => select.options[index]?.value !== option.id || select.options[index]?.textContent !== option.label);
      if (optionsChanged)
        select.replaceChildren(...node.options.map((option) => new Option(option.label, option.id)));
      if (document.activeElement !== select) select.value = node.selectedOption;
      select.disabled = !node.enabled;
    }
    if (node.kind === NodeKind.TextField) {
      const input = element.querySelector("input")!;
      if (document.activeElement !== input) input.value = node.text;
      input.disabled = !node.enabled;
    }
    if (node.kind === NodeKind.ScrollArea && element.scrollContent) { element.scrollContent.style.width = `${Math.max(node.bounds.width, node.scrollContentWidth)}px`; element.scrollContent.style.height = `${Math.max(node.bounds.height, node.scrollContentHeight)}px`; }
  }

  private attachChildren(node: Node, nodes: Map<string, Node>) {
    const element = this.elementFor(node);
    const parent = element.scrollContent ?? element;
    this.replaceChildrenIfChanged(parent, node.children.map((child) => this.elementFor(nodes.get(child)!)));
  }

  private replaceChildrenIfChanged(parent: HTMLElement, children: HTMLElement[]) {
    const current = Array.from(parent.children);
    if (current.length === children.length && current.every((child, index) => child === children[index])) return;
    parent.replaceChildren(...children);
  }

  private dispatchValue(element: NodeElement, value?: string) {
    const action = enabledNodeOf(element)?.action;
    if (!action) return;
    this.dispatchBrowserAction({ name: action.name, value: value === undefined ? action.value : appendActionValue(action.value, value) });
  }
  private dispatchDoubleClick(element: NodeElement) { const action = enabledNodeOf(element)?.doubleClickAction; if (action) this.dispatchBrowserAction(action); }
  private dispatchDrag(action: Action, delta: number) {
    const separator = action.value.lastIndexOf(":");
    const prefix = separator < 0 ? "" : action.value.slice(0, separator + 1);
    const key = `${action.name}\0${prefix}`;
    const pending = this.pendingDrags.get(key);
    if (pending) pending.delta += delta;
    else this.pendingDrags.set(key, { action: { name: action.name, value: prefix }, delta });
    if (this.dragFrame !== 0) return;
    this.dragFrame = requestAnimationFrame(() => this.flushDrags());
  }

  private flushDrags() {
    if (this.dragFrame !== 0) {
      cancelAnimationFrame(this.dragFrame);
      this.dragFrame = 0;
    }
    this.dragFrame = 0;
    const drags = [...this.pendingDrags.values()];
    this.pendingDrags.clear();
    for (const drag of drags) {
      if (Math.abs(drag.delta) < 0.001) continue;
      this.dispatchBrowserAction({ name: drag.action.name, value: `${drag.action.value}${drag.delta}` });
    }
  }

  private fitSurface() {
    const availableWidth = this.root.clientWidth;
    this.surfaceScale = availableWidth > 0 && this.surfaceWidth > 0 ? Math.min(1, availableWidth / this.surfaceWidth) : 1;
    if (this.surfaceRootId) {
      const element = this.elements.get(this.surfaceRootId);
      if (element) {
        element.style.transformOrigin = "0 0";
        element.style.transform = `scale(${this.surfaceScale})`;
      }
    }
    this.root.style.height = `${this.surfaceHeight * this.surfaceScale}px`;
  }

  private paint(canvas: HTMLCanvasElement, commands: DrawCommand[], bounds: Bounds) {
    canvas.width = Math.max(1, Math.round(bounds.width)); canvas.height = Math.max(1, Math.round(bounds.height));
    canvas.style.width = "100%"; canvas.style.height = "100%";
    const context = canvas.getContext("2d")!;
    // Draw geometry is relative to the owning node's own origin (sru-46), and
    // the canvas already spans exactly that node, so the canvas origin is the
    // node origin. No translation and no classification of the commands.
    const nodeExtent: Bounds = { x: 0, y: 0, width: bounds.width, height: bounds.height };
    for (const command of commands) this.draw(context, command, nodeExtent);
  }

  private draw(context: CanvasRenderingContext2D, command: DrawCommand, nodeExtent: Bounds) {
    const fill = colorCss(command.color); const stroke = colorCss(command.color); const b = command.bounds;
    context.fillStyle = fill; context.strokeStyle = stroke; context.lineWidth = command.strokeWidth;
    switch (command.kind) {
      case DrawKind.Fill: {
        // A fill with no geometry of its own covers the whole node.
        const area = hasExplicitBounds(b) ? b : nodeExtent;
        context.fillRect(area.x, area.y, area.width, area.height); break;
      }
      case DrawKind.StrokeRect: context.strokeRect(b.x, b.y, b.width, b.height); break;
      case DrawKind.Line:
        context.beginPath(); context.moveTo(command.from.x, command.from.y); context.lineTo(command.to.x, command.to.y); context.stroke(); break;
      case DrawKind.Arc:
        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.beginPath();
        context.arc(b.x + b.width / 2, b.y + b.height / 2, Math.min(b.width, b.height) / 2, portableAngleToCanvas(command.startRadians), portableAngleToCanvas(command.endRadians));
        context.stroke();
        context.restore();
        break;
      case DrawKind.Text: context.fillStyle = colorCss(command.textColor); context.font = `${command.textSize}px sans-serif`; context.textAlign = command.align === 1 ? "center" : command.align === 2 ? "right" : "left"; context.fillText(command.text, command.align === 1 ? b.x + b.width / 2 : command.align === 2 ? b.x + b.width : b.x, b.y + command.textSize); break;
      case DrawKind.FillEllipse: context.beginPath(); context.ellipse(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2, 0, 0, Math.PI * 2); context.fill(); break;
      case DrawKind.StrokeEllipse: context.beginPath(); context.ellipse(b.x + b.width / 2, b.y + b.height / 2, b.width / 2, b.height / 2, 0, 0, Math.PI * 2); context.stroke(); break;
      case DrawKind.FillRoundedRect: roundedRect(context, b, command.cornerRadius); context.fill(); break;
      case DrawKind.StrokeRoundedRect: roundedRect(context, b, command.cornerRadius); context.stroke(); break;
      case DrawKind.Polyline: path(context, command.points); context.stroke(); break;
      case DrawKind.FillPolygon: path(context, command.points); context.fill(); break;
    }
  }
}

// Validates the frame's node graph and reports the surface it resolves to. No
// bounds arithmetic: every node's bounds are already the coordinates its DOM
// element needs, and the host extent is the root's own resolved extent.
function resolveFrameSurface(nodesInOrder: Node[], nodes: Map<string, Node>): ResolvedSurface {
  if (nodes.size !== nodesInOrder.length) throw new Error("duplicate node id in browser UI frame");
  const parents = new Map<string, string>();
  let multipleParentError: string | undefined;
  for (const node of nodesInOrder) {
    for (const childId of node.children) {
      if (!nodes.has(childId)) throw new Error(`unknown child node ${childId}`);
      const existing = parents.get(childId);
      if (existing && existing !== node.id) multipleParentError ??= `node ${childId} has multiple parents`;
      else parents.set(childId, node.id);
    }
  }
  const roots = nodesInOrder.filter((node) => !parents.has(node.id));
  if (nodesInOrder.length > 0 && roots.length !== 1) throw new Error(`browser UI frame requires one parentless root, found ${roots.length}`);
  if (roots[0] && roots[0].kind !== NodeKind.Root) throw new Error("parentless browser UI node must be a root");

  const states = new Map<string, "visiting" | "visited">();
  const visit = (node: Node) => {
    const state = states.get(node.id);
    if (state === "visiting") throw new Error(`cycle in browser UI frame at ${node.id}`);
    if (state === "visited") return;
    states.set(node.id, "visiting");
    for (const childId of node.children) {
      const child = nodes.get(childId);
      if (!child) throw new Error(`unknown child node ${childId}`);
      visit(child);
    }
    states.set(node.id, "visited");
  };
  for (const node of nodesInOrder) visit(node);
  if (multipleParentError) throw new Error(multipleParentError);

  // The host extent is the resolved root extent, never the union of flowed
  // content (sprs-6). Nothing the backend does can place content below it.
  const root = roots[0];
  return { rootId: root?.id, width: root?.bounds.width ?? 0, height: root?.bounds.height ?? 0 };
}

function hasExplicitBounds(bounds: Bounds) { return bounds.width > 0 && bounds.height > 0; }

function kindAttribute(kind: NodeKind) {
  return NodeKind[kind].replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, "");
}

// Per-node custom properties rather than per-surface inline styles: one carried
// value, and `synth-browser.css` decides which surface it paints for each kind
// (sru-45's per-kind table). The properties are set on *every* node, absent
// ones to `initial`, because custom properties inherit — otherwise a container's
// carried fill would leak into an unstyled descendant.
function applyCarriedStyle(element: NodeElement, node: Node) {
  // `Draw` carries no node colour: its commands carry their own (sru-45).
  const carried = node.kind === NodeKind.Draw ? undefined : node.color;
  // A checked toggle reads as selected, as it does in the JUCE backend.
  const selected = node.selected || (node.kind === NodeKind.Toggle && node.checked);
  const fill = carried && stateColor(carried, selected, node.enabled);
  setCarriedProperty(element, "--synth-fill", fill && colorCss(fill));
  setCarriedProperty(element, "--synth-fill-hover", fill && colorCss(brighter(fill, 0.14)));
  // Pressed brightens the carried colour itself, matching the JUCE backend's
  // `buttonOnColourId`, so it does not compound with the selected fold.
  setCarriedProperty(element, "--synth-fill-active", carried && colorCss(brighter(carried, 0.24)));
  setCarriedProperty(element, "--synth-glyph", node.textStyle && colorCss(node.textStyle.color));
  setCarriedProperty(element, "--synth-text-size", node.textStyle && `${node.textStyle.size}px`);
  setCarriedProperty(element, "--synth-text-align", node.textStyle && flexAlignment(node.textStyle.align));
}

// `initial` on a custom property is the guaranteed-invalid value, so every
// `var(--synth-*, default)` in the stylesheet falls back to the backend's own
// default look for a node that carries nothing.
function setCarriedProperty(element: NodeElement, name: string, value?: string) {
  element.style.setProperty(name, value ?? "initial");
}

function flexAlignment(align: number) { return align === 1 ? "center" : align === 2 ? "flex-end" : "flex-start"; }

// Selected and disabled presentation is derived from the carried colour, never
// substituted from a palette (sru-45). Mirrors `StateColourFor` in
// `PortableJuceBackend.hpp` so both backends land on the same bytes.
function stateColor(color: Color, selected: boolean, enabled: boolean): Color {
  if (!enabled) return withMultipliedAlpha(darker(color, 0.35), 0.65);
  return selected ? brighter(color, 0.14) : color;
}
// `juce::Colour::brighter`/`darker`: one factor over each channel's distance
// from its limit, truncated to a byte.
function brighter(color: Color, amount: number): Color {
  const factor = 1 / (1 + amount);
  const channel = (value: number) => Math.trunc(255 - factor * (255 - value));
  return { r: channel(color.r), g: channel(color.g), b: channel(color.b), a: color.a };
}
function darker(color: Color, amount: number): Color {
  const factor = 1 / (1 + amount);
  const channel = (value: number) => Math.trunc(factor * value);
  return { r: channel(color.r), g: channel(color.g), b: channel(color.b), a: color.a };
}
// `juce::Colour::withMultipliedAlpha` rounds where the channel casts truncate.
function withMultipliedAlpha(color: Color, factor: number): Color {
  return { ...color, a: Math.min(255, Math.max(0, Math.round(color.a * factor))) };
}

function enabledNodeOf(element: NodeElement) { const node = element.synthNode; return node?.enabled ? node : undefined; }
function colorCss(color: Color) { return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`; }
function appendActionValue(prefix: string, value: string) { return prefix.length > 0 ? `${prefix}:${value}` : value; }
function portableAngleToCanvas(radians: number) { return radians - Math.PI / 2; }
function acceptsPointerEvents(node: Node) {
  return node.kind === NodeKind.Button || node.kind === NodeKind.Toggle || node.kind === NodeKind.Slider ||
    node.kind === NodeKind.ComboBox || node.kind === NodeKind.TextField || node.kind === NodeKind.ScrollArea ||
    Boolean(node.action || node.pointerDragAction || node.doubleClickAction);
}
function path(context: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) { context.beginPath(); if (points[0]) { context.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) context.lineTo(point.x, point.y); } }
function roundedRect(context: CanvasRenderingContext2D, bounds: { x: number; y: number; width: number; height: number }, radius: number) { context.beginPath(); context.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius); }
