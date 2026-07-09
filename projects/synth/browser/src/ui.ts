import { Action, CommandBufferError, CommandBufferFrame, Color, DrawCommand, DrawKind, Node, NodeKind, decodeCommandBuffer } from "./protocol.js";

export { CommandBufferError, decodeCommandBuffer } from "./protocol.js";
export type { Action, CommandBufferFrame } from "./protocol.js";

type NodeElement = HTMLElement & { synthNode?: Node; scrollContent?: HTMLElement };
export type ActionDispatcher = (action: Action) => void;

export class BrowserUiBackend {
  private readonly elements = new Map<string, NodeElement>();
  constructor(private readonly root: HTMLElement, private readonly dispatchBrowserAction: ActionDispatcher = () => {}) {
    this.root.style.position = "relative";
  }

  renderFrame(buffer: ArrayBuffer | CommandBufferFrame) {
    const frame = buffer instanceof ArrayBuffer ? decodeCommandBuffer(buffer) : buffer;
    const nodes = new Map(frame.nodes.map((node) => [node.id, node]));
    for (const node of frame.nodes) this.updateNode(node);
    for (const [id, element] of this.elements) if (!nodes.has(id)) { element.remove(); this.elements.delete(id); }
    const childIds = new Set(frame.nodes.flatMap((node) => node.children));
    const roots = frame.nodes.filter((node) => !childIds.has(node.id));
    this.root.replaceChildren(...roots.map((node) => this.elementFor(node)));
    for (const node of frame.nodes)
      if (node.kind === NodeKind.Root || node.kind === NodeKind.Row || node.kind === NodeKind.Section || node.kind === NodeKind.ScrollArea)
        this.attachChildren(node, nodes);
    for (const node of frame.nodes) if (node.kind === NodeKind.Draw) this.paint(this.elementFor(node).querySelector("canvas")!, frame.drawCommands.slice(node.drawStart, node.drawStart + node.drawCount));
  }

  private updateNode(node: Node) {
    const element = this.elementFor(node);
    element.synthNode = node;
    element.dataset.synthNodeId = node.id;
    element.dataset.synthNodeKind = NodeKind[node.kind].replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, "");
    element.style.position = "absolute";
    element.style.left = `${node.bounds.x}px`; element.style.top = `${node.bounds.y}px`;
    if (node.bounds.width > 0) element.style.width = `${node.bounds.width}px`;
    if (node.bounds.height > 0) element.style.height = `${node.bounds.height}px`;
    element.toggleAttribute("aria-disabled", !node.enabled);
    this.updateControl(element, node);
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
    element.addEventListener("pointerdown", (event) => { element.dataset.synthPointerX = String(event.clientX); });
    element.addEventListener("pointerup", (event) => {
      const start = Number(element.dataset.synthPointerX);
      delete element.dataset.synthPointerX;
      if (Number.isFinite(start) && element.synthNode?.pointerDragAction) this.dispatchDrag(element.synthNode.pointerDragAction, event.clientX - start);
    });
    return element;
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

  private paint(canvas: HTMLCanvasElement, commands: DrawCommand[]) {
    const node = (canvas.parentElement as NodeElement).synthNode!;
    canvas.width = Math.max(1, Math.round(node.bounds.width)); canvas.height = Math.max(1, Math.round(node.bounds.height));
    canvas.style.width = "100%"; canvas.style.height = "100%";
    const context = canvas.getContext("2d")!;
    for (const command of commands) this.draw(context, command, canvas.width, canvas.height);
  }

  private draw(context: CanvasRenderingContext2D, command: DrawCommand, width: number, height: number) {
    const fill = colorCss(command.color); const stroke = colorCss(command.color); const b = command.bounds;
    const hasBounds = b.width > 0 && b.height > 0;
    context.fillStyle = fill; context.strokeStyle = stroke; context.lineWidth = command.strokeWidth;
    switch (command.kind) {
      case DrawKind.Fill: context.fillRect(hasBounds ? b.x : 0, hasBounds ? b.y : 0, hasBounds ? b.width : width, hasBounds ? b.height : height); break;
      case DrawKind.StrokeRect: context.strokeRect(b.x, b.y, b.width, b.height); break;
      case DrawKind.Line: context.beginPath(); context.moveTo(command.from.x, command.from.y); context.lineTo(command.to.x, command.to.y); context.stroke(); break;
      case DrawKind.Arc: context.beginPath(); context.arc(b.x + b.width / 2, b.y + b.height / 2, Math.min(b.width, b.height) / 2, command.startRadians, command.endRadians); context.stroke(); break;
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

function colorCss(color: Color) { return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`; }
function path(context: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) { context.beginPath(); if (points[0]) { context.moveTo(points[0].x, points[0].y); for (const point of points.slice(1)) context.lineTo(point.x, point.y); } }
function roundedRect(context: CanvasRenderingContext2D, bounds: { x: number; y: number; width: number; height: number }, radius: number) { context.beginPath(); context.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, radius); }
