// sru-48: the named visual acceptance criteria, enforced as structural
// assertions over the RENDERED DOM of the real runtime shell.
//
// These surfaces come from the fixture app's freshly compiled Wasm (`npm test`
// runs `make browser-fixture-app` first), so what is measured here is the real
// producers' current output. The headless half of the same criteria runs over
// the resolved portable tree in `tests/portable_ui_tests.cpp` and
// `juce/ControllersPageSimulationTests.cpp` through
// `tests/support/VisualCriteria.hpp`; this file adds the two that need real
// rendering — text fit and computed-style contrast — and re-checks the
// structural ones against what the browser actually laid out.
//
// Appearance is NOT pinned here. sru-48 was amended on 2026-07-30: no
// screenshot is a baseline and no pixel diff gates a build. These criteria are
// the durable regression surface precisely because they are structural and hold
// at any extent.
import { expect, test, type Page } from "@playwright/test";
import { installRealFakeApp, stopRealFakeApp, synthNode } from "./helpers/fake-app.js";

// ---------------------------------------------------------------------------
// Task 1.4: the fixed verification environment.
// ---------------------------------------------------------------------------
//
// The DEVICE SCALE FACTOR is pinned at 1 and the viewport is at least as large
// as the composite surface, because `BrowserUiBackend.fitSurface` applies a
// shrink-only `min(1, availableWidth / surfaceWidth)` transform to the surface
// root. Under any scale below 1 every measured rectangle is a scaled one, which
// muddies the text-fit and contrast checks. `the surface renders at scale 1`
// asserts this rather than assuming it.
//
// The VIEWPORT DIMENSIONS are framing, not a correctness gate. sru-54 makes a
// page that cannot fit its surface fail at resolution, so containment holds at
// every extent rather than at a chosen one, and with 6.6's baseline comparison
// deleted nothing later fails on a rendered-appearance difference.
export const VERIFICATION_VIEWPORT = { width: 1280, height: 900 } as const;

// The composite surface is the app's own 640x480 content plus the 96-wide
// sidebar. 736 < 1280, so the surface is never scaled down.
const COMPOSITE_SURFACE_WIDTH = 736;

test.use({ viewport: { ...VERIFICATION_VIEWPORT }, deviceScaleFactor: 1 });

// sru-48 named visual acceptance criteria. Every criterion is either asserted
// structurally in this file or checked by a human at the Task 17 sign-off gate.
// Do not add a criterion here without also adding its check.
//
// The same seven strings, in the same order, are `NamedCriteria()` in
// `tests/support/VisualCriteria.hpp`, which is the headless half of this suite.
export const VISUAL_CRITERIA = [
  "like-type controls share column positions",
  "all spacing drawn from the library's shared spacing metrics",
  "every form control has a visible caption",
  "no overlapping nodes and no container overflow on either axis",
  "every text element renders within its allocated extent",
  "text contrast meets WCAG AA 4.5:1 against its effective background",
  "no text conveys no information to the user",
] as const;

// ---------------------------------------------------------------------------
// Task 1.4: the deterministic fixture state.
// ---------------------------------------------------------------------------
//
// Named concretely so the same state is reachable from a description alone.
// Tasks 5.6 and 5.9 both showed list length changing layout materially, so the
// Controllers page is driven to a length that exercises the scrolling path
// rather than the three-item happy case.
const FIXTURE_CONTROLLER_COUNT = 12;

type SurfaceName = "audio" | "controllers" | "sync" | "file";
const ALL_SURFACES: readonly SurfaceName[] = ["audio", "controllers", "sync", "file"];
// The form grid whose row count does not depend on the host. The Controllers
// and File pages are tables and panels, not form grids; the Audio page IS one,
// but its second row is the input selector, which the shell emits only when the
// host offers an input device -- so in a browser its row count is a property of
// the machine, and a multi-row alignment claim there is not the deterministic
// fixture state task 1.4 requires. Audio's two-row grid is covered instead by
// `TestNamedVisualCriteriaHoldOnEveryPageAndApp` in `portable_ui_tests.cpp`,
// where `showInputCombo` is part of the named fixture.
const FORM_GRID_PAGES: ReadonlyArray<{ surface: SurfaceName; container: string }> = [
  { surface: "sync", container: "runtime.sync.form" },
];

// ---------------------------------------------------------------------------
// The exemptions, one entry at a time.
//
// Every id below is a disclosed residual recorded in
// `openspec/changes/rebuild-portable-ui-component-library/tasks.md`, not a
// class of escape. A control that is not on one of these lists and carries no
// rendered caption fails.
// ---------------------------------------------------------------------------

// Controls whose only identifying string sits in a field neither backend
// renders (design.md OQ5 retired `ComboBox::label`; `TextField::label` was
// never rendered either), inside tables that carry no column headings. Task 17
// decides whether they gain captions or their tables gain headings; tasks.md
// 6.5b.
//
// The suffixes are qualified by a prefix, not matched bare. Bare `.output`
// matched `runtime.audio.output` as well as the controller rows it was written
// for -- and the Audio output combo DOES carry a caption, so the exemption was
// waving through a conforming control and leaving the Audio page with nothing
// examined at all. An exemption that can silently grow to cover a whole page is
// the same failure mode as no exemption list.
const UNCAPTIONED_RESIDUAL_PREFIX = "runtime.controllers.";
const UNCAPTIONED_RESIDUAL_SUFFIXES = [
  ".input",
  ".output",
  ".variant",
  ".rename_draft",
] as const;
const UNCAPTIONED_RESIDUAL_IDS = [
  "runtime.controllers.add_name",
  "runtime.controllers.add_kind",
] as const;

// Nodes the producer positions OUT OF FLOW. They consume no stacking space, so
// a gap measured against them is meaningless, and the sru-25 visualizer
// underlays are congruent with the sibling they name by construction. The
// Controllers row status dots are an explicitly bounded Draw hand-centred in
// its cell; that arithmetic is the sru-47 residual recorded under tasks.md
// 6.5b.
const OUT_OF_FLOW_SUFFIXES = [".status_dots", ".visualizer"] as const;

// The shared spacing tables the runtime shell's producers declare, restated by
// hand from the C++ constants named beside each value -- TypeScript cannot read
// them. The authoritative check is the headless half, which builds its allowed
// set from the constants themselves, so a producer that invents a new number
// fails there whatever this list says. What this list adds is the RENDERED
// gap: the headless half measures resolved bounds, and a control whose own
// chrome overflows its extent shows up only here. That is how the Controllers
// disclosure button was caught rendering 26px into a 24px slot.
const SPACING_METRIC_VALUES = [
  0, // a deliberate absence of spacing, not a magic number
  4, // runtime_ui::Layout::kPageMargin, ::kRowGap; ControllersLayout::kPageMargin, ::kLifecycleControlGap
  6, // ControllersLayout::kRowGap
  8, // synth::ui::kSpacing.gap and .labelGap; ControllersLayout::kEndpointBoxGap, ::kAvailableControlGap
  10, // runtime_ui::Layout::kFilePanelPadding
  12, // synth::ui::kSpacing.padding
] as const;

// ---------------------------------------------------------------------------
// In-page helpers, installed into every document before navigation so that
// `page.evaluate` bodies can use them. They are ordinary type-checked code
// rather than an injected source string.
// ---------------------------------------------------------------------------

type CriteriaHelpers = {
  TOLERANCE: number;
  nodes(): HTMLElement[];
  nodeId(el: HTMLElement): string;
  parentNodeOf(el: HTMLElement): HTMLElement | null;
  contentRectOf(el: HTMLElement): DOMRect;
  childrenOf(el: HTMLElement): HTMLElement[];
  matchesAny(id: string, suffixes: readonly string[], ids: readonly string[]): boolean;
  underlayTargetOf(id: string): string;
  intersects(a: DOMRect, b: DOMRect): boolean;
  describeRect(rect: DOMRect): string;
};

declare global {
  interface Window {
    __visualCriteria: CriteriaHelpers;
  }
}

async function installCriteriaHelpers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const TOLERANCE = 0.5;
    const nodes = () => [...document.querySelectorAll<HTMLElement>("[data-node-id]")];
    const nodeId = (el: HTMLElement) => el.dataset.nodeId!;
    const parentNodeOf = (el: HTMLElement) =>
      el.parentElement ? el.parentElement.closest<HTMLElement>("[data-node-id]") : null;
    // A ScrollArea contains its declared SCROLL-CONTENT rectangle, not its
    // viewport (sru-5, sprs-10): a row below the visible viewport is contained,
    // not overflowing. The backend puts that content in a relative div sized to
    // `max(bounds, scrollContent)` and hangs it off the element as
    // `scrollContent`, so its rect is the containing rectangle -- and it moves
    // with scrollTop exactly as its children do.
    //
    // Read by the property the backend actually sets, not by position. A
    // positional `firstElementChild` would silently measure the wrong box the
    // day a scroll area gained any other child, and containment would go
    // vacuously green for every scrolling list. A scroll area missing the
    // property is reported rather than quietly falling back.
    const scrollContentOf = (el: HTMLElement): HTMLElement | null =>
      ((el as unknown as { scrollContent?: HTMLElement }).scrollContent ?? null);
    const contentRectOf = (el: HTMLElement) => {
      if (el.dataset.nodeKind !== "scroll-area") return el.getBoundingClientRect();
      const content = scrollContentOf(el);
      if (!content) throw new Error(`scroll area ${el.dataset.nodeId} has no scroll-content element`);
      return content.getBoundingClientRect();
    };
    const childrenOf = (el: HTMLElement) => nodes().filter((candidate) => parentNodeOf(candidate) === el);
    const matchesAny = (id: string, suffixes: readonly string[], ids: readonly string[]) =>
      suffixes.some((suffix) => id.endsWith(suffix)) || ids.includes(id);
    const underlayTargetOf = (id: string) =>
      id.endsWith(".visualizer") ? id.slice(0, -".visualizer".length) : "";
    const intersects = (a: DOMRect, b: DOMRect) =>
      a.left + TOLERANCE < b.right && b.left + TOLERANCE < a.right &&
      a.top + TOLERANCE < b.bottom && b.top + TOLERANCE < a.bottom;
    const describeRect = (rect: DOMRect) =>
      `(${rect.left.toFixed(2)},${rect.top.toFixed(2)} ${rect.width.toFixed(2)}x${rect.height.toFixed(2)})`;
    window.__visualCriteria = {
      TOLERANCE, nodes, nodeId, parentNodeOf, contentRectOf, childrenOf,
      matchesAny, underlayTargetOf, intersects, describeRect,
    };
  });
}

async function openSurface(page: Page, surface: SurfaceName): Promise<void> {
  await page.locator(synthNode(`runtime.sidebar.${surface}`)).click();
  await expect(page.locator(synthNode(`runtime.${surface}.root`))).toBeVisible();
}

// The named fixture state: twelve controllers added through the page's own add
// row, so the state is produced by the real surface rather than injected.
async function seedControllers(page: Page, count: number): Promise<void> {
  await openSurface(page, "controllers");
  for (let index = 0; index < count; index += 1) {
    await page.locator(`${synthNode("runtime.controllers.add_name")} input`).fill(`fixture-${index}`);
    await page.locator(synthNode("runtime.controllers.add_button")).click();
    await expect(page.locator(synthNode(`runtime.controllers.row.${index}`))).toHaveCount(1);
  }
}

test.describe("sru-48 named visual criteria", () => {
  test.beforeEach(async ({ page }) => {
    await installCriteriaHelpers(page);
    await installRealFakeApp(page);
  });

  test.afterEach(async ({ page }) => {
    await stopRealFakeApp(page);
  });

  test("the criteria checklist names every criterion this file checks", async () => {
    // The checklist is the contract; this pins that it did not quietly shrink.
    expect(VISUAL_CRITERIA).toHaveLength(7);
    expect(new Set(VISUAL_CRITERIA).size).toBe(VISUAL_CRITERIA.length);
  });

  test("the surface renders at scale 1", async ({ page }) => {
    // Task 1.4's device-scale pin, asserted rather than assumed: `fitSurface`
    // applies `min(1, availableWidth / surfaceWidth)` to the surface root, so a
    // viewport narrower than the surface would silently scale every rectangle
    // this suite measures.
    const surface = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-synth-node-id="runtime.main.root"]')!;
      const rect = root.getBoundingClientRect();
      return { transform: getComputedStyle(root).transform, width: rect.width };
    });
    expect(surface.transform === "none" || surface.transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
    expect(surface.width).toBeGreaterThanOrEqual(COMPOSITE_SURFACE_WIDTH - 0.5);
    expect(VERIFICATION_VIEWPORT.width).toBeGreaterThanOrEqual(COMPOSITE_SURFACE_WIDTH);
  });

  test("controls in the same form-grid column share an x-position and a width", async ({ page }) => {
    for (const { surface, container } of FORM_GRID_PAGES) {
      await openSurface(page, surface);
      const report = await page.evaluate((containerId: string) => {
        const { TOLERANCE, nodeId, childrenOf } = window.__visualCriteria;
        const grid = document.querySelector<HTMLElement>(`[data-node-id="${containerId}"]`);
        if (!grid) return { violations: [`missing form grid ${containerId}`], rows: 0, columns: 0 };
        const rows = childrenOf(grid);
        const columns = new Map<number, HTMLElement[]>();
        let width = 0;
        let compared = 0;
        for (const row of rows) {
          const cells = childrenOf(row);
          if (cells.length === 0) continue;
          if (compared === 0) width = cells.length;
          else if (cells.length !== width) continue;
          compared += 1;
          cells.forEach((cell, index) => {
            if (!columns.has(index)) columns.set(index, []);
            columns.get(index)!.push(cell);
          });
        }
        const violations: string[] = [];
        for (const [index, cells] of columns) {
          const first = cells[0].getBoundingClientRect();
          for (const cell of cells.slice(1)) {
            const rect = cell.getBoundingClientRect();
            if (Math.abs(rect.left - first.left) > TOLERANCE)
              violations.push(`${nodeId(cell)} x=${rect.left} leaves column ${index} at x=${first.left}`);
            if (Math.abs(rect.width - first.width) > TOLERANCE)
              violations.push(`${nodeId(cell)} width=${rect.width} leaves column ${index} width ${first.width}`);
          }
        }
        return { violations, rows: compared, columns: columns.size };
      }, container);

      expect(report.violations, `${surface}: ${report.violations.join("; ")}`).toEqual([]);
      // A silent "no rows compared" is how an alignment check passes without
      // looking at anything.
      expect(report.rows, `${surface}: form grid compared no rows`).toBeGreaterThan(1);
      expect(report.columns, `${surface}: form grid compared no columns`).toBeGreaterThan(1);
    }
  });

  test("no node overflows its parent's containing rectangle on either axis", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    for (const surface of ALL_SURFACES) {
      await openSurface(page, surface);
      const report = await page.evaluate(() => {
        const { TOLERANCE, nodes, nodeId, parentNodeOf, contentRectOf, describeRect } =
          window.__visualCriteria;
        const violations: string[] = [];
        let checked = 0;
        for (const el of nodes()) {
          const parent = parentNodeOf(el);
          if (!parent) continue;
          checked += 1;
          const p = contentRectOf(parent);
          const c = el.getBoundingClientRect();
          if (c.left < p.left - TOLERANCE || c.right > p.right + TOLERANCE ||
              c.top < p.top - TOLERANCE || c.bottom > p.bottom + TOLERANCE) {
            violations.push(`${nodeId(el)} ${describeRect(c)} overflows ${nodeId(parent)} ${describeRect(p)}`);
          }
        }
        return { violations, checked };
      });

      expect(report.violations, `${surface}: ${report.violations.join("; ")}`).toEqual([]);
      expect(report.checked, `${surface}: containment examined no nodes`).toBeGreaterThan(5);
    }
  });

  test("a scroll area clips its content and keeps it reachable", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    const scroll = page.locator(synthNode("runtime.controllers.scroll"));
    const tail = page.locator(synthNode("runtime.controllers.add_row"));

    const behaviour = await scroll.evaluate((element) => ({
      clipped: element.scrollHeight > element.clientHeight + 0.5,
      overflow: getComputedStyle(element).overflowY,
    }));
    // Twelve controllers is chosen to make this true; at three it is not, and
    // the whole scroll criterion would pass without a scroll area existing.
    expect(behaviour.clipped, "the 12-controller fixture must exceed the viewport").toBe(true);
    expect(behaviour.overflow).toBe("auto");
    await expect(tail).not.toBeInViewport();

    await scroll.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(tail).toBeInViewport();
  });

  test("no two siblings overlap, and an underlay covers exactly the node it names", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    for (const surface of ALL_SURFACES) {
      await openSurface(page, surface);
      const report = await page.evaluate((outOfFlow: string[]) => {
        const { TOLERANCE, nodes, nodeId, parentNodeOf, childrenOf, matchesAny, underlayTargetOf,
                intersects, describeRect } = window.__visualCriteria;
        const violations: string[] = [];
        let comparedPairs = 0;
        for (const parent of [...nodes(), document.body]) {
          const children: HTMLElement[] = parent === document.body
            ? nodes().filter((el) => !parentNodeOf(el))
            : childrenOf(parent as HTMLElement);
          for (let a = 0; a < children.length; a += 1) {
            for (let b = a + 1; b < children.length; b += 1) {
              const first = children[a];
              const second = children[b];
              const firstId = nodeId(first);
              const secondId = nodeId(second);
              // An out-of-flow node is exempt by NAME, and an underlay is
              // exempt only against the one sibling it names -- it still fails
              // against any other, and its congruence is asserted below.
              if (matchesAny(firstId, outOfFlow, []) || matchesAny(secondId, outOfFlow, [])) continue;
              comparedPairs += 1;
              const rectA = first.getBoundingClientRect();
              const rectB = second.getBoundingClientRect();
              if (intersects(rectA, rectB))
                violations.push(`${firstId} ${describeRect(rectA)} intersects ${secondId} ${describeRect(rectB)}`);
            }
          }
        }
        // The sru-25 underlays are the only declared overlays in a first-party
        // tree, so they are pinned to their target rather than waved through.
        for (const el of nodes()) {
          const targetId = underlayTargetOf(nodeId(el));
          if (!targetId) continue;
          const target = document.querySelector<HTMLElement>(`[data-node-id="${targetId}"]`);
          if (!target) { violations.push(`${nodeId(el)} overlays no node named ${targetId}`); continue; }
          const a = el.getBoundingClientRect();
          const b = target.getBoundingClientRect();
          if (Math.abs(a.left - b.left) > TOLERANCE || Math.abs(a.top - b.top) > TOLERANCE ||
              Math.abs(a.width - b.width) > TOLERANCE || Math.abs(a.height - b.height) > TOLERANCE)
            violations.push(`${nodeId(el)} ${describeRect(a)} is not congruent with ${targetId} ${describeRect(b)}`);
        }
        return { violations, comparedPairs };
      }, OUT_OF_FLOW_SUFFIXES as unknown as string[]);

      expect(report.violations, `${surface}: ${report.violations.join("; ")}`).toEqual([]);
      expect(report.comparedPairs, `${surface}: overlap compared no sibling pairs`).toBeGreaterThan(3);
    }
  });

  test("every gap and padding is a shared spacing-metric value", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    for (const surface of ALL_SURFACES) {
      await openSurface(page, surface);
      const report = await page.evaluate(([allowed, outOfFlow]: readonly [number[], string[]]) => {
        const { TOLERANCE, nodes, nodeId, contentRectOf, childrenOf, matchesAny } =
          window.__visualCriteria;
        const violations: string[] = [];
        const observed = new Set<number>();
        const round = (value: number) => Math.round(value * 100) / 100;
        const isAllowed = (value: number) =>
          allowed.some((candidate) => Math.abs(candidate - value) <= TOLERANCE);
        const record = (gap: number, before: string, after: string, parent: string) => {
          observed.add(round(gap));
          if (!isAllowed(gap))
            violations.push(`gap ${round(gap)} between ${before} and ${after} under ${parent} is not a shared spacing-metric value`);
        };
        for (const parent of nodes()) {
          const children = childrenOf(parent).filter((el) => !matchesAny(nodeId(el), outOfFlow, []));
          if (children.length === 0) continue;
          const container = contentRectOf(parent);
          const rects = new Map<HTMLElement, DOMRect>(
            children.map((el) => [el, el.getBoundingClientRect()] as const));
          // The container's own LEADING inset on both axes is its padding.
          // Only the leading one is measurable: design.md D3 rule 5 leaves
          // residual space no eligible child can absorb unallocated at the END
          // of the container, so a trailing inset is legitimately padding plus
          // slack.
          record(Math.min(...children.map((el) => rects.get(el)!.left)) - container.left,
                 nodeId(parent), "its leading edge on x", nodeId(parent));
          record(Math.min(...children.map((el) => rects.get(el)!.top)) - container.top,
                 nodeId(parent), "its leading edge on y", nodeId(parent));
          if (children.length < 2) continue;

          // A wrapping row puts its children on several lines, so one sorted
          // sequence along the main axis would read the wrap itself as a large
          // negative gap. Group by cross-axis offset first.
          const horizontal = parent.dataset.nodeKind === "row";
          const mainStart = (el: HTMLElement) => horizontal ? rects.get(el)!.left : rects.get(el)!.top;
          const mainEnd = (el: HTMLElement) => horizontal ? rects.get(el)!.right : rects.get(el)!.bottom;
          const crossStart = (el: HTMLElement) => horizontal ? rects.get(el)!.top : rects.get(el)!.left;
          const crossEnd = (el: HTMLElement) => horizontal ? rects.get(el)!.bottom : rects.get(el)!.right;
          const lines = new Map<number, HTMLElement[]>();
          for (const el of children) {
            const key = round(crossStart(el));
            if (!lines.has(key)) lines.set(key, []);
            lines.get(key)!.push(el);
          }
          const offsets = [...lines.keys()].sort((a, b) => a - b);
          for (const offset of offsets) {
            const line = lines.get(offset)!.sort((a, b) => mainStart(a) - mainStart(b));
            for (let ix = 1; ix < line.length; ix += 1)
              record(mainStart(line[ix]) - mainEnd(line[ix - 1]), nodeId(line[ix - 1]), nodeId(line[ix]), nodeId(parent));
          }
          for (let ix = 1; ix < offsets.length; ix += 1) {
            const previous = lines.get(offsets[ix - 1])!;
            const next = lines.get(offsets[ix])!;
            record(offsets[ix] - Math.max(...previous.map(crossEnd)),
                   nodeId(previous[0]), nodeId(next[0]), nodeId(parent));
          }
        }
        return { violations, observed: [...observed] };
      }, [SPACING_METRIC_VALUES as unknown as number[], OUT_OF_FLOW_SUFFIXES as unknown as string[]] as const);

      expect(report.violations, `${surface}: ${report.violations.join("; ")}`).toEqual([]);
      expect(report.observed.length, `${surface}: spacing measured nothing`).toBeGreaterThan(1);
    }
  });

  test("every text element fits its allocated extent", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    for (const surface of ALL_SURFACES) {
      await openSurface(page, surface);
      const report = await page.evaluate(() => {
        const { TOLERANCE, nodes, nodeId } = window.__visualCriteria;
        // Only the kinds whose own element renders text: a ComboBox or
        // TextField element holds a child control whose intrinsic width is the
        // browser's business, not a library reservation.
        const textKinds = ["label", "status-text", "button", "toggle"];
        const violations: string[] = [];
        let measured = 0;
        for (const el of nodes()) {
          if (!textKinds.includes(el.dataset.nodeKind!)) continue;
          if (!el.textContent || !el.textContent.trim()) continue;
          measured += 1;
          if (el.scrollWidth > el.clientWidth + TOLERANCE)
            violations.push(`${nodeId(el)} needs ${el.scrollWidth} in ${el.clientWidth}: "${el.textContent.trim()}"`);
          if (el.scrollHeight > el.clientHeight + TOLERANCE)
            violations.push(`${nodeId(el)} needs ${el.scrollHeight} high in ${el.clientHeight}: "${el.textContent.trim()}"`);
        }
        return { violations, measured };
      });

      // A failure names a too-tight metrics reservation, not a page bug.
      expect(report.violations, `${surface}: ${report.violations.join("; ")}`).toEqual([]);
      expect(report.measured, `${surface}: text fit measured no text`).toBeGreaterThan(2);
    }
  });

  test("every form control has a visible caption", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    for (const surface of ALL_SURFACES) {
      await openSurface(page, surface);
      const report = await page.evaluate(([suffixes, ids, prefix]: readonly [string[], string[], string]) => {
        const { nodes, nodeId, matchesAny } = window.__visualCriteria;
        const violations: string[] = [];
        let examined = 0;
        for (const el of nodes()) {
          const kind = el.dataset.nodeKind;
          if (!["combo-box", "text-field", "toggle", "slider"].includes(kind!)) continue;
          const id = nodeId(el);
          if (id.startsWith(prefix) && matchesAny(id, suffixes, ids)) continue;
          examined += 1;
          if (document.querySelector(`[data-node-id="${id}.caption"]`)) continue;
          // A toggle renders its own label; a combo box and a text field do
          // not, whatever their `label` field says (design.md OQ5).
          if (kind === "toggle" && el.textContent && el.textContent.trim()) continue;
          violations.push(id);
        }
        return { violations, examined };
      }, [UNCAPTIONED_RESIDUAL_SUFFIXES as unknown as string[],
          UNCAPTIONED_RESIDUAL_IDS as unknown as string[],
          UNCAPTIONED_RESIDUAL_PREFIX] as const);

      expect(report.violations, `${surface}: uncaptioned ${report.violations.join("; ")}`).toEqual([]);
      if (surface === "sync" || surface === "audio")
        expect(report.examined, `${surface}: caption check examined no form control`).toBeGreaterThan(0);
    }
  });

  test("no text element renders an empty string", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    for (const surface of ALL_SURFACES) {
      await openSurface(page, surface);
      const silent = await page.evaluate(() => {
        const { TOLERANCE, nodes, nodeId, describeRect } = window.__visualCriteria;
        const out: string[] = [];
        for (const el of nodes()) {
          if (!["label", "status-text"].includes(el.dataset.nodeKind!)) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width > TOLERANCE && rect.height > TOLERANCE &&
              (!el.textContent || !el.textContent.trim()))
            out.push(`${nodeId(el)} reserves ${describeRect(rect)} and renders no text`);
        }
        return out;
      });
      expect(silent, `${surface}: ${silent.join("; ")}`).toEqual([]);
    }
  });

  test("text contrast meets WCAG AA 4.5:1", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    for (const surface of ALL_SURFACES) {
      await openSurface(page, surface);
      const report = await page.evaluate(() => {
        const { nodes, nodeId } = window.__visualCriteria;
        type Colour = { r: number; g: number; b: number; a: number };
        const parse = (value: string): Colour | null => {
          const parts = value.match(/[\d.]+/g);
          if (!parts) return null;
          const [r, g, b, a] = parts.map(Number);
          return { r, g, b, a: a === undefined ? 1 : a };
        };
        const channel = (value: number) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        const luminance = (c: Colour) =>
          0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
        const ratio = (fg: Colour, bg: Colour) => {
          const a = luminance(fg);
          const b = luminance(bg);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        // The effective background is the nearest ancestor painting an opaque
        // colour, which is what the eye sees behind the glyphs.
        const effectiveBackground = (el: HTMLElement): Colour => {
          for (let node: HTMLElement | null = el; node; node = node.parentElement) {
            const colour = parse(getComputedStyle(node).backgroundColor);
            if (colour && colour.a >= 1) return colour;
          }
          return { r: 255, g: 255, b: 255, a: 1 };
        };
        const violations: string[] = [];
        let measured = 0;
        for (const el of nodes()) {
          if (!["label", "status-text", "button", "toggle"].includes(el.dataset.nodeKind!)) continue;
          if (!el.textContent || !el.textContent.trim()) continue;
          const style = getComputedStyle(el);
          const foreground = parse(style.color);
          if (!foreground || foreground.a === 0) continue;
          measured += 1;
          const background = effectiveBackground(el);
          const contrast = ratio(foreground, background);
          if (contrast < 4.5)
            violations.push(`${nodeId(el)} ${contrast.toFixed(2)}:1 (${style.color} on rgb(${background.r}, ${background.g}, ${background.b}))`);
        }
        return { violations, measured };
      });

      expect(report.violations, `${surface}: ${report.violations.join("; ")}`).toEqual([]);
      expect(report.measured, `${surface}: contrast measured no text`).toBeGreaterThan(2);
    }
  });
});
