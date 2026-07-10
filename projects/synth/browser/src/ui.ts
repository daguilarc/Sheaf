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
type CapturedPointer = { element: NodeElement; nodeId: string; action: Action; anchorX: number; anchorY: number };
type ResolvedFrame = {
  bounds: Map<string, Bounds>;
  parents: Map<string, string>;
  rootId?: string;
  width: number;
  height: number;
};
export type ActionDispatcher = (action: Action) => void;

const DEFAULT_BUTTON_WIDTH = 72;
const DEFAULT_BUTTON_HEIGHT = 28;
const DEFAULT_SLIDER_WIDTH = 140;
const DEFAULT_SLIDER_HEIGHT = 28;
const DEFAULT_LABEL_HEIGHT = 22;
const DEFAULT_COMBO_WIDTH = 160;
const DEFAULT_TEXT_FIELD_WIDTH = 120;
const CONTROL_GAP = 8;
const CONTROL_MARGIN = 12;

export class BrowserUiBackend {
  private readonly elements = new Map<string, NodeElement>();
  private readonly capturedPointers = new Map<number, CapturedPointer>();
  private readonly resizeObserver: ResizeObserver;
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
    const frame = buffer instanceof ArrayBuffer ? decodeCommandBuffer(buffer) : buffer;
    const nodes = new Map(frame.nodes.map((node) => [node.id, node]));
    const resolved = resolveFrameBounds(frame.nodes, nodes);
    for (const node of frame.nodes) {
      const absoluteBounds = resolved.bounds.get(node.id) ?? node.bounds;
      const parentBounds = resolved.parents.has(node.id) ? resolved.bounds.get(resolved.parents.get(node.id)!) : undefined;
      this.updateNode(node, absoluteBounds, parentBounds);
    }
    for (const [id, element] of this.elements) {
      if (nodes.has(id)) continue;
      this.removePointerGesture(element);
      element.remove();
      this.elements.delete(id);
    }
    const rootNode = resolved.rootId ? nodes.get(resolved.rootId) : undefined;
    this.root.replaceChildren(...(rootNode ? [this.elementFor(rootNode)] : []));
    for (const node of frame.nodes)
      if (node.kind === NodeKind.Root || node.kind === NodeKind.Row || node.kind === NodeKind.Section || node.kind === NodeKind.ScrollArea)
        this.attachChildren(node, nodes);
    for (const node of frame.nodes) {
      if (node.kind !== NodeKind.Draw) continue;
      this.paint(this.elementFor(node).querySelector("canvas")!, frame.drawCommands.slice(node.drawStart, node.drawStart + node.drawCount), resolved.bounds.get(node.id) ?? node.bounds);
    }
    this.surfaceRootId = resolved.rootId;
    this.surfaceWidth = resolved.width;
    this.surfaceHeight = resolved.height;
    this.fitSurface();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    for (const pointerId of [...this.capturedPointers.keys()]) this.clearPointer(pointerId, true);
    for (const element of this.elements.values()) this.removePointerGesture(element);
  }

  private updateNode(node: Node, bounds: Bounds, parentBounds?: Bounds) {
    const element = this.elementFor(node);
    element.synthNode = node;
    element.dataset.synthNodeId = node.id;
    element.dataset.synthNodeKind = NodeKind[node.kind].replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, "");
    element.style.position = "absolute";
    element.style.left = `${bounds.x - (parentBounds?.x ?? 0)}px`;
    element.style.top = `${bounds.y - (parentBounds?.y ?? 0)}px`;
    element.style.transform = "";
    element.style.transformOrigin = "";
    element.style.width = bounds.width > 0 ? `${bounds.width}px` : "";
    element.style.height = bounds.height > 0 ? `${bounds.height}px` : "";
    element.toggleAttribute("aria-disabled", !node.enabled);
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
    if (node.kind === NodeKind.Toggle) { const input = document.createElement("input"); input.type = "checkbox"; element.append(input, document.createElement("span")); input.addEventListener("change", () => this.dispatchValue(element, input.checked ? "true" : "false")); }
    if (node.kind === NodeKind.Slider) { const input = document.createElement("input"); input.type = "range"; element.append(input); input.addEventListener("input", () => this.dispatchValue(element, input.value)); }
    if (node.kind === NodeKind.ComboBox) { const select = document.createElement("select"); element.append(select); select.addEventListener("change", () => this.dispatchValue(element, select.value)); }
    if (node.kind === NodeKind.TextField) { const input = document.createElement("input"); input.type = "text"; element.append(input); input.addEventListener("input", () => this.dispatchValue(element, input.value)); }
    if (node.kind === NodeKind.Draw) { const canvas = document.createElement("canvas"); element.append(canvas); canvas.addEventListener("dblclick", () => this.dispatchDoubleClick(element)); }
    if (node.kind === NodeKind.ScrollArea) { const content = document.createElement("div"); content.style.position = "relative"; element.scrollContent = content; element.append(content); element.style.overflow = "auto"; }
    if (node.kind === NodeKind.Button) element.addEventListener("click", () => this.dispatchValue(element));
    if (node.kind === NodeKind.Row) element.addEventListener("dblclick", () => this.dispatchDoubleClick(element));
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
    const action = element.synthNode?.pointerDragAction;
    if (!action) return;
    this.clearPointer(event.pointerId, true);
    element.setPointerCapture(event.pointerId);
    this.capturedPointers.set(event.pointerId, {
      element,
      nodeId: element.synthNode!.id,
      action: { ...action },
      anchorX: event.clientX / this.surfaceScale,
      anchorY: event.clientY / this.surfaceScale,
    });
  }

  private continuePointerDrag(element: NodeElement, event: PointerEvent) {
    const captured = this.capturedPointers.get(event.pointerId);
    if (!captured || captured.element !== element) return;
    const currentX = event.clientX / this.surfaceScale;
    const currentY = event.clientY / this.surfaceScale;
    const delta = ((currentX - captured.anchorX) - (currentY - captured.anchorY)) * 0.0025;
    if (Math.abs(delta) < 0.001) return;
    this.dispatchDrag(captured.action, delta);
    captured.anchorX = currentX;
    captured.anchorY = currentY;
  }

  private clearPointer(pointerId: number, releaseCapture: boolean) {
    const captured = this.capturedPointers.get(pointerId);
    if (!captured) return;
    this.capturedPointers.delete(pointerId);
    if (releaseCapture) {
      try { captured.element.releasePointerCapture(pointerId); } catch { /* Capture may already have been released by the browser. */ }
    }
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
    if (node.kind === NodeKind.ComboBox) { const select = element.querySelector("select")!; select.replaceChildren(...node.options.map((option) => { const value = new Option(option.label, option.id); value.selected = option.id === node.selectedOption; return value; })); select.disabled = !node.enabled; }
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
    parent.replaceChildren(...node.children.map((child) => this.elementFor(nodes.get(child)!)));
  }

  private dispatchValue(element: NodeElement, value?: string) { const action = element.synthNode?.action; if (action) this.dispatchBrowserAction({ name: action.name, value: value ?? action.value }); }
  private dispatchDoubleClick(element: NodeElement) { const action = element.synthNode?.doubleClickAction; if (action) this.dispatchBrowserAction(action); }
  private dispatchDrag(action: Action, delta: number) { const separator = action.value.lastIndexOf(":"); this.dispatchBrowserAction({ name: action.name, value: separator < 0 ? String(delta) : `${action.value.slice(0, separator + 1)}${delta}` }); }

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
    context.translate(-bounds.x, -bounds.y);
    for (const command of commands) this.draw(context, command, bounds);
  }

  private draw(context: CanvasRenderingContext2D, command: DrawCommand, nodeBounds: Bounds) {
    const fill = colorCss(command.color); const stroke = colorCss(command.color); const b = command.bounds;
    const hasBounds = b.width > 0 && b.height > 0;
    context.fillStyle = fill; context.strokeStyle = stroke; context.lineWidth = command.strokeWidth;
    switch (command.kind) {
      case DrawKind.Fill: context.fillRect(hasBounds ? b.x : nodeBounds.x, hasBounds ? b.y : nodeBounds.y, hasBounds ? b.width : nodeBounds.width, hasBounds ? b.height : nodeBounds.height); break;
      case DrawKind.StrokeRect: context.strokeRect(b.x, b.y, b.width, b.height); break;
      case DrawKind.Line: context.beginPath(); context.moveTo(command.from.x, command.from.y); context.lineTo(command.to.x, command.to.y); context.stroke(); break;
      case DrawKind.Arc:
        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.beginPath();
        context.arc(b.x + b.width / 2, b.y + b.height / 2, Math.min(b.width, b.height) / 2, command.startRadians, command.endRadians);
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

function resolveFrameBounds(nodesInOrder: Node[], nodes: Map<string, Node>): ResolvedFrame {
  if (nodes.size !== nodesInOrder.length) throw new Error("duplicate node id in browser UI frame");
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

  const parents = new Map<string, string>();
  for (const node of nodesInOrder) {
    for (const childId of node.children) {
      const existing = parents.get(childId);
      if (existing && existing !== node.id) throw new Error(`node ${childId} has multiple parents`);
      parents.set(childId, node.id);
    }
  }
  const roots = nodesInOrder.filter((node) => !parents.has(node.id));
  if (nodesInOrder.length > 0 && roots.length !== 1) throw new Error(`browser UI frame requires one parentless root, found ${roots.length}`);
  if (roots[0] && roots[0].kind !== NodeKind.Root) throw new Error("parentless browser UI node must be a root");

  const nearestRoots = new Map<string, string>();
  const assignNearestRoot = (node: Node, nearestRootId: string) => {
    const nextRootId = node.kind === NodeKind.Root ? node.id : nearestRootId;
    nearestRoots.set(node.id, nextRootId);
    for (const childId of node.children) assignNearestRoot(nodes.get(childId)!, nextRootId);
  };
  if (roots[0]) assignNearestRoot(roots[0], roots[0].id);

  const resolved = new Map(nodesInOrder.map((node) => [node.id, { ...node.bounds }]));
  const cursors = new Map<string, { x: number; y: number; rowHeight: number; right: number; availableWidth: number }>();
  for (const node of nodesInOrder) {
    if (hasExplicitBounds(node.bounds) || node.kind === NodeKind.Root) continue;
    const nearestRoot = nodes.get(nearestRoots.get(node.id)!)!;
    let cursor = cursors.get(nearestRoot.id);
    if (!cursor) {
      let maxDrawBottom = nearestRoot.bounds.y + CONTROL_MARGIN;
      for (const candidate of nodesInOrder) {
        if (candidate.kind === NodeKind.Draw && nearestRoots.get(candidate.id) === nearestRoot.id && hasExplicitBounds(candidate.bounds))
          maxDrawBottom = Math.max(maxDrawBottom, candidate.bounds.y + candidate.bounds.height);
      }
      cursor = {
        x: nearestRoot.bounds.x + CONTROL_MARGIN,
        y: maxDrawBottom + CONTROL_GAP,
        rowHeight: 0,
        right: nearestRoot.bounds.x + nearestRoot.bounds.width - CONTROL_MARGIN,
        availableWidth: Math.max(0, nearestRoot.bounds.width - CONTROL_MARGIN * 2),
      };
      cursors.set(nearestRoot.id, cursor);
    }
    const size = defaultSize(node, cursor.availableWidth);
    if (cursor.x + size.width > cursor.right && cursor.rowHeight > 0) {
      cursor.x = nearestRoot.bounds.x + CONTROL_MARGIN;
      cursor.y += cursor.rowHeight + CONTROL_GAP;
      cursor.rowHeight = 0;
    }
    resolved.set(node.id, { x: cursor.x, y: cursor.y, width: size.width, height: size.height });
    cursor.x += size.width + CONTROL_GAP;
    cursor.rowHeight = Math.max(cursor.rowHeight, size.height);
  }

  let width = 0;
  let height = 0;
  for (const bounds of resolved.values()) {
    width = Math.max(width, bounds.x + bounds.width);
    height = Math.max(height, bounds.y + bounds.height);
  }
  return { bounds: resolved, parents, rootId: roots[0]?.id, width, height };
}

function hasExplicitBounds(bounds: Bounds) { return bounds.width > 0 && bounds.height > 0; }

function defaultSize(node: Node, availableWidth: number): Pick<Bounds, "width" | "height"> {
  switch (node.kind) {
    case NodeKind.Slider: return { width: DEFAULT_SLIDER_WIDTH, height: DEFAULT_SLIDER_HEIGHT };
    case NodeKind.ComboBox: return { width: DEFAULT_COMBO_WIDTH, height: DEFAULT_BUTTON_HEIGHT };
    case NodeKind.TextField: return { width: DEFAULT_TEXT_FIELD_WIDTH, height: DEFAULT_BUTTON_HEIGHT };
    case NodeKind.Button: return { width: Math.max(DEFAULT_BUTTON_WIDTH, node.label.length * 6.5 + 24), height: DEFAULT_BUTTON_HEIGHT };
    case NodeKind.Toggle: return { width: Math.max(DEFAULT_BUTTON_WIDTH, node.label.length * 6.5 + 25), height: DEFAULT_BUTTON_HEIGHT };
    case NodeKind.Label:
    case NodeKind.StatusText: return { width: Math.min(availableWidth, Math.max(120, (node.text || node.label).length * 6.5 + 12)), height: DEFAULT_LABEL_HEIGHT };
    default: return { width: DEFAULT_BUTTON_WIDTH, height: DEFAULT_BUTTON_HEIGHT };
  }
}

function colorCss(color: Color) { return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`; }
function path(context: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) { context.beginPath(); if (points[0]) { context.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) context.lineTo(point.x, point.y); } }
function roundedRect(context: CanvasRenderingContext2D, bounds: { x: number; y: number; width: number; height: number }, radius: number) { context.beginPath(); context.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius); }
