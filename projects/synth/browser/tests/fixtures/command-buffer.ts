export const NodeKind = {
  Root: 0,
  Row: 1,
  Section: 2,
  ScrollArea: 3,
  Label: 4,
  Button: 5,
  Toggle: 6,
  Slider: 7,
  ComboBox: 8,
  TextField: 9,
  StatusText: 10,
  Draw: 11,
} as const;

export const DrawKind = {
  Fill: 0,
  StrokeRect: 1,
  Line: 2,
  Arc: 3,
  Text: 4,
  FillEllipse: 5,
  StrokeEllipse: 6,
  FillRoundedRect: 7,
  StrokeRoundedRect: 8,
  Polyline: 9,
  FillPolygon: 10,
} as const;

type Action = { name: string; value: string };
type Point = { x: number; y: number };
type Draw = Partial<{
  kind: number;
  bounds: [number, number, number, number];
  from: Point;
  to: Point;
  color: [number, number, number, number];
  strokeWidth: number;
  startRadians: number;
  endRadians: number;
  cornerRadius: number;
  text: string;
  textSize: number;
  textColor: [number, number, number, number];
  points: Point[];
}>;
type Node = Partial<{
  id: string;
  kind: number;
  checked: boolean;
  selected: boolean;
  enabled: boolean;
  bounds: [number, number, number, number];
  label: string;
  text: string;
  selectedOption: string;
  variant: string;
  value: number;
  minValue: number;
  maxValue: number;
  step: number;
  scrollContentWidth: number;
  scrollContentHeight: number;
  action: Action;
  pointerDragAction: Action;
  doubleClickAction: Action;
  options: Array<{ id: string; label: string }>;
  children: string[];
  draws: Draw[];
}>;

class Writer {
  private readonly bytes: number[] = [];

  u8(value: number) { this.bytes.push(value & 0xff); }
  u16(value: number) { this.u8(value); this.u8(value >>> 8); }
  u32(value: number) { this.u16(value); this.u16(value >>> 16); }
  i32(value: number) { this.u32(value >>> 0); }
  float(value: number) {
    const data = new DataView(new ArrayBuffer(4));
    data.setFloat32(0, value, true);
    this.u32(data.getUint32(0, true));
  }
  append(values: Uint8Array) { for (const value of values) this.u8(value); }
  toUint8Array() { return Uint8Array.from(this.bytes); }
}

export function makeCommandBuffer(nodes: Node[], diagnostics: string[] = []): ArrayBuffer {
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const intern = (value = "") => {
    const existing = stringIndex.get(value);
    if (existing !== undefined) return existing;
    const index = strings.length;
    strings.push(value);
    stringIndex.set(value, index);
    return index;
  };
  const actions: Action[] = [];
  const actionIndexes = nodes.map((node) => [node.action, node.pointerDragAction, node.doubleClickAction].map((action) => {
    if (!action) return -1;
    intern(action.name); intern(action.value);
    actions.push(action);
    return actions.length - 1;
  }));
  for (const node of nodes) {
    intern(node.id); intern(node.label); intern(node.text); intern(node.selectedOption); intern(node.variant);
    for (const option of node.options ?? []) { intern(option.id); intern(option.label); }
    for (const child of node.children ?? []) intern(child);
    for (const draw of node.draws ?? []) intern(draw.text);
  }
  for (const diagnostic of diagnostics) intern(diagnostic);

  const stringSection = new Writer();
  stringSection.u32(strings.length);
  for (const value of strings) {
    const encoded = new TextEncoder().encode(value);
    stringSection.u32(encoded.length); stringSection.append(encoded);
  }
  const actionSection = new Writer();
  actionSection.u32(actions.length);
  for (const action of actions) { actionSection.u32(intern(action.name)); actionSection.u32(intern(action.value)); }
  const drawSection = new Writer();
  const drawRanges: Array<[number, number]> = [];
  let drawCount = 0;
  for (const node of nodes) {
    const start = drawCount;
    for (const draw of node.draws ?? []) {
      drawSection.u8(draw.kind ?? DrawKind.Fill); drawSection.u8(0); drawSection.u16(0);
      for (const value of draw.bounds ?? [0, 0, 0, 0]) drawSection.float(value);
      for (const point of [draw.from ?? { x: 0, y: 0 }, draw.to ?? { x: 0, y: 0 }]) { drawSection.float(point.x); drawSection.float(point.y); }
      for (const value of draw.color ?? [0, 0, 0, 255]) drawSection.u8(value);
      drawSection.float(draw.strokeWidth ?? 1); drawSection.float(draw.startRadians ?? 0); drawSection.float(draw.endRadians ?? 0);
      drawSection.float(draw.cornerRadius ?? 0); drawSection.u32(intern(draw.text)); drawSection.float(draw.textSize ?? 12);
      for (const value of draw.textColor ?? [0, 0, 0, 255]) drawSection.u8(value);
      drawSection.u32((draw.points ?? []).length);
      for (const point of draw.points ?? []) { drawSection.float(point.x); drawSection.float(point.y); }
      drawCount++;
    }
    drawRanges.push([start, drawCount - start]);
  }
  const drawTable = new Writer(); drawTable.u32(drawCount); drawTable.append(drawSection.toUint8Array());
  const nodeSection = new Writer(); nodeSection.u32(nodes.length);
  nodes.forEach((node, index) => {
    nodeSection.u32(intern(node.id)); nodeSection.u8(node.kind ?? NodeKind.Label);
    nodeSection.u8(node.checked ? 1 : 0); nodeSection.u8(node.selected ? 1 : 0); nodeSection.u8(node.enabled === false ? 0 : 1);
    for (const value of node.bounds ?? [0, 0, 0, 0]) nodeSection.float(value);
    for (const value of [node.label, node.text, node.selectedOption, node.variant]) nodeSection.u32(intern(value));
    for (const value of [node.value ?? 0, node.minValue ?? 0, node.maxValue ?? 1, node.step ?? 0.001, node.scrollContentWidth ?? 0, node.scrollContentHeight ?? 0]) nodeSection.float(value);
    for (const actionIndex of actionIndexes[index]) nodeSection.i32(actionIndex);
    nodeSection.u32(drawRanges[index][0]); nodeSection.u32(drawRanges[index][1]);
    nodeSection.u32((node.options ?? []).length);
    for (const option of node.options ?? []) { nodeSection.u32(intern(option.id)); nodeSection.u32(intern(option.label)); }
    nodeSection.u32((node.children ?? []).length);
    for (const child of node.children ?? []) nodeSection.u32(intern(child));
  });
  const diagnosticSection = new Writer(); diagnosticSection.u32(diagnostics.length);
  for (const diagnostic of diagnostics) { diagnosticSection.u8(1); diagnosticSection.u8(0); diagnosticSection.u16(0); diagnosticSection.u32(intern(diagnostic)); }
  const result = new Writer();
  result.append(new TextEncoder().encode("SBCB")); result.u16(1); result.u16(0);
  for (const section of [stringSection, nodeSection, actionSection, drawTable, diagnosticSection]) result.u32(section.toUint8Array().byteLength);
  for (const section of [stringSection, nodeSection, actionSection, drawTable, diagnosticSection]) result.append(section.toUint8Array());
  return result.toUint8Array().buffer;
}
