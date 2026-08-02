## Why

The portable UI layer has two disjoint authoring paths that share no code, no
way to put a colour on a semantic control, a coordinate model so ambiguous
that both backends literally guess what space draw commands are in, and —
contrary to first appearances — a hidden backend-side layout engine that
positions most Builder-built controls by a wrapping cursor with its own
embedded guess. Every page producer hand-positions absolute pixel bounds,
the config pages bypass the public `ui::Builder` entirely, and the result is
visibly ugly, unlayered, and hard to extend. A third-party client building a
real app on the public API hit the walls first, but the walls are
structural, not point defects:

- `ui::Builder` (`projects/synth/include/synth/PortableUIBuilders.hpp`) has no
  container method at all — `AppendChild` (line 412) always appends to the
  root, so every Builder tree is one root plus N flat leaves. The model's
  `Row`/`Section`/`ScrollArea` kinds (`PortableUI.hpp:137-150`) are
  unreachable through the public API.
- The runtime config pages therefore hand-roll `ui::Node` structs — 115
  `ui::Node` sites in `RuntimePages.hpp` (1515 lines), 186 in
  `ControllersPageUI.hpp` (3132 lines), zero `Builder` calls — with manual
  pixel arithmetic (`y += Layout::kRowHeight + Layout::kRowGap` and friends).
  Adding one caption row means shifting every offset below it by hand.
- Meanwhile every `Builder` semantic leaf sets **no bounds at all** (only
  `Root`, `Draw`, and `DrawInteractive` assign `node.bounds` —
  `PortableUIBuilders.hpp:276,385,399`). Those controls are positioned by a
  backend auto-flow engine: a wrapping cursor with hardcoded margins and
  per-kind default sizes in the JUCE backend (`FlowCursor`,
  `DefaultSizeForNode`, `kControlMargin`/`kControlGap` —
  `PortableJuceBackend.hpp:346-347,590,744-799`), duplicated in the browser
  (`cursors`, `defaultSize`, `CONTROL_MARGIN`/`CONTROL_GAP` —
  `ui.ts:33-34,388-418,448`). Its starting y is itself a guess: it scans for
  the lowest explicitly-bounded `Draw` node under the same nearest root and
  starts below it (`PortableJuceBackend.hpp:766-780`, mirrored
  `ui.ts:395-399`). So layout policy lives in two renderers that must agree,
  and Builder-built apps (Braid 4, Mini App, the client) have no layout of
  their own.
- Coordinates are surface-absolute and ambiguous. Because node bounds and
  draw geometry all live in one global space, both backends carry a second
  guess of the same species — `DrawPointLooksLocal` /
  `DrawCommandLooksLocal` / `DrawCommandsLookLocal`
  (`PortableJuceBackend.hpp:65-130`, threaded as a `nodeLocal` flag through
  ~15 sites in `PaintDrawCommand`, mirrored at `ui.ts:465-501`) — that
  decides per node whether draw commands are node-local or surface-absolute
  by inspecting the numbers. A component cannot be position-independent when
  every producer computes global coordinates.
- Semantic controls carry no colour. Styling is `Node::variant`, a closed set
  of ad-hoc strings matched against hardcoded RGB constants in the JUCE
  backend (`PortableJuceBackend.hpp:1119-1158`). The browser backend
  serializes the field (`BrowserCommandBuffer.hpp:448`, `protocol.ts:170`)
  and then never reads it — every browser button gets one flat CSS look.
  `DrawCommand` carries an app-supplied `synth::Color` end to end, which is
  why authors escape to `Draw` to get any visual control at all.

The requested outcome, in the product owner's words: one library, components
configurable and composable, colour and text settings ("a green button in
the app should be doable by simply creating a green button"), all
coordinates hierarchical and relative to the node they live in — never
guessed — renderers "as dumb as possible", everything principled, properly
layered, clear, and resizable ("mathematically-in-theory, not 'we must
implement window resizing in this diff'"), one standard layout shared by both
first-party apps, hierarchical config pages with like controls
aligned, no useless text, and it must look better — verified by a
Playwright-driven visual iteration loop, not asserted. Scope is explicitly
not the constraint; a bigger refactor that lands those properties is
preferred over a trimmed one.

## What Changes

- **One authoring library.** The portable component library becomes the single
  way to build portable trees: hierarchical containers (columns, rows,
  sections, scroll areas) nest to arbitrary depth, and reusable components can
  compose other components. `RuntimePages.hpp` and `ControllersPageUI.hpp`
  migrate onto it; hand-rolled `ui::Node` assembly in page code is retired.
  Hierarchy itself needs no protocol change: `Node::children` already
  serializes (`BrowserCommandBuffer.hpp:464`, decoded at 616-618) and the
  browser already walks it into real DOM nesting (`ui.ts` `attachChildren`).
- **Hierarchical coordinates all the way.** `Bounds` becomes parent-relative
  throughout: a node's bounds are expressed in its parent's coordinate space,
  and `Draw` command geometry is node-local. This deletes the `nodeLocal`
  guessing heuristic from both backends outright and makes components
  position-independent — a component never knows or computes its global
  position, which is what makes composition work at all.
- **All layout moves producer-side; the backend auto-flow engine dies.**
  The library's layout resolver (stacking, gaps, padding, fixed/weighted/
  intrinsic sizes, form-grid label columns) resolves every node's
  parent-relative `Bounds` before the tree leaves the producer. The backend
  flow cursor, its per-kind default-size tables, and its lowest-Draw
  starting-y guess are deleted from both backends. Intrinsic sizes —
  including text extents — come from a library-owned metrics contract, not
  from toolkit measurement (see design.md for the decision and its
  alternatives).
- **Renderers become as dumb as possible, normatively.** A backend receives
  a fully resolved tree and paints it: it does not lay out, does not infer
  coordinate space, does not default sizes, does not decide appearance.
  Four named deletions in both backends: the `LooksLocal` draw-geometry
  classifier family, the `ExplicitBoundsAreParentLocal` node-bounds
  classifier, the auto-flow cursor, and the hardcoded colour constants.
  Pinned by a checkable requirement: no backend computes a position that is
  not derivable from the node's own resolved bounds plus its ancestors'
  origins.
- **Colour and text style are direct component properties.** A component
  takes a colour — plain RGBA on the node record, exactly the way
  `DrawCommand::color` already carries `synth::Color` today — and a text
  style, with no indirection. A producer that wants a green button makes a
  green button. Where a producer keeps its colour constants is its own
  business, not something this change specifies.
- **Extent-driven layout.** The resolver derives everything from the extent
  it is given, with no compiled-in surface size, so rebuilding the same
  producer code against a different root extent redistributes correctly.
  That makes resizing a mathematical property of the layout system rather
  than a feature. Implementing host window resizing is **not** in scope, and
  the existing uniform `surfaceScale` transform (`ui.ts:278-287`) is left
  exactly as it is.
- **A standard application layout.** One reusable component — a title row, a
  visualizer column of two stacked slots, an encoder region beside it, and an
  optional widget bay across the bottom. The slots take arbitrary
  app-supplied components; the layout prescribes no grid, cell count, or
  content kind. Braid 4 puts grids of scope cells in its slots, Mini App puts
  a waveform. Proportions come from the arithmetic both apps already share —
  `MiniAppPageLayout` and `Braid4PageLayout` are the same layout with the
  same constants, so this deletes duplication rather than inventing a design.
  It doubles as the proof that the library really composes.
- **Explicit layering, pinned by requirement.** Model (`Node`/`NodeTree`) →
  component library + layout resolver → producers (config pages and apps) →
  backends (dumb renderers). Each layer's allowed knowledge is stated and
  enforced by include-graph inspection and JUCE-free compile tests.
- **BREAKING: command-buffer version 1 → 2, no backwards compatibility.**
  One deliberate break covering both wire changes: parent-relative bounds
  semantics and the new colour/text-style node fields. The strict version
  equality check stays on both ends (`BrowserCommandBuffer.hpp:503`,
  `protocol.ts:103`). The decoder is shell-owned — `browser/public/index.html:11`
  loads the shell bundle, and `browser/src/main.ts:10` imports the UI
  backend from `./ui.js`, while per-app packages carry the Wasm encoder — so
  the shell and every app package are rebuilt and republished together,
  which is how `sbap-3` publication already works (whole-catalog,
  all-or-nothing, deterministic). No dual-version decode, no v1 fallback, no
  negotiation. Any future third-party package published through catalog
  federation must be built against the same version.
- **Config pages rebuilt.** Audio, Sync, File, and Controllers pages are
  rebuilt on the library: real nesting, aligned columns, captioned form
  controls (subsuming the Audio-page caption fix), and a content audit that
  removes text carrying no information while keeping every spec-pinned
  behavior and readout. Existing `sru-*` behavioral requirements keep holding.
- **Draw nodes dispatch a plain click.** `Node::action` is carried on every
  node but read for `NodeKind::Draw` by neither backend, so a custom-drawn
  node is drag-only or double-click-only and no Sheaf app can have a
  single-click custom-drawn control. Folded in from the retired
  `fix-portable-ui-control-gaps` change.
- **First-party apps get real layout.** Because Builder-built semantic
  controls are positioned by the backend cursor today, Braid 4 and Mini App
  do not have layout to "migrate" — it must be authored for the first time.
  Their `Draw`/canvas content stays pixel-identical (in node-local
  coordinates); their semantic controls are deliberately re-laid-out through
  the resolver and re-baselined. "Visuals unchanged" applies to drawn
  content and behavior, not to cursor-flowed control positions.
- **A verifiable "looks better".** Named visual acceptance criteria,
  Playwright structural assertions (column alignment, overflow, caption
  presence, text fitting its allocated extent), screenshot baselines with a
  human sign-off gate, and an explicit rule for telling regression from
  intended change.

Not changing: the kind-tagged `Node`/`NodeTree` model shape (it gains style
fields and its bounds change meaning, but stays one flat serializable
struct), the action dispatch contract, page semantics, or app-owned `Draw`
visuals. Theming — token vocabularies, default-theme-plus-overrides, any
styling indirection — is explicitly out of scope; if it ever happens it will
be a pure C++ layer built on top of what this change delivers.

## Capabilities

### New Capabilities

None. The portable UI layer's requirements live in `synth-runtime-ui`
(sru-14, sru-20, sru-21, sru-34 are already portable-UI requirements there);
introducing a second capability for the same layer would scatter the
contract.

### Modified Capabilities

- `synth-runtime-ui`: eleven ADDED requirements — single hierarchical
  authoring library (sru-43), declarative build-time layout with
  library-owned intrinsic metrics (sru-44), direct colour and text style on
  components (sru-45), hierarchical parent-relative coordinates over a
  version-2 command buffer (sru-46), config pages rebuilt on the library
  (sru-47), named visual acceptance criteria with a Playwright
  visual-iteration loop (sru-48), dumb renderers (sru-49), extent-driven
  layout (sru-50), enforced layering (sru-51), Draw node click actions
  (sru-52), and the standard application layout (sru-53).
- `synth-portable-runtime-shell`: three MODIFIED requirements.
  - `sprs-2` currently pins "absolute surface-space node coordinates",
    per-descendant sidebar translation, and backend "auto-flow" containment;
    under parent-relative coordinates and producer-side layout the shell
    places subtree roots (descendants follow for free) and hands backends
    fully laid-out trees, so the requirement is restated while its behavior
    (app content intact, 96-pixel additive sidebar) is preserved.
  - `sprs-6` currently *requires* the browser backend to "treat resolved node
    bounds as absolute surface coordinates", to "resolve unbounded controls
    within their nearest nested root", to "include resolved auto-flow content
    in the host height", and to size unbounded labels for their content —
    every one of which this change deletes. Restated for parent-relative
    bounds, resolver-owned extents, and backend-side text fitting.
  - `sprs-9` currently *requires* the JUCE backend to "resolve parent-local
    explicit bounds exactly once while preserving surface-absolute bounds",
    to flow unbounded controls, and it writes the `LooksLocal` draw-coordinate
    rule into the specification verbatim; it also pins "browser and JUCE main
    pages remain unchanged", which D10 contradicts. Restated for
    parent-relative placement, node-local draw geometry, no classification of
    any kind, and re-authored app control positions.

  Without these two additional deltas the specification would be
  unsatisfiable: implementing sru-46 and sru-49 necessarily violates sprs-6
  and sprs-9 as they stand on main.

**ID allocation.** `openspec/specs/synth-runtime-ui/spec.md` ends at
`sru-34`, but two unsynced deltas hold six ADDED requirements at colliding
IDs (`add-browser-wasm-runtime`: sru-21/22/23; `rework-controllers-block-editing`:
sru-14/15/16 — both colliding with different requirements already on main).
This change allocates `sru-43`–`sru-53`, leaving `sru-35`–`sru-40` free for
the colliding deltas to be renumbered into. `sru-41`/`sru-42` were drafted by
the now-retired `fix-portable-ui-control-gaps` change but never landed on
main; they are left unused rather than recycled. Verify the block is still
free before implementing.

### Capabilities considered and not touched

- `synth-browser-app-packaging` (`sbap`): the coordinated republish relies on
  `sbap-3`'s whole-catalog all-or-nothing publication but does not change
  packaging requirements.
- `synth-braid-4`, `synth-miniapp-ratio-grid`: behavioral specs are
  unchanged; the apps' semantic-control layout is authored anew through the
  library (see What Changes) without altering what the apps do.
- The unsynced `add-browser-wasm-runtime` delta specs (`sbw-6`, its
  `sru-21`/`sru-22`) describe the command-buffer backend and will need their
  serialization wording refreshed when they sync; that is renumbering-time
  work for that change, noted here so it is not lost.

## Origin: the retired `fix-portable-ui-control-gaps` change

A third-party client building on the public API raised four asks — Draw-node
single click, selected state on buttons, Audio-page captions, and an image
draw primitive. A narrow change was drafted to patch each one, then retired
in favour of this proposal once it became clear all four were symptoms of the
same structural gaps. Where each landed:

- **Draw click actions** — folded in here as `sru-52`, with the library
  carrying the click action as an ordinary construction parameter.
- **Selected state on buttons** — subsumed by direct colour properties
  (`sru-45`), which give selection a real rendered treatment in both backends
  instead of a hardcoded constant the app cannot reach.
- **Audio-page captions** — subsumed by `sru-47`'s general
  captioned-form-controls rule and the Audio page rebuild.
- **The image draw primitive** — still out of scope, and still worth its own
  proposal. It needs a new `DrawCommand::Kind`, another wire change, and an
  asset delivery path for both backends; the client flagged it as non-urgent.

The narrow change's directory has been deleted. Its `sru-41`/`sru-42` were
never issued against main and are left unused.

## Impact

Affected code (implementation, after approval — none of it touched by this
proposal):

- `projects/synth/include/synth/PortableUIBuilders.hpp` — becomes the
  component library: container scopes, parent-relative layout resolution,
  library-owned intrinsic metrics, colour/text-style parameters, component
  composition. The flat 12-method Builder surface is subsumed.
- `projects/synth/include/synth/PortableUI.hpp` — `Bounds` semantics become
  parent-relative (node bounds in parent space, `Draw` geometry node-local);
  `Node` gains direct colour and text-style fields; `Node`/`NodeTree` shape
  otherwise preserved.
- `projects/synth/juce/PortableJuceBackend.hpp` — four deletions: the
  `nodeLocal` coordinate-guessing heuristic (lines 65-130 and its ~15
  `PaintDrawCommand` call sites), the `ExplicitBoundsAreParentLocal`
  node-bounds guess and its conditional translation (825, 836-847), the
  auto-flow engine (`FlowCursor`,
  `DefaultSizeForNode`, margins, lowest-Draw start-y scan; 346-347, 590,
  744-799), and the hardcoded colour-constant functions (1119-1158,
  demoted to absent-value defaults at most). Parent-walking bounds
  resolution (`SemanticHostFor`, `HostLocalBounds`, `m_resolvedByNodeId`)
  simplified since wire bounds arrive parent-relative.
- `projects/synth/include/synth/browser/BrowserCommandBuffer.hpp`,
  `projects/synth/browser/src/protocol.ts`, `projects/synth/browser/src/ui.ts`,
  `projects/synth/browser/public/synth-browser.css` — version 2 encode/decode
  (bounds semantics + style fields); the same four deletions in the browser
  (`ui.ts:465-501` draw classifier, `ui.ts:382,440` node-bounds classifier,
  `ui.ts:33-34,388-418,448` auto-flow, flat CSS as sole styling);
  parent-origin subtraction (`ui.ts:101-102`) deleted;
  carried styles rendered; a `click` listener for `NodeKind::Draw`
  (`sru-52`); `surfaceScale` (`ui.ts:278-287`) left as is.
- `projects/synth/include/synth/RuntimePages.hpp`,
  `ControllersPageUI.hpp` — rebuilt on the library; manual `y +=` layout
  arithmetic and hand-rolled node assembly removed; colour and text-style
  constants extracted into the config-pages layer.
- `projects/synth/include/synth/RuntimeMainComponent.hpp` and shell
  composition — subtree placement instead of per-descendant translation
  (MODIFIED `sprs-2`).
- `projects/synth/apps/braid-4/`, `projects/synth/apps/miniapp/` — both
  rebuilt on the standard application layout (`sru-53`); their semantic
  controls get authored layout for the first time (currently cursor-flowed),
  `Braid4PageLayout`/`Braid4EncoderGridLayout`/`EncoderGridLayout` lose their
  surface-level position arithmetic, and draw geometry moves to node-local
  coordinates with pixels unchanged.
- Tests: `portable_ui_tests.cpp`, `controllers_page_ui_tests.cpp`, JUCE
  simulation suites, browser contract tests, and the Playwright suite
  (`projects/synth/browser/tests/*.spec.ts`, run via `make synth-browser-test`)
  which gains the visual-iteration loop, extent-redistribution coverage, and
  its baselines.
- Publication: shell bundle and all app packages rebuilt and republished
  together per `sbap-3`.

Risk concentration: the Controllers page (3132 lines of hand-rolled UI backed
by sru-4–sru-11, sru-26–sru-33's dense behavioral contracts) is the hardest
migration; the design stages it last behind the simpler pages. Position-
sensitive tests will fail wherever layout or coordinate space intentionally
changes — wanted failures, to be re-pinned, not loosened.
