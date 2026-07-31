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
import { installTwisterPair } from "./helpers/fake-midi.js";

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

// Controls with no visible caption, ENUMERATED FROM THE FIXTURE rather than
// matched by pattern. Each entry is one control with one reason. sru-48 says
// every form control carries a visible caption and each of these fails that
// today; whether the fix is a caption per cell or a column heading per table is
// a product decision, and task 6.5 is the pairing session where a human makes
// it. tasks.md 6.5b carries the same list.
//
// A pattern list is what this replaces, and it is why: a bare `.output` suffix
// matched `runtime.audio.output`, a control that DOES carry a caption, and left
// the Audio page with nothing examined at all. Prefix-qualifying the pattern
// fixed that instance and not the mechanism -- any future
// `runtime.controllers.*.output` would still have been waived without ever
// being named. Building the list from fixture row indices means a control the
// page grows is examined and fails.
type CaptionException = { id: string; reason: string };

function controllerCaptionExceptions(rows: number): CaptionException[] {
  const exceptions: CaptionException[] = [
    { id: "runtime.controllers.add_name", reason: "add-row name field; the add row publishes no column headings" },
    { id: "runtime.controllers.add_kind", reason: "add-row kind selector; same, via the retired ComboBox::label (design.md OQ5)" },
  ];
  for (let ix = 0; ix < rows; ix += 1) {
    const row = `controller row ${ix}`;
    exceptions.push(
      { id: `runtime.controllers.row.${ix}.input`, reason: `${row} MIDI input selector; a table cell whose column has no heading` },
      { id: `runtime.controllers.row.${ix}.output`, reason: `${row} MIDI output selector; a table cell whose column has no heading` },
      { id: `runtime.controllers.row.${ix}.rename_draft`, reason: `${row} rename field; the adjacent Rename button is the only thing naming it` },
    );
  }
  return exceptions;
}

// Sliders that carry their name in `Node::label`, which no backend paints for a
// `Slider`. Same product question as the table cells; tasks.md 6.5b.
const APP_CAPTION_EXCEPTIONS: CaptionException[] = [
  { id: "braid4.scene.blend", reason: "Braid 4 scene blend slider; name lives in Node::label" },
  { id: "miniapp.scene.blend", reason: "Mini App scene blend slider; name lives in Node::label" },
  { id: "miniapp.gesture.value", reason: "Mini App gesture slider; name lives in Node::label" },
];

// The ONLY blanket out-of-flow class. A Controllers row's status dots are an
// explicitly bounded `Draw` the producer hand-centres inside its cell, so they
// consume no stacking space and a gap measured against them is meaningless.
// That hand-centring is the sru-47/sru-53 residual under tasks.md 6.5b.
//
// `.visualizer` is deliberately NOT here. It used to be, which made the overlap
// check skip every pair involving an underlay -- including against siblings the
// underlay does not name -- while the comment claimed the exemption was
// underlay-to-target only. The two halves encoded different contracts, and the
// looser one was in the half meant to catch rendered overlap the tree cannot
// see. `siblingOverlaps` now mirrors the headless rule exactly.
const OUT_OF_FLOW_SUFFIXES = [".status_dots"] as const;

// Declared overlays that cannot say so through `overlayOf`, named ONE AT A TIME
// with the one sibling each is allowed to cover. Not a suffix: a `.warning`
// match would have swallowed `runtime.sync.warning` and
// `runtime.controllers.wizard.warning` too, neither of which is a badge, and
// that is the same class-based escape the caption list was just rebuilt to
// avoid.
//
// A badge is exempt from the overlap check against its target and nothing else,
// and `badgesSeen` below requires the pin to have had a live subject rather
// than being satisfied by absence.
const DECLARED_BADGES: ReadonlyArray<{ id: string; target: string; reason: string }> = [
  {
    id: "runtime.sidebar.controllers.warning",
    target: "runtime.sidebar.controllers",
    // `BuildSidebarTree` hand-assembles already-resolved nodes and never
    // invokes the resolver (tasks.md 7.1), so this deliberate overlay has no
    // `overlayOf` to declare. It renders whenever MIDI discovery has an
    // unconfigured candidate available.
    reason: "sidebar MIDI-warning badge, deliberately over the right edge of the Controllers button",
  },
];

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
  badgeTargetOf(id: string): string;
  intersects(a: DOMRect, b: DOMRect): boolean;
  describeRect(rect: DOMRect): string;
  contrastRatio(el: HTMLElement):
    | { ratio: number; painted: string; background: string; alpha: number }
    | null;
};

// The kinds whose OWN element paints glyphs. `combo-box` and `text-field` are
// included: a `<select>` and an `<input>` render their value text inside the
// element the backend sized, so a too-tight reservation or a low-contrast field
// shows up there and nowhere else. They were unmeasured before.
const TEXT_BEARING_KINDS = ["label", "status-text", "button", "toggle", "combo-box", "text-field"] as const;

declare global {
  interface Window {
    __visualCriteria: CriteriaHelpers;
  }
}

async function installCriteriaHelpers(page: Page): Promise<void> {
  await page.addInitScript((badges: ReadonlyArray<{ id: string; target: string }>) => {
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
    // The declared badges, looked up BY ID in the table above -- one id, one
    // target. A badge is exempt from the overlap check only against that
    // target, and only while it sits inside it. A badge that drifted onto a
    // different button, or off its own, fails.
    const badgeTargetOf = (id: string) =>
      badges.find((badge) => badge.id === id)?.target ?? "";
    const intersects = (a: DOMRect, b: DOMRect) =>
      a.left + TOLERANCE < b.right && b.left + TOLERANCE < a.right &&
      a.top + TOLERANCE < b.bottom && b.top + TOLERANCE < a.bottom;
    const describeRect = (rect: DOMRect) =>
      `(${rect.left.toFixed(2)},${rect.top.toFixed(2)} ${rect.width.toFixed(2)}x${rect.height.toFixed(2)})`;

    // The COMPOSITED foreground colour, not the computed one.
    //
    // `getComputedStyle(el).color` reports the author's colour before the
    // element's own `opacity` and before every ancestor's. A disabled control
    // renders at `opacity: 0.58` (`synth-browser.css`), so reading `color`
    // alone approves text the eye sees at well under the reported ratio. Both
    // the foreground's own alpha and the cumulative opacity chain are composited
    // against the effective background here, which is what WCAG measures.
    const parseColour = (value: string) => {
      const parts = value.match(/[\d.]+/g);
      if (!parts) return null;
      const [r, g, b, a] = parts.map(Number);
      return { r, g, b, a: a === undefined ? 1 : a };
    };
    const cumulativeOpacity = (el: HTMLElement) => {
      let opacity = 1;
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        const own = Number(getComputedStyle(node).opacity);
        if (!Number.isNaN(own)) opacity *= own;
      }
      return opacity;
    };
    const effectiveBackground = (el: HTMLElement) => {
      for (let node: HTMLElement | null = el; node; node = node.parentElement) {
        const colour = parseColour(getComputedStyle(node).backgroundColor);
        if (colour && colour.a >= 1) return colour;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const composite = (fg: { r: number; g: number; b: number; a: number },
                       bg: { r: number; g: number; b: number; a: number },
                       alpha: number) => ({
      r: fg.r * alpha + bg.r * (1 - alpha),
      g: fg.g * alpha + bg.g * (1 - alpha),
      b: fg.b * alpha + bg.b * (1 - alpha),
      a: 1,
    });
    const channel = (value: number) => {
      const c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = (c: { r: number; g: number; b: number }) =>
      0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    const contrastRatio = (el: HTMLElement) => {
      const foreground = parseColour(getComputedStyle(el).color);
      if (!foreground) return null;
      const background = effectiveBackground(el);
      const alpha = Math.max(0, Math.min(1, foreground.a * cumulativeOpacity(el)));
      if (alpha === 0) return null;
      const painted = composite(foreground, background, alpha);
      const a = luminance(painted);
      const b = luminance(background);
      return {
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        painted: `rgb(${painted.r.toFixed(0)}, ${painted.g.toFixed(0)}, ${painted.b.toFixed(0)})`,
        background: `rgb(${background.r}, ${background.g}, ${background.b})`,
        alpha,
      };
    };

    window.__visualCriteria = {
      TOLERANCE, nodes, nodeId, parentNodeOf, contentRectOf, childrenOf,
      matchesAny, underlayTargetOf, badgeTargetOf, intersects, describeRect, contrastRatio,
    };
  }, DECLARED_BADGES.map((badge) => ({ id: badge.id, target: badge.target })));
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

// The structural criteria over whatever is on screen right now, for states that
// are not one of the four top-level pages. Same rules as the per-criterion
// tests above, gathered in one pass so a driven state can be checked without
// re-navigating for each one.
async function evaluateStructuralCriteria(page: Page) {
  return page.evaluate(([outOfFlow, textKinds]: readonly [string[], string[]]) => {
    const { TOLERANCE, nodes, nodeId, parentNodeOf, contentRectOf, childrenOf, matchesAny,
            underlayTargetOf, badgeTargetOf, intersects, describeRect, contrastRatio } = window.__visualCriteria;
    const overflows: string[] = [];
    const overlaps: string[] = [];
    const silentText: string[] = [];
    const tooTight: string[] = [];
    const lowContrast: string[] = [];
    let checked = 0;
    let badgesSeen = 0;

    for (const el of nodes()) {
      const parent = parentNodeOf(el);
      if (parent) {
        checked += 1;
        const p = contentRectOf(parent);
        const c = el.getBoundingClientRect();
        if (c.left < p.left - TOLERANCE || c.right > p.right + TOLERANCE ||
            c.top < p.top - TOLERANCE || c.bottom > p.bottom + TOLERANCE)
          overflows.push(`${nodeId(el)} ${describeRect(c)} overflows ${nodeId(parent)} ${describeRect(p)}`);
      }
      const kind = el.dataset.nodeKind!;
      if (["label", "status-text"].includes(kind)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > TOLERANCE && rect.height > TOLERANCE && !el.textContent?.trim())
          silentText.push(`${nodeId(el)} reserves ${describeRect(rect)} and renders no text`);
      }
      if (textKinds.includes(kind) && el.textContent?.trim()) {
        if (el.scrollWidth > el.clientWidth + TOLERANCE)
          tooTight.push(`${nodeId(el)} needs ${el.scrollWidth} in ${el.clientWidth}`);
        const contrast = contrastRatio(el);
        if (contrast && contrast.ratio < 4.5)
          lowContrast.push(`${nodeId(el)} ${contrast.ratio.toFixed(2)}:1 (${contrast.painted} on ${contrast.background})`);
      }
    }

    for (const parent of [...nodes(), document.body]) {
      const children: HTMLElement[] = parent === document.body
        ? nodes().filter((el) => !parentNodeOf(el))
        : childrenOf(parent as HTMLElement);
      for (let a = 0; a < children.length; a += 1) {
        for (let b = a + 1; b < children.length; b += 1) {
          const firstId = nodeId(children[a]);
          const secondId = nodeId(children[b]);
          if (matchesAny(firstId, outOfFlow, []) || matchesAny(secondId, outOfFlow, [])) continue;
          if (underlayTargetOf(firstId) === secondId || underlayTargetOf(secondId) === firstId) continue;
          if (badgeTargetOf(firstId) === secondId || badgeTargetOf(secondId) === firstId) continue;
          const rectA = children[a].getBoundingClientRect();
          const rectB = children[b].getBoundingClientRect();
          if (intersects(rectA, rectB))
            overlaps.push(`${firstId} ${describeRect(rectA)} intersects ${secondId} ${describeRect(rectB)}`);
        }
      }
    }

    // Same badge pin as the four-page overlap test: a declared badge is exempt
    // against its target and nothing else, so it must actually sit inside it.
    // Here the subject set is live -- the wizard states install two Twisters,
    // which is what makes the sidebar warning badge render.
    for (const el of nodes()) {
      const targetId = badgeTargetOf(nodeId(el));
      if (!targetId) continue;
      badgesSeen += 1;
      const target = document.querySelector<HTMLElement>(`[data-node-id="${targetId}"]`);
      if (!target) { overlaps.push(`${nodeId(el)} badges no node named ${targetId}`); continue; }
      const a = el.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      if (a.left < b.left - TOLERANCE || a.right > b.right + TOLERANCE ||
          a.top < b.top - TOLERANCE || a.bottom > b.bottom + TOLERANCE)
        overlaps.push(`${nodeId(el)} ${describeRect(a)} is not inside the node it badges, ${targetId} ${describeRect(b)}`);
    }
    return { overflows, overlaps, silentText, tooTight, lowContrast, checked, badgesSeen };
  }, [OUT_OF_FLOW_SUFFIXES as unknown as string[], TEXT_BEARING_KINDS as unknown as string[]] as const);
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
                badgeTargetOf, intersects, describeRect } = window.__visualCriteria;
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
              // Mirrors `SiblingOverlapViolations` in `VisualCriteria.hpp`
              // exactly. Two skips, and only two:
              //
              //  - the hand-centred status dots, which are out of flow;
              //  - an underlay against THE ONE SIBLING IT NAMES.
              //
              // An underlay is still compared against every other sibling, so
              // one that drifted onto its neighbour fails here as well as
              // failing the congruence pin below. Before this, matching either
              // id against the out-of-flow list skipped every pair involving a
              // `.visualizer`, which is a far broader exemption than the
              // comment above it claimed.
              if (matchesAny(firstId, outOfFlow, []) || matchesAny(secondId, outOfFlow, [])) continue;
              if (underlayTargetOf(firstId) === secondId || underlayTargetOf(secondId) === firstId) continue;
              if (badgeTargetOf(firstId) === secondId || badgeTargetOf(secondId) === firstId) continue;
              comparedPairs += 1;
              const rectA = first.getBoundingClientRect();
              const rectB = second.getBoundingClientRect();
              if (intersects(rectA, rectB))
                violations.push(`${firstId} ${describeRect(rectA)} intersects ${secondId} ${describeRect(rectB)}`);
            }
          }
        }
        // The sru-25 underlays are the only declared overlays in a first-party
        // tree. If one is ever rendered here it is pinned to its target rather
        // than waved through -- but the runtime shell's four pages emit none,
        // so `underlaysSeen` is reported and asserted below rather than this
        // loop quietly finding nothing and the test reading as green.
        // A named badge is exempt against its target and nothing else, so what
        // it is doing has to be pinned rather than assumed: it must sit inside
        // the node it annotates. The sidebar badge renders only while MIDI
        // discovery has an unconfigured candidate, which these four pages do
        // not, so `badgesSeen` is reported here and pinned where a badge is
        // actually on screen -- the wizard test, which installs two Twisters.
        let badgesSeen = 0;
        for (const el of nodes()) {
          const targetId = badgeTargetOf(nodeId(el));
          if (!targetId) continue;
          badgesSeen += 1;
          const target = document.querySelector<HTMLElement>(`[data-node-id="${targetId}"]`);
          if (!target) { violations.push(`${nodeId(el)} badges no node named ${targetId}`); continue; }
          const a = el.getBoundingClientRect();
          const b = target.getBoundingClientRect();
          if (a.left < b.left - TOLERANCE || a.right > b.right + TOLERANCE ||
              a.top < b.top - TOLERANCE || a.bottom > b.bottom + TOLERANCE)
            violations.push(`${nodeId(el)} ${describeRect(a)} is not inside the node it badges, ${targetId} ${describeRect(b)}`);
        }
        let underlaysSeen = 0;
        for (const el of nodes()) {
          const targetId = underlayTargetOf(nodeId(el));
          if (!targetId) continue;
          underlaysSeen += 1;
          const target = document.querySelector<HTMLElement>(`[data-node-id="${targetId}"]`);
          if (!target) { violations.push(`${nodeId(el)} overlays no node named ${targetId}`); continue; }
          const a = el.getBoundingClientRect();
          const b = target.getBoundingClientRect();
          if (Math.abs(a.left - b.left) > TOLERANCE || Math.abs(a.top - b.top) > TOLERANCE ||
              Math.abs(a.width - b.width) > TOLERANCE || Math.abs(a.height - b.height) > TOLERANCE)
            violations.push(`${nodeId(el)} ${describeRect(a)} is not congruent with ${targetId} ${describeRect(b)}`);
        }
        return { violations, comparedPairs, underlaysSeen, badgesSeen };
      }, OUT_OF_FLOW_SUFFIXES as unknown as string[]);

      expect(report.violations, `${surface}: ${report.violations.join("; ")}`).toEqual([]);
      expect(report.comparedPairs, `${surface}: overlap compared no sibling pairs`).toBeGreaterThan(3);
      // An underlay only exists inside Braid 4 and Mini App, and neither is
      // reachable from this harness: the fixture app emits none, and the
      // first-party launch path is one of the six documented pre-existing
      // Playwright failures. So the congruence claim is made and PROVEN VACUOUS
      // here rather than left to look like coverage -- the real one, with
      // mutation evidence in both directions, is
      // `TestAnUnderlayIsPinnedToItsTargetRatherThanExemptedFromOverlap` in
      // `portable_ui_layout_tests.cpp`, over a tree that actually has one.
      //
      // The day a runtime page does render an underlay, this flips and the
      // congruence branch above becomes live coverage that must be reasoned
      // about rather than inherited.
      expect(report.underlaysSeen,
        `${surface}: a runtime page now renders an sru-25 underlay -- the congruence check above ` +
        `is no longer vacuous, so replace this pin with a real assertion on it`).toBe(0);
      // Same treatment for the badge. No MIDI is installed in this test, so
      // discovery has no candidate and the sidebar warning does not render. The
      // live badge pin is in the wizard test, which does install one; if a badge
      // ever appears here too, this stops being a statement of fact.
      expect(report.badgesSeen,
        `${surface}: a declared badge now renders on a plain page -- pin what it does here as well`)
        .toBe(0);
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
      const report = await page.evaluate((textKinds: string[]) => {
        const { TOLERANCE, nodes, nodeId } = window.__visualCriteria;
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
      }, TEXT_BEARING_KINDS as unknown as string[]);

      // A failure names a too-tight metrics reservation, not a page bug.
      expect(report.violations, `${surface}: ${report.violations.join("; ")}`).toEqual([]);
      expect(report.measured, `${surface}: text fit measured no text`).toBeGreaterThan(2);
    }
  });

  test("every form control has a visible caption", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    const exceptions = [...controllerCaptionExceptions(FIXTURE_CONTROLLER_COUNT),
                        ...APP_CAPTION_EXCEPTIONS];
    for (const surface of ALL_SURFACES) {
      await openSurface(page, surface);
      const report = await page.evaluate((excepted: string[]) => {
        const { nodes, nodeId } = window.__visualCriteria;
        const violations: string[] = [];
        let examined = 0;
        let residualsMatched = 0;
        let total = 0;
        for (const el of nodes()) {
          const kind = el.dataset.nodeKind;
          if (!["combo-box", "text-field", "toggle", "slider"].includes(kind!)) continue;
          const id = nodeId(el);
          total += 1;
          // Membership, not a pattern. A control the page grows is not on the
          // list, so it is examined and must carry a caption.
          if (excepted.includes(id)) { residualsMatched += 1; continue; }
          examined += 1;
          if (document.querySelector(`[data-node-id="${id}.caption"]`)) continue;
          // A toggle renders its own label; a combo box and a text field do
          // not, whatever their `label` field says (design.md OQ5).
          if (kind === "toggle" && el.textContent && el.textContent.trim()) continue;
          violations.push(id);
        }
        return { violations, examined, residualsMatched, total };
      }, exceptions.map((exception) => exception.id));

      expect(report.violations, `${surface}: uncaptioned ${report.violations.join("; ")}`).toEqual([]);
      // Every surface that declares form controls must have looked at
      // something. `controllers` is the one page where every control is a
      // table cell and therefore excepted, so its floor is on the exceptions
      // instead -- which is exactly the page where a silent pass would matter
      // most, so its total is pinned separately below.
      if (report.total > 0 && surface !== "controllers")
        expect(report.examined, `${surface}: caption check examined no form control`).toBeGreaterThan(0);
      if (surface === "controllers") {
        expect(report.residualsMatched,
          "controllers: no named caption exception matched, so the list is stale").toBeGreaterThan(0);
        // 12 rows x {input, output, rename_draft} plus the two add-row fields.
        // A control the page grows moves this number and fails here by name,
        // which is what the old suffix class could not do.
        expect(report.total,
          "controllers: the page carries a different number of form controls than the fixture declares")
          .toBe(FIXTURE_CONTROLLER_COUNT * 3 + 2);
      }
    }
  });

  test("no text element renders an empty string", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    for (const surface of ALL_SURFACES) {
      await openSurface(page, surface);
      const report = await page.evaluate(() => {
        const { TOLERANCE, nodes, nodeId, describeRect } = window.__visualCriteria;
        const violations: string[] = [];
        let examined = 0;
        for (const el of nodes()) {
          if (!["label", "status-text"].includes(el.dataset.nodeKind!)) continue;
          examined += 1;
          const rect = el.getBoundingClientRect();
          if (rect.width > TOLERANCE && rect.height > TOLERANCE &&
              (!el.textContent || !el.textContent.trim()))
            violations.push(`${nodeId(el)} reserves ${describeRect(rect)} and renders no text`);
        }
        return { violations, examined };
      });
      expect(report.violations, `${surface}: ${report.violations.join("; ")}`).toEqual([]);
      expect(report.examined,
        `${surface}: the empty-text check found no label or status text to examine`).toBeGreaterThan(0);
    }
  });

  test("text contrast meets WCAG AA 4.5:1 after compositing alpha and opacity", async ({ page }) => {
    await seedControllers(page, FIXTURE_CONTROLLER_COUNT);
    for (const surface of ALL_SURFACES) {
      await openSurface(page, surface);
      const report = await page.evaluate((textKinds: string[]) => {
        const { nodes, nodeId, contrastRatio } = window.__visualCriteria;
        const violations: string[] = [];
        let measured = 0;
        let faded = 0;
        for (const el of nodes()) {
          if (!textKinds.includes(el.dataset.nodeKind!)) continue;
          if (!el.textContent || !el.textContent.trim()) continue;
          const contrast = contrastRatio(el);
          if (!contrast) continue;
          measured += 1;
          if (contrast.alpha < 1) faded += 1;
          if (contrast.ratio < 4.5)
            violations.push(`${nodeId(el)} ${contrast.ratio.toFixed(2)}:1 (${contrast.painted} on ${contrast.background}, alpha ${contrast.alpha.toFixed(2)})`);
        }
        return { violations, measured, faded };
      }, TEXT_BEARING_KINDS as unknown as string[]);

      expect(report.violations, `${surface}: ${report.violations.join("; ")}`).toEqual([]);
      expect(report.measured, `${surface}: contrast measured no text`).toBeGreaterThan(2);
    }
  });

  // Mutation evidence for the two browser-only criteria. Every headless
  // predicate has a test proving it can fail and name its offender
  // (`portable_ui_layout_tests.cpp`); text fit and contrast had none, and they
  // are the two the headless half structurally cannot do. These inject a
  // failure into the live DOM and require the same code that passes above to
  // catch it.
  test("the text-fit and contrast checks can actually fail", async ({ page }) => {
    await openSurface(page, "sync");

    const textFit = await page.evaluate(() => {
      const { TOLERANCE, nodes, nodeId } = window.__visualCriteria;
      const label = nodes().find((el) => el.dataset.nodeKind === "label" && !!el.textContent?.trim());
      if (!label) return { injected: false, caught: [] as string[] };
      const width = label.style.width;
      // Squeeze the reservation, exactly as a too-tight metrics entry would.
      label.style.width = "4px";
      const caught: string[] = [];
      if (label.scrollWidth > label.clientWidth + TOLERANCE) caught.push(nodeId(label));
      label.style.width = width;
      return { injected: true, caught };
    });
    expect(textFit.injected, "sync must render a label to squeeze").toBe(true);
    expect(textFit.caught, "a label squeezed to 4px must fail the text-fit check").not.toEqual([]);

    const contrast = await page.evaluate(() => {
      const { nodes, contrastRatio } = window.__visualCriteria;
      const label = nodes().find((el) => el.dataset.nodeKind === "label" && !!el.textContent?.trim());
      if (!label) return { before: 0, afterColour: 0, afterOpacity: 0 };
      const before = contrastRatio(label)!.ratio;
      const colour = label.style.color;
      const opacity = label.style.opacity;
      // Two independent ways to fail: a low-contrast colour, and a colour that
      // passes on paper but is faded by opacity. The second is the one the old
      // check approved, because it read `color` and ignored compositing.
      label.style.color = "rgb(24, 26, 28)";
      const afterColour = contrastRatio(label)!.ratio;
      label.style.color = colour;
      label.style.opacity = "0.15";
      const afterOpacity = contrastRatio(label)!.ratio;
      label.style.opacity = opacity;
      return { before, afterColour, afterOpacity };
    });
    expect(contrast.before, "the unmodified label passes today").toBeGreaterThanOrEqual(4.5);
    expect(contrast.afterColour, "a near-background colour must fail").toBeLessThan(4.5);
    expect(contrast.afterOpacity, "a passing colour faded to 15% opacity must also fail").toBeLessThan(4.5);
  });

  // sru-48 asks for a rendered re-render at a second root extent, asserting
  // weighted children redistribute while fixed and intrinsic ones hold. The
  // headless half proves the resolver does this; what only the browser can show
  // is that the DOM the backend built actually followed. Every other
  // browser-only criterion is evaluated at one extent, which is exactly why
  // this one is not.
  // Sync's validation error and warning are named states in task 1.4's fixture
  // and were previously evaluated only headlessly, even though the browser can
  // reach them: they are a consequence of what is typed into the PPQN field, not
  // of host state. So they are driven here through the page's own field. This is
  // the state that produced the empty-band defect 6.2 fixed, and it is the one
  // state where two diagnostic text nodes are on screen at once -- exactly the
  // shape a too-tight reservation or a low-contrast muted style shows up in.
  test("the Sync page's diagnostic state meets the structural criteria", async ({ page }) => {
    await openSurface(page, "sync");
    const ppqn = page.locator(`${synthNode("runtime.sync.ppqn")} input`);

    // A rejected value: the validation band is present and says something.
    await ppqn.fill("96x");
    const validation = page.locator(synthNode("runtime.sync.validation"));
    await expect(validation).toContainText("1 to 960");
    const invalid = await evaluateStructuralCriteria(page);
    expect(invalid.overflows, `sync invalid: ${invalid.overflows.join("; ")}`).toEqual([]);
    expect(invalid.overlaps, `sync invalid: ${invalid.overlaps.join("; ")}`).toEqual([]);
    expect(invalid.silentText, `sync invalid: ${invalid.silentText.join("; ")}`).toEqual([]);
    expect(invalid.tooTight, `sync invalid: ${invalid.tooTight.join("; ")}`).toEqual([]);
    expect(invalid.lowContrast, `sync invalid: ${invalid.lowContrast.join("; ")}`).toEqual([]);
    expect(invalid.checked, "sync invalid: examined no nodes").toBeGreaterThan(5);

    // A valid but nonstandard value: the validation band is GONE (an empty band
    // would fail `silentText`, which is the point of asserting absence) and the
    // warning band is present instead.
    await ppqn.fill("96");
    await expect(validation).toHaveCount(0);
    await expect(page.locator(synthNode("runtime.sync.warning"))).toContainText("nonstandard");
    const warned = await evaluateStructuralCriteria(page);
    expect(warned.overflows, `sync warning: ${warned.overflows.join("; ")}`).toEqual([]);
    expect(warned.overlaps, `sync warning: ${warned.overlaps.join("; ")}`).toEqual([]);
    expect(warned.silentText, `sync warning: ${warned.silentText.join("; ")}`).toEqual([]);
    expect(warned.tooTight, `sync warning: ${warned.tooTight.join("; ")}`).toEqual([]);
    expect(warned.lowContrast, `sync warning: ${warned.lowContrast.join("; ")}`).toEqual([]);
    expect(warned.checked, "sync warning: examined no nodes").toBeGreaterThan(5);
  });

  // The wizard chooser and the wizard form are named states in task 1.4's
  // fixture, and they were previously evaluated only headlessly -- so a
  // browser-only regression in their chrome, text metrics or contrast passed
  // unseen. They are driven here through the page's own MIDI discovery rather
  // than injected, so what is measured is the real surface.
  test("the wizard chooser and form meet the structural criteria", async ({ page }) => {
    await installTwisterPair(page, 1);
    await installTwisterPair(page, 2);
    await openSurface(page, "controllers");
    const launch = page.locator(synthNode("runtime.controllers.wizard.launch"));
    await expect(launch).toBeEnabled({ timeout: 10_000 });
    await launch.click();

    const chooserCandidates = page.locator(
      '[data-synth-node-id^="runtime.controllers.wizard.chooser.candidate."]');
    await expect(chooserCandidates).toHaveCount(2);
    const chooser = await evaluateStructuralCriteria(page);
    expect(chooser.overflows, `chooser: ${chooser.overflows.join("; ")}`).toEqual([]);
    expect(chooser.overlaps, `chooser: ${chooser.overlaps.join("; ")}`).toEqual([]);
    expect(chooser.silentText, `chooser: ${chooser.silentText.join("; ")}`).toEqual([]);
    expect(chooser.tooTight, `chooser: ${chooser.tooTight.join("; ")}`).toEqual([]);
    expect(chooser.lowContrast, `chooser: ${chooser.lowContrast.join("; ")}`).toEqual([]);
    expect(chooser.checked, "chooser: examined no nodes").toBeGreaterThan(5);
    // Two Twisters are discovered and unconfigured, so the sidebar's warning
    // badge is on screen. This is the one state in the browser half where the
    // badge exemption has a live subject, so the "sits inside its target" pin
    // above is real coverage rather than an absence.
    expect(chooser.badgesSeen,
      "chooser: no declared badge rendered, so the badge exemption was never exercised")
      .toBeGreaterThan(0);

    await chooserCandidates.first().click();
    await expect(page.locator(synthNode("runtime.controllers.wizard.submit"))).toBeVisible();
    const form = await evaluateStructuralCriteria(page);
    // The Twister form declares itself wider than the 640 page that shows it
    // (664 when the overhang was found, 684 now that the message selectors were
    // widened to stop clipping their own text), and it used to overhang and be
    // clipped. The page now hosts it in a ScrollArea, and containment is against
    // that region's scroll-content rectangle. A regression here means the form
    // is being cut off again.
    expect(form.overflows, `wizard form: ${form.overflows.join("; ")}`).toEqual([]);
    expect(form.overlaps, `wizard form: ${form.overlaps.join("; ")}`).toEqual([]);
    expect(form.silentText, `wizard form: ${form.silentText.join("; ")}`).toEqual([]);
    expect(form.tooTight, `wizard form: ${form.tooTight.join("; ")}`).toEqual([]);
    expect(form.lowContrast, `wizard form: ${form.lowContrast.join("; ")}`).toEqual([]);
    expect(form.checked, "wizard form: examined no nodes").toBeGreaterThan(20);

    // And the fields the old overhang cut off are reachable by scrolling
    // rather than lost.
    const scroll = page.locator(synthNode("runtime.controllers.wizard.form.scroll"));
    await expect(scroll).toHaveCount(1);
    const argument = page.locator(synthNode("controller-wizard.twister.button.5.argument"));
    await expect(argument).toHaveCount(1);
    await argument.scrollIntoViewIfNeeded();
    await expect(argument).toBeInViewport();
  });

  test("a second root extent redistributes weighted children in the rendered DOM", async ({ page }) => {
    await openSurface(page, "sync");
    const measure = async () => page.evaluate(() => {
      const rect = (id: string) => {
        const el = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
        return el ? el.getBoundingClientRect() : null;
      };
      const status = rect("runtime.sync.status");
      const back = rect("runtime.sync.back");
      const form = rect("runtime.sync.form");
      const root = rect("runtime.sync.root");
      return {
        rootHeight: root?.height ?? 0,
        weighted: status?.height ?? 0,   // the absorbing region
        fixedButton: back?.height ?? 0,  // Extent::Px, must not move
        intrinsicForm: form?.height ?? 0 // intrinsic stack, must not move
      };
    });

    const narrow = await measure();
    // The surface height comes from the app's declared `uiHeight`, so the root
    // extent is changed the only way a real host can change it: a taller
    // window, re-fitted and re-rendered.
    await page.setViewportSize({ width: VERIFICATION_VIEWPORT.width, height: VERIFICATION_VIEWPORT.height + 400 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const wide = await measure();
    await page.setViewportSize({ ...VERIFICATION_VIEWPORT });

    expect(narrow.rootHeight, "the narrow measurement rendered a real surface").toBeGreaterThan(0);
    // A viewport change must not resize a fixed or intrinsic child: if it does,
    // something outside the library is sizing them.
    expect(wide.fixedButton).toBeCloseTo(narrow.fixedButton, 1);
    expect(wide.intrinsicForm).toBeCloseTo(narrow.intrinsicForm, 1);
    // ... and the absorbing region is the only thing that may move, in step
    // with whatever the root did.
    expect(wide.weighted - narrow.weighted).toBeCloseTo(wide.rootHeight - narrow.rootHeight, 1);
  });
});
