## Context

Verified current state (all file references read during proposal work):

- **Model** — `projects/synth/include/synth/PortableUI.hpp` (300 lines).
  Twelve `NodeKind`s including the containers `Row`, `Section`, `ScrollArea`;
  one flat `Node` struct (line 152) carrying every field for every kind,
  including `children`, `variant`, `selected`, `enabled`, three optional
  actions, and `drawCommands`. Kind-tagged, serializes cleanly, consumed by
  both backends. Sound; kept (extended, not reshaped).
- **Two authoring paths.** `ui::Builder`
  (`PortableUIBuilders.hpp:270-421`) has 12 leaf methods and no container
  method; `AppendChild` (line 412) always appends to `rootIndex_`, which only
  `Root()` sets, so every Builder tree is one root plus flat leaves. The
  runtime config pages consequently hand-roll `ui::Node` structs — 115
  `ui::Node` sites in `RuntimePages.hpp`, 186 in `ControllersPageUI.hpp`,
  zero `Builder` calls — with manual pixel arithmetic against
  `Layout::kPageMargin` / `kRowGap` / row-height constants
  (`RuntimePages.hpp:252-255` and ~20 accumulation sites).
- **A backend-side auto-flow engine positions everything else.** Every
  `Builder` semantic leaf sets no bounds (only `Root`/`Draw`/`DrawInteractive`
  assign `node.bounds` — `PortableUIBuilders.hpp:276,385,399`). Nodes
  without explicit bounds are positioned by a wrapping cursor in each
  backend: JUCE `FlowCursor` with `DefaultSizeForNode` and
  `kControlMargin`/`kControlGap`
  (`PortableJuceBackend.hpp:346-347,590,744-799`), browser `cursors` with
  `defaultSize` and `CONTROL_MARGIN`/`CONTROL_GAP`
  (`ui.ts:33-34,388-418,448`). The cursor's starting y is a guess: it scans
  for the lowest explicitly-bounded `Draw` node under the same nearest root
  and starts below it (`PortableJuceBackend.hpp:766-780`, mirrored
  `ui.ts:395-399`). Consequence: Braid 4's and Mini App's semantic controls
  (e.g. `builder.Label(kTitle, ...)`) have no authored layout at all —
  their positions are backend policy, duplicated in two implementations.
- **Coordinates are ambiguous in *two* independent ways, and both backends
  guess twice.** The first guess is about draw geometry, the second — missed
  by an earlier draft of this document and corrected here — is about node
  bounds themselves.

  *Node bounds are not uniformly global.* Producers today are mixed:
  `ControllersPageUI.hpp:2417-2420` emits nested children in parent-local
  coordinates, while `RuntimePages.hpp:698-750` (the File page's nested
  browser rows) emits them surface-absolute. Both backends reconcile this
  with a containment heuristic of exactly the same species as the draw
  guess: `ExplicitBoundsAreParentLocal` (`PortableJuceBackend.hpp:825,836`)
  and `explicitBoundsAreParentLocal` (`ui.ts:382,440`) declare a child's
  bounds parent-local if they happen to fall inside the parent's extent and
  surface-absolute otherwise, then translate or not accordingly. This is a
  **fourth** classifier, and any account of this change that names only
  "three deletions" is incomplete: it must die with the others, and the
  producers it currently rescues (the File page above all) must be converted
  in the same series that deletes it.

  *Draw geometry* may be node-local or surface-absolute, and both backends
  guess which: `DrawBoundsLookLocal` / `DrawPointLooksLocal` /
  `DrawCommandLooksLocal` / `DrawCommandsLookLocal`
  (`PortableJuceBackend.hpp:65-130`) classify a node's command list by
  checking whether every coordinate falls inside the node's own extent, and
  the verdict is threaded as a `nodeLocal` flag through ~15
  `ResolveDrawBounds`/`ResolveDrawPoint` sites in `PaintDrawCommand`
  (lines 143-266) and cached per component
  (`commandsAreNodeLocal_`, line 503). The browser mirrors the whole
  heuristic (`ui.ts:465-501`, applied at 295-325). Meanwhile the JUCE
  backend re-derives parentage to position components (`m_resolvedByNodeId`
  surface-bounds bookkeeping, `SemanticHostFor` parent-walking at 850-880,
  `HostLocalBounds` origin subtraction at 881) and the browser subtracts
  parent origins by hand (`ui.ts:101-102`) even though it already nests
  children into real DOM parents (`attachChildren`).
- **Surface scaling.** The browser applies a shrink-only uniform transform
  when the viewport is narrower than the surface: `surfaceScale = min(1,
  availableWidth / surfaceWidth)` set as a CSS `scale(...)` on the surface
  root (`ui.ts:278-287`), with pointer deltas divided back by the scale
  (`ui.ts:176-177`). There is no reflow anywhere: narrow viewports get
  smaller pixels, not rearranged content.
- **Semantic controls carry no colour.** `Node::variant` is a closed string
  set matched against hardcoded RGB in `PortableJuceBackend.hpp:1119-1158`
  (`TextColourForNode` / `ButtonColourForNode`); the browser interns and
  serializes `variant` (`BrowserCommandBuffer.hpp:382,448`), decodes it
  (`protocol.ts:170`), and `ui.ts` never reads it. `DrawCommand` by contrast
  carries app-supplied `synth::Color` end to end — which is why authors
  escape to `Draw` for any visual control.
- **Wire format and topology.** `kCommandBufferVersion = 1` with strict
  equality checks on both ends (`BrowserCommandBuffer.hpp:503`,
  `protocol.ts:103`). The decoder is shell-owned:
  `browser/public/index.html:11` loads `../dist/src/main.js`, and
  `browser/src/main.ts:10` imports `BrowserUiBackend` from `./ui.js` — so
  `protocol.ts`/`ui.ts` ship in the shell bundle and one decoder serves
  every catalog package, while the per-package artifacts (`sbap-3`) are the
  Wasm module and its emscripten entry, which hold the encoder.
  Consequence: a version bump requires the shell and every package to
  deploy (and roll back) together.
- **Hierarchy already crosses the wire.** `Node::children` serializes
  (`BrowserCommandBuffer.hpp:464-465`), decodes (616-618), and the browser
  builds real DOM nesting from it; `Row`/`Section`/`ScrollArea` are accepted
  kinds in both backends (`PortableJuceBackend.hpp:1100-1113`).
- **Verification assets.** JUCE-free unit tests (`portable_ui_tests.cpp`,
  `controllers_page_ui_tests.cpp`), JUCE simulation suites
  (`ControllersPageSimulationTests.cpp`, `RuntimeShellSessionTests.cpp`),
  browser Playwright suite (`projects/synth/browser/tests/*.spec.ts`, with an
  existing `tests/screenshots/` directory, run via `make synth-browser-test`).
- **Retired narrow change** `fix-portable-ui-control-gaps`: drafted to patch
  the client's four asks individually, then deleted in favour of this
  proposal. Its Draw-click content is folded in here as sru-52; see the
  proposal's origin section for where the rest landed.

Stakeholders: the third-party client building on the public API; first-party
apps (Braid 4, Mini App); the runtime config pages; both backend
maintainers. The product owner has stated that scope is not the constraint:
the bar is principled, properly layered, clear, and resizable, with all
coordinates hierarchical and renderers as dumb as possible.

## Goals / Non-Goals

**Goals:**

- One authoring library expressive enough that the config pages need no
  private node assembly: nested containers, composable components, layout
  without hand pixel arithmetic.
- Hierarchical, parent-relative coordinates throughout — node bounds in the
  parent's space, `Draw` geometry node-local — never guessed.
- All layout and sizing policy producer-side; renderers as dumb as possible:
  a backend paints a fully resolved tree and does not lay out, infer
  coordinate space, default sizes, or decide appearance. Four named
  deletions per backend: the `LooksLocal` draw-geometry classifier family,
  the `ExplicitBoundsAreParentLocal` node-bounds classifier, the auto-flow
  cursor, the hardcoded colour constants.
- Colour and text style as direct component properties: a green button is
  made by creating a green button.
- Extent-driven layout, so resizability holds as a mathematical property:
  rebuilding against a different root extent redistributes correctly, with
  no compiled-in surface size anywhere. Implementing host window resizing is
  not part of this change.
- One standard application layout shared by Braid 4 and Mini App, doubling
  as the proof that the library genuinely composes.
- Explicit, enforced layering: model → component library/resolver →
  producers (config pages, apps) → wire codec → backends.
- One deliberate protocol break (version 2) carrying both wire changes,
  with no backwards compatibility, deployed as a whole-catalog republish.
- Rebuilt config pages that keep every existing behavioral requirement while
  looking deliberately designed: aligned columns, consistent spacing,
  captioned controls, no filler text.
- A repeatable, partly machine-checked way to verify "looks better".

**Non-Goals:**

- **Theming, in any form.** No theme tokens, no colour roles, no
  default-theme-plus-overrides, no styling indirection, nothing themed on
  the wire. If theming ever happens it will be a pure C++ higher layer built
  on top of the direct-property components this change delivers. Out of
  scope here.
- **Backwards compatibility.** Explicit decision: no dual-version decode, no
  v1 fallback, no version negotiation. Strict equality stays; everything
  rebuilds and republishes together.
- A retained-mode widget toolkit, constraint solver, or reactive framework.
  The library remains an immediate-mode tree producer.
- Exact cross-backend text measurement. Text extents are a library-owned
  reservation contract, not toolkit measurement (D4); pixel-identical glyph
  layout across JUCE and the browser is not attempted.
- An image draw primitive. The client's fourth ask, still deferred to its own
  proposal — it needs a new `DrawCommand::Kind`, another wire change, and an
  asset delivery path for both backends.
- Host window resizing. sru-50 establishes the layout property that makes it
  possible; wiring it up, and reconciling it with the existing uniform
  `surfaceScale`, is separate work.
- Changing what the apps do: Braid 4's drawn identity (`sru-22`) keeps its
  pixels (in node-local coordinates). Its and Mini App's semantic-control
  *positions* are re-authored — see D10; pretending those are unchanged is
  not possible once the backend cursor that produced them is deleted.
- Renaming or re-keying existing node IDs or action names; tests and both
  backends key off them.

## Decisions

### D1: The library is a producer-side layer over the (extended) Node model

The component library builds `NodeTree`s; it does not replace them. Backends
keep consuming the same kind-tagged nodes. The model changes are additive
fields (colour, text style — D5) plus a semantics change to `Bounds` (D6);
the struct's shape and the action/children contracts are untouched.

Alternatives considered: (a) retained widget objects with per-backend
adapters — rejected: discards a working serialization/parity story (sru-33's
two-backend contract is proven against `NodeTree`) and multiplies backend
work; (b) redesigning `Node` into per-kind structs — rejected: churn across
both backends and the wire for zero user-visible gain; the flat struct is
inelegant but load-bearing and cheap.

Hierarchy and composition need **no** protocol change beyond the
coordinate-semantics shift: `Node::children` already serializes and the
browser already renders it as DOM nesting (see Context). The version-2 break
exists for coordinates and style fields, not for hierarchy.

### D2: Container scopes are lambda-based; a component is any callable taking the builder

Containers open as scoped calls taking a child-emitting callable, e.g.
`b.Column(id, opts, [&](ui::Builder& b){ ... })`, with `Row`, `Section`,
`ScrollArea` analogous. A reusable component is then nothing special: any
function `void(Builder&)` (typically a small struct with config fields and an
`operator()` or `Emit(Builder&)`), so components compose other components by
calling them — which is the "configurable, calling each other" requirement
with zero framework machinery. Parent-relative coordinates (D6) are what
make this composition real: a component's emitted subtree is identical
wherever it is mounted, because nothing in it encodes a global position.

Alternatives: RAII `BeginColumn()`/`EndColumn()` pairs — rejected: unbalanced
scopes compile fine and corrupt trees at runtime; the lambda shape makes
nesting structurally correct by construction. A separate subtree-splice-only
API — insufficient alone, but `Splice(NodeTree)` is kept for surfaces that
already produce trees (the File page splices the patch-browser state
machine's output today per `sru-16`, and shell composition relies on subtree
grafting — which under D6 is placing the subtree root, full stop).

The existing 12 leaf methods survive with extended parameter objects
(colour, text style, caption, selected, enabled, actions, layout hints).
During migration the old flat signatures remain as thin shims so apps
compile; they are deleted in the final task of this change, not left as a
second dialect.

### D3: Layout is declarative, resolved at build time, parent-relative on the wire — and it is the *only* layout

The library computes each node's **parent-relative** `Bounds` during
`Build()`, in one pass over the container tree:

- `Column`/`Section`/`ScrollArea` stack children vertically; `Row` stacks
  horizontally. Each child declares fixed extent, an intrinsic default from
  the library's metrics contract (D4), or a weight over remaining space.
- A child may also declare a **fraction** of the container's content extent,
  and any child may declare a **minimum and maximum extent**. Neither is
  decoration: the standard layout's proportions are `min(390, width * 0.46)`
  and `min(462, remainder)` (D10a), which fixed/intrinsic/weight alone cannot
  express — and a plain weight is not a substitute, because `width * 0.46` is
  a fraction of the container's *content* width, while a weight divides only
  what is *left* after gaps and fixed siblings. At 700 wide with a 14-pixel
  gap, 0.46/0.54 weights would divide 686, not 700, and land on different
  numbers than the apps use today. So `Extent::Fraction(0.46).Max(390)` is the
  faithful expression, and it keeps sru-53's ban on layout arithmetic intact.

  **The allocation algorithm, stated once so two implementers cannot diverge:**

  1. Fixed, intrinsic, and fractional extents resolve first. A fraction is
     taken of the container's extent less its padding — before gaps and
     siblings are considered.
  2. Weights divide the main-axis space remaining after those extents, all
     inter-child gaps, and the container's padding.
  3. Every resolved extent is clamped to its declared `[minimum, maximum]`.
  4. Space freed or demanded by clamping is redistributed in **exactly one**
     further pass, across only those children that are weighted and not
     themselves clamped, in proportion to their weights.
  5. Residual space no eligible child can absorb is left unallocated at the end
     of the container. It is never forced onto a clamped child, and the pass is
     never repeated — this is a deterministic two-pass allocation, not an
     iterative solver, and leaving a few pixels unallocated is the deliberate
     price of that.
  6. If the children's minima exceed the container's extent, no child shrinks
     below its minimum, and the container **fails loudly** — see sru-54. An
     earlier draft of this rule let them "overflow in declaration order,
     deterministically, so the failure is visible rather than silently
     absorbed". That reasoning was wrong in practice: node content clips to its
     bounds, so an overflowing child is not visible at all, it is cut off.

     The Sync page demonstrated both halves. During 5.1-5.5 it overflowed its
     640x480 surface by 3.18px while its own containment test was pinned at
     780x585, where the broken layout fit — so a green test sat on top of
     clipped content until review noticed the two extents differed. That
     specific overflow was closed in 5.1-5.5's fix round by zeroing the status
     container's padding and re-pinning the test to 640x480. But the fix made
     the page *fit* rather than made it *absorb*, so the fixed-stack shape
     survived: the page still had nothing to take up slack, and any surface
     shorter than its fixed content would have clipped it again. Patching a page
     to fit one surface is exactly the fragility this rule now removes.

     Deterministic order is still what the resolver produces; what changed is
     that producing it is now an error rather than an accepted outcome.
  7. Infeasible minima are only one way to overspend a container, so the gate
     rule 6 names is general: **any** container whose in-flow children do not
     fit its stacking axis fails, with a diagnostic naming the container, the
     axis, the extent available, the extent required, and the first child in
     declaration order that does not fit. The two ways to absorb are a
     `ScrollArea`, whose children live in scroll-content space and whose
     published content extent keeps the tail reachable, and at least one
     weighted in-flow child. Three properties of the gate are load-bearing.
     It is judged on the children's **final** bounds, not on the extents
     allocated to them, because a form grid re-columns its rows after the row
     itself has placed them and the geometry a backend renders is the geometry
     that has to fit. It is walked **pre-order from the root**, so the
     outermost container that cannot hold its content is the one reported: a
     descendant squeezed by an ancestor's overflow is a symptom, and repairing
     it would not fix the page. And a `ScrollArea` and a wrapping `Row` are
     exempt along their own main axis, because both absorb it — what a wrapping
     row cannot fit across becomes cross-axis extent its parent then has to
     hold, and is caught there. This is **not** a ban on pixel extents: an item
     inside a scrolling list legitimately carries its own extent along the
     scroll axis, because a fraction of the container is circular for a list
     whose length varies.
- Padding and inter-child gaps come from the library's shared spacing
  metrics (plain C++ constants), not per-site numbers.
- A form-grid option on a container aligns descendant label/control columns
  to shared x-offsets within that container — this is what makes "things of
  like type line up vertically" a property of the layout system instead of
  authorial discipline.
- Explicit positioning remains a first-class opt-out: `Draw` nodes and
  canvas-style app surfaces (Braid 4 computes `Braid4PageLayout` bounds
  itself) keep passing explicit bounds — now expressed in the parent's
  space. Layout containers and explicitly-anchored children coexist; a
  container does not reposition an explicitly-anchored child. Such a child is
  **out of flow**: it consumes no stacking space, and its stacked siblings
  resolve exactly as they would if it were absent. (The in-flow alternative —
  an explicitly positioned child reserving a slot — was rejected: it makes
  overlay surfaces such as the sru-25 visualizer underlays impossible to
  express without a second opt-out.)
- **Out-of-flow is a positioning mode, not a property of `NodeKind::Draw`.**
  This distinction is load-bearing and an earlier draft blurred it. A `Draw`
  node may equally participate in flow — and must, for the standard layout to
  work at all: a scope grid or an encoder region *fills a slot* whose size the
  resolver decides, so the app cannot know the extent when it emits the node.
  Today's `Draw(id, bounds, commands)` requires the geometry up front, and
  every command builder (`BuildScopeWaveformCommands` and friends) needs an
  extent to generate against. Resolving this by keeping app-side region
  arithmetic would defeat sru-53; resolving it by treating every app canvas as
  out-of-flow would bypass slot layout entirely.

  So an in-flow `Draw` takes a **command factory** instead of fixed geometry:
  a callable the resolver invokes with that node's own resolved node-local
  extent, returning the commands. Layout stays a single build-time pass — the
  factory runs during resolution, once the node's extent is known and before
  the tree leaves the producer — and no backend is involved. This is what lets
  Braid 4 hand a scope grid to a slot and have it fill whatever the slot turns
  out to be, at any root extent.
- **There are two out-of-flow modes, not one** (found while building the
  standard layout in tasks 3.14-3.16; an earlier draft of this document had
  only the first). Explicit bounds cover the case where the producer knows the
  geometry. They cannot cover an **overlay**, and this document names overlays
  — the sru-25 visualizer underlays — as the very reason out-of-flow exists.
  The contradiction is exact: an underlay must cover the encoder above it
  precisely, but once that encoder is an in-flow grid cell the producer no
  longer knows its extent, so it has no explicit bounds to declare. The
  in-flow `Draw` command factory does not help, because it yields commands,
  not a second node's geometry.

  So a `LayoutOptions` may instead name the in-flow **sibling** it overlays.
  Such a child is out of flow on the same terms as an explicitly positioned
  one — it consumes no stacking space and its stacked siblings resolve as if
  it were absent — and it resolves, after its siblings, to exactly the target's
  resolved bounds. Anchoring to the target by id rather than adding a
  fill-the-parent mode keeps the encoder grid's node shape exactly as it is
  today (underlay and encoder as siblings), where fill-the-parent would have
  required a wrapper container per cell and sixteen extra hosted components
  per app. An overlay naming a node that is not an in-flow sibling collapses
  to nothing rather than guessing a position.
- Resolution is local by construction: a container resolves its children
  against its own extent and never consults an ancestor, so a resolved
  subtree is identical wherever it is mounted. Position independence is the
  property that makes reusable components possible and is pinned by spec
  scenarios (sru-44, sru-46).

Because this becomes the only layout, the backend auto-flow engine is
deleted, not deprecated: `FlowCursor`/`DefaultSizeForNode`/margins in JUCE,
`cursors`/`defaultSize`/margins in the browser, and the lowest-Draw
starting-y guess in both. Under version 2 every node arrives with resolved
bounds; a node without them is a producer bug and renders visibly at the
parent origin rather than being silently flowed. The previous draft of this
design killed the coordinate guess but left the auto-flow engine standing —
a contradiction: two layout systems, one of them duplicated across two
renderers with an embedded guess. Resolved: one layout system,
producer-side.

Rejected alternatives:

- **Keep/formalize the backend auto-flow** (bounds optional, backends flow
  the rest): layout policy would live in two implementations that must
  agree pixel-exactly, parity would remain untestable headlessly, and the
  start-below-the-lowest-Draw guess (or some successor guess) survives.
  This is the status quo's disease — and it is load-bearing for every
  Builder-built app today, which is a reason to remove it deliberately,
  not to keep it.
- **Full flexbox/constraint solver**: the pages need stacks, rows, grids,
  and weights. A solver adds failure modes (unsatisfiable constraints,
  performance cliffs) the product does not need. Wrapping — the one thing
  the cursor did that plain stacks do not — is provided as an explicit
  wrapping-row container option, resolved by the library, where a surface
  asks for it.
- **Status quo (manual arithmetic in pages + cursor for apps)**: the
  problem being solved.

### D4: Intrinsic sizing is a library-owned metrics contract

Deleting `DefaultSizeForNode` moves the question of "how big is a control"
— including "how wide does this text render" — into the library. The
important distinction, which an earlier draft of this document got wrong:

- **Measurement feeding layout** — the producer asking a backend how wide a
  string renders, then positioning from the answer — is what breaks dumb
  renderers. It round-trips layout through the toolkit, makes resolved
  geometry backend-dependent, and destroys headless determinism. Forbidden.
- **Fitting text into a box that has already been decided** — a backend
  shrinking, truncating, or clipping inside bounds the library resolved — is
  a purely local decision needing no knowledge of the surrounding tree. It
  does not compromise dumbness at all, and the backend (which knows its own
  font and its own rectangle) is the right owner for it. See D8.

So the library must decide extents without measuring, and the decision is:

**The library owns a metrics contract.** Per-kind intrinsic extents (row
heights, minimum control widths) are library constants — the successors of
today's duplicated `DefaultSizeForNode`/`defaultSize` tables, defined once.
Text-bearing extents are **reservations**, not measurements: width is
computed from character count times a conservative per-text-style advance
metric, plus padding. Fitting is the backend's half, per D8: each renders
text within the extent already resolved for it, using its own font stack.

What this buys: resolved bounds are deterministic, identical across
backends, and computable in JUCE-free tests — geometry can never disagree
between JUCE and Chrome because neither computes it. The residual
consequence is cosmetic rather than structural: *geometry* is
font-independent, while whether a given string *fits* its reservation is
font-dependent, so a backend whose font runs wide may truncate where the
other does not. Nothing moves when that happens — the node's bounds are
unchanged, so no other node is affected. The failure mode is therefore
visible truncation, never misalignment — and it is machine-checkable:
sru-48 gains a text-fit criterion (no text element
on the rebuilt pages may overflow or truncate within its allocated extent
at the reference viewport — in the DOM, `scrollWidth <= clientWidth` per
text element), so a too-tight metric fails CI naming the element. JUCE-side
text fit is spot-checked at the human sign-off gate; the reservation metric
is deliberately conservative so ellipsis is the exception.

Alternatives weighed:

1. **Explicit sizes required from every caller** — rejected: recreates
   manual pixel arithmetic for the commonest case (every label, button, and
   caption), which is the disease this change treats.
2. **A measurement callback from the active backend feeding layout** (library queries the
   toolkit during resolution) — rejected, and worth being explicit about
   why: it makes the renderer not-dumb (it participates in layout), makes
   resolved bounds depend on which backend is active — destroying
   cross-backend bounds identity, which parity suites (sru-33) and the
   headless JUCE-free tests rely on — and it breaks build-time determinism
   (JUCE-free tests could not resolve trees without a measurement stub,
   whose numbers would then be a third opinion).
3. **Embed a real font and measure it in the library** (library-owned exact
   metrics from a shipped font, both backends render that font) — the
   strongest alternative and the natural upgrade path. Rejected for this
   change on scope: it adds font embedding and loading to both backends to
   make the measurements true. The metrics-table API is shaped so exact
   per-glyph tables can replace the per-style advance estimate later
   without touching producers.
4. **Reservation by character count, with backend-side fitting** —
   chosen, as described; option 3 refines it later without a contract
   change.

### D5: Colour and text style are direct properties on the node record

A component takes a colour: plain RGBA carried on the node record, exactly
the way `DrawCommand::color` already carries `synth::Color` today. Text
style likewise — the existing `TextStyle` type (size, colour, align, in
`PortableUI.hpp:42-46`) carried directly. No token, no role name, no lookup,
no indirection. Fields are optional (`std::optional<Color>` /
`std::optional<TextStyle>`, with an explicit presence flag on the wire since
v1 has no presence encoding); an absent value renders the backend's plain
default look, so trees that set nothing still render.

**One colour, one meaning per kind.** "A green button" is only unambiguous
once it is stated which surface the value paints. The contract:

| Node kind | What the carried colour paints |
|---|---|
| `Button`, `Toggle` | the control fill |
| `ComboBox`, `TextField` | the field background |
| `Slider` | the filled-track accent |
| `Root`, `Row`, `Section`, `ScrollArea` | the container background fill |
| `Label`, `StatusText` | the text background — **not** the glyphs |
| `Draw` | nothing; draw commands carry their own colours |

Glyph colour always comes from `TextStyle::color`, never from the node
colour, so the two can never compete for the same pixel. A carried value
takes precedence over every backend constant for that node. Interaction
states — selected, hover, pressed, disabled — are **derived from the carried
colour** by each backend (brighten, dim, outline; each backend's own idiom)
rather than substituted from its palette; `Node::selected` therefore keeps
its job as the state flag and does not become redundant under direct
colours. When the colour is absent the backend's existing default look
applies in full, including its existing selected and disabled treatment.

**Captions are not a field.** A caption is an ordinary `Label` node the
library emits into the control's form-grid row, with its own stable id
derived from the control's. The `Node` record and the command buffer gain no
caption field, and `ComboBox::label` carries nothing at all: D-OQ5 retired the
combo-box meaning of that field rather than renaming it to `placeholder`, so
the caption path is the only path.

Where coherence comes from without a theme: producers naturally end up with
named constants they pass to the components they build, the way Braid 4
already does for draw commands. That is ordinary code organization, not a
mechanism this change specifies — no requirement says where a producer keeps
its colours.

Backend consequences: the JUCE backend's `TextColourForNode` /
`ButtonColourForNode` hardcoded constants stop deciding appearance — carried
values win; the constants survive at most as the absent-value default. The
browser renders carried colours/text styles (inline styles or per-node CSS
custom properties) instead of ignoring styling. `Node::variant` retires
entirely and leaves the version-2 wire schema: D-OQ1 found that every one of its
strings decided appearance and that `SetSemantics` carries no interaction
semantics behind it, so there is no residual to keep and no replacement field to
add.

Rejected alternatives: theme tokens with app overrides (cut by the product
owner — nobody asked for theming, and it was the wrong shape; a future theme
would be a pure C++ layer that computes these same direct properties);
keeping `variant` strings as the styling contract (a closed set whose
meaning lives in backend constants is the current bug, not a design).

### D6: Hierarchical coordinates all the way; both guessing apparatuses die

`Bounds` becomes parent-relative throughout the model and the wire: a node's
`bounds` are expressed in its parent's coordinate space (the root's in
surface space), and **all `Draw` command geometry is node-local** —
expressed against the owning node's own (0,0,w,h) box. This is a semantics
change to existing wire fields, carried in the same version-2 break as D5's
new fields so there is one break, not two.

Both guessing families die, not one. The node-bounds classifier
(`ExplicitBoundsAreParentLocal`, `PortableJuceBackend.hpp:825,836`;
`explicitBoundsAreParentLocal`, `ui.ts:382,440`) becomes unnecessary the
moment bounds are declared parent-relative — but it becomes *harmful* the
moment it is left in, because a legitimately parent-relative child whose
bounds happen to exceed its parent's extent (an overhanging overlay, a
scroll-content row) would be silently reinterpreted as surface-absolute.
Deleting it is therefore part of the same atomic flip, and the producers it
currently rescues must convert with it — see D12 for the File page, the one
production producer that emits nested children surface-absolute today.

Why this is the strongest move in the change: the backends' guesses exist
*only* because coordinate space is ambiguous today. The `LooksLocal` family
inspects every draw command's numbers to guess whether the producer meant
node-local or surface-absolute (`PortableJuceBackend.hpp:65-130` plus ~15
flag-threaded sites in `PaintDrawCommand`; `ui.ts:465-501`), and the
auto-flow cursor's starting y guesses page structure by scanning for the
lowest explicitly-bounded `Draw` node (`PortableJuceBackend.hpp:766-780`;
`ui.ts:395-399`). With declared parent-relative/node-local semantics and
producer-resolved layout (D3), both apparatuses are deleted, and a
wrong-space producer bug becomes visibly wrong instead of silently "fixed"
by a guess that happened to land.

What each backend simplifies to:

- **JUCE** already thinks in parent-relative component bounds. Today it
  reconstructs that view from absolute wire data: `m_resolvedByNodeId`
  stores computed surface bounds, `SemanticHostFor` walks parents to find
  the hosting component, and `HostLocalBounds` subtracts the host origin
  back off. With parent-relative wire bounds, a child's position inside its
  parent is the wire datum itself; the surface-bounds bookkeeping reduces to
  accumulation only where an ancestor is not realized as a component, and
  the subtract-what-we-just-added round trip disappears.
  `RetainedDrawComponent` paints node-local commands in its own component
  space with no translation at all.
- **Browser** nesting becomes the identity: children are already real DOM
  children of their parent element, and absolutely-positioned DOM children
  are natively parent-relative — the hand subtraction at `ui.ts:101-102`
  (`bounds.x - (parentBounds?.x ?? 0)`) becomes `bounds.x`, and the
  `parentBounds` plumbing goes away. Draw canvases paint node-local
  coordinates directly.

The `Draw` migration is the part most likely to hide a problem, so it is
stated explicitly: every producer that currently emits surface-absolute draw
geometry must move to node-local emission. Known emitters:
`BuildScopeWaveformCommands` (offsets by `nodeBounds.x/y`,
`PortableUIBuilders.hpp:162-223`), `Visualizer` subclasses that draw against
`GetBounds()` (the base class keeps `SetBounds` for *placement*, but
`DrawVisible()` output becomes origin-based), and the miniapp/Braid encoder
drawing. One real behavioral edge: today, commands the heuristic classifies
as absolute are painted untranslated in surface space, and the classifier
sends any geometry that pokes outside the node's box down that path — so a
node-local author whose marker overhangs the edge currently gets silent
absolute treatment. Under v2, clipping is defined explicitly: node content
clips to node bounds (which JUCE child components and DOM canvases do
natively). A sweep for producers relying on out-of-bounds overdraw is a
migration task; any found must grow their node's bounds to cover their
drawing.

Scroll areas get a defined answer instead of a guess: children of a
`ScrollArea` are relative to the scroll *content* origin (the space whose
extent is `scrollContentWidth/Height`), so scrolling is purely a backend
view transform and producers never see scroll offsets.

Rejected alternative: keeping absolute bounds and only fixing the draw
heuristic with an explicit per-node flag — rejected because it preserves the
real defect (producers computing global positions), keeps composition
position-dependent, and spends a wire change on codifying the workaround
instead of removing its cause.

### D7: One protocol break, version 2, no backwards compatibility

The command buffer bumps `kCommandBufferVersion` 1 → 2, covering the
coordinate-semantics change (D6) and the colour/text-style node fields (D5).

**Three artifacts advertise the version, not two.** Besides
`kCommandBufferVersion` (`BrowserCommandBuffer.hpp`) and
`COMMAND_BUFFER_VERSION` (`protocol.ts`), every Wasm package independently
exports `synth_browser_ui_protocol_version()`, hardcoded to `1` in
`browser/cpp/BrowserRuntimeAbi.cpp:19-22` and asserted or stubbed at ~8
further sites (`tests/browser_runtime_contract_tests.cpp:890`,
`browser/src/static-server.mjs:38`, `tests/midi-timing.test.mjs:204`,
`tests/runtime-core.spec.ts` ×3, `tests/package-loader.spec.ts:297`,
`tests/scaffold.test.mjs:49`). Bumping only the two buffer constants would
ship a version-2 shell that rejects every version-2 package, because the
packages would still advertise UI protocol 1. All three move together, and
publication is gated on both real first-party packages advertising 2.
This is a stated requirement of the change, not a hedged risk: the strict
equality check stays exactly as it is on both ends and rejects mismatches
loudly. There is no dual-version decode, no v1 fallback, and no
negotiation.

Deployment follows the topology: the decoder ships in the shell bundle
(`index.html:11` → `main.ts:10` → `./ui.js`) and serves every catalog
package, so the shell and all app packages are rebuilt and republished
together — which is already how `sbap-3` publication works: whole-catalog,
all-or-nothing, deterministic. Rollback is redeploying the previous complete
publication. Third-party packages published through catalog federation must
be built against the same version; the version check makes a stale package
fail with an explicit error rather than misrender.

### D8: Renderers are dumb, normatively (sru-49)

A backend receives a fully resolved tree and paints it. It does not lay
out, does not infer coordinate space, does not default sizes, does not
decide appearance. Everything it needs is on the node. Concretely, **four**
named deletions in each backend:

1. the `LooksLocal` draw-geometry classifier family and its `nodeLocal`
   flag threading (D6);
2. the `ExplicitBoundsAreParentLocal` / `explicitBoundsAreParentLocal`
   node-bounds classifier and the conditional translation it gates (D6);
3. the auto-flow cursor, its per-kind default-size table, and its
   lowest-Draw starting-y guess (D3);
4. the hardcoded colour constants as appearance policy (D5 — they survive
   at most as the absent-value default).

What legitimately remains backend-side, so "dumb" stays honest: toolkit
realization (creating JUCE components / DOM elements), input translation
into portable actions, scroll view transforms, the existing uniform surface
scale, native interaction states (hover/pressed/focus) derived from carried
properties, and **fitting text within the extent already resolved for it**.

That last one is not a concession. A backend knows its own font and its own
rectangle; deciding whether to shrink, truncate, or clip inside that
rectangle needs nothing else — no tree, no siblings, no context. It is the
same shape of local decision as painting a rounded rectangle, and it is the
one place the backend is genuinely better informed than the library. What
would break dumbness is the inverse: reporting a measurement back so that
layout depends on it. That is forbidden (D4), and the two are easy to
conflate.

The property that makes this checkable rather than aspirational: **no
backend computes a position that is not derivable from the node's own
resolved bounds plus the origins of its ancestor chain** (plus scroll
offset and surface scale where applicable). Enforced two ways — a geometry
property test in each backend's suite (for every node in a rendered tree,
rendered position equals the fold of ancestor origins over the node's wire
bounds), and source inspection (no cursor, no default-size table, no
classifier symbol survives; grep-backed).

### D9: Resizability is a property of the resolver, not a feature to build (sru-50)

The product owner's clarification: *"By resizable i meant
mathematically-in-theory, not 'we must implement window resizing in this
diff'."* An earlier draft over-read this and specified a whole resize
regime — declared minimum extents, a scale-versus-reflow policy, per-surface
resizable/fixed declarations in host services. All of that is cut.

What remains is the property worth guaranteeing: **the resolver derives
every position and extent from the extent it is given**, with no compiled-in
surface size anywhere in a resolution path. Because `Surface::BuildTree()`
already runs per frame, that property means resizing works whenever someone
wants to wire it up — rebuild against a new root extent and weighted and
intrinsic children redistribute, with no producer recomputation and no
backend involvement. It is also what makes weights and intrinsic metrics
(D3/D4) meaningful rather than decorative.

Explicitly not in this change: host window resize handling, minimum-extent
declarations, and any change to `surfaceScale` (`ui.ts:278-287`), which
keeps its current shrink-to-fit behavior untouched. Reconciling uniform
scaling with true reflow is a real question, but it belongs to whoever
implements resizing, not here.

The property is verified rather than assumed: a JUCE-free test resolves the
same producer code at two root extents and asserts proportional
redistribution, the Playwright suite does the equivalent at the DOM level,
and source inspection confirms no resolution path depends on a compiled-in
surface dimension.

### D10: First-party apps get authored layout, not a mechanical migration

Because every Builder-built semantic control is cursor-flowed today (see
Context), Braid 4 and Mini App have no app-authored layout for those
controls to port. The migration therefore *authors* layout for the first
time: their semantic controls move into resolver containers (columns/rows
with explicit or weighted extents), aiming to approximate the current
cursor result, but the positions are re-authored, reviewed against the
sru-48 criteria, and re-baselined — not asserted to be pixel-identical.

What "visuals unchanged" can and cannot mean here: drawn content
(waveforms, encoders, panels — the apps' identity per `sru-22`) is
unchanged in pixels, merely re-expressed in node-local coordinates; app
*behavior* (actions, bindings, state) is unchanged and stays pinned by the
existing app suites; semantic-control *positions* change deliberately,
because the mechanism that produced them is deleted. The app screenshot
baselines are re-approved at the sign-off gate like the pages'.

### D10a: One standard application layout, shared by both apps (sru-53)

The standard layout is **slots, not content**: a title row, a visualizer
column of two stacked component slots, an encoder region beside it, and a
widget bay across the bottom. Each slot takes an arbitrary app-supplied
component. The layout knows nothing about grids, cell counts, visualizers,
or encoders — only position and extent. Braid 4 happens to put a grid of
scope cells in a slot; Mini App puts a single waveform. Both are the app's
business.

That constraint is the point: built from ordinary containers with no layout
logic of its own, the standard layout is a genuine test of whether the
library composes. If it needs a special case in the resolver, the resolver
is wrong.

**The proportions come from the apps, because they already agree.** Read
side by side, `MiniAppPageLayout` (`MiniAppUiModel.hpp:96-165`) and
`Braid4PageLayout` (`Braid4UiModel.hpp:90-170`) are the same layout with the
same constants — margin 16, title height 30, gap 14, visualizer stack width
`min(390, content.width * 0.46)`, encoder region width `min(462, remainder)`,
default surface 900×560 — and both split the visualizer stack into an upper
and a lower half separated by one gap. There is no design work to do here;
there is duplicated arithmetic to delete.

Three points, decided (they were Open Question 4; it is now closed):

1. **The visualizer stack stays on the left and the encoder region on the
   right**, in *both* apps (`ScopeStackArea` anchors at `content.x`;
   `EncoderArea` starts after it). The spec follows the code; mirroring was
   considered and declined, so neither app takes an unforced visual change.
2. **Both apps populate the widget bay.** Braid 4 has one today as its scene
   strip (`kSceneStripHeight = 44`, `SceneStripArea` spanning the content
   width at the bottom — `Braid4UiModel.hpp:97,123-131`); Mini App gains one.
   The bay remains structurally optional — unsupplied, it collapses and the
   regions above take the space — but no first-party app leaves it empty.
3. **The bay is where every other semantic control lives.** This closes a
   real gap: the layout as first described had a home for visualizers and
   encoders only, while the apps between them carry a dozen further controls
   — Mini App's two bank buttons, four toggles, scene buttons, Start/Stop,
   and two sliders (`MiniAppUiModel.hpp:262-310`), and Braid 4's four bank
   buttons (`Braid4UiModel.hpp:386-413`) alongside its scene strip. All of
   them go to the bay, which is why the bay is a container the app fills
   with ordinary components rather than a fixed-height strip. Mini App's bay
   is the reason its visualizer stack no longer runs the full content
   height — a deliberate, re-baselined change.

**Encoder frames are left exactly as they are.** An earlier draft of this
document claimed Braid 4 does not request encoder frames and should adopt
Mini App's treatment. That premise is false: `EncoderDrawState::wantsFrame`
defaults to `true` (`EncoderDraw.hpp:289-294`) and Braid 4 leaves it true,
while Mini App is the app that *disables* frames, setting
`encoderState.wantsFrame = visualizer->WantsEncoderFrame()`
(`MiniAppUI.hpp:61`) where a visualizer such as `ConstantBarVisualizer`
returns false. "Adopting Mini App's treatment" would therefore remove frames
from Braid 4, contradicting D10's promise that drawn pixels are unchanged.
Decided: no change to either app's frame behaviour, and the task that
proposed it is deleted.

Consequence: `Braid4PageLayout`, `Braid4EncoderGridLayout`,
`MiniAppPageLayout`, and `EncoderGridLayout` all lose their surface-level
position arithmetic. Within-cell drawing geometry stays app-owned.

### D10b: Draw nodes dispatch a plain click (sru-52)

Folded in from the retired narrow change. `Node::action` is already carried
on every node and already crosses the wire; no backend reads it for
`NodeKind::Draw`. JUCE's `RetainedDrawComponent` only intercepts clicks when
a drag or double-click action is present (`PortableJuceBackend.hpp:506`),
and the browser attaches a `click` listener only for `NodeKind::Button`
(`ui.ts:132`) — though `acceptsPointerEvents` (`ui.ts:503`) already lets a
Draw node with an action through, so the browser fix is one listener.

JUCE derives the click from the existing drag bookkeeping: fire on `mouseUp`
when the pointer never exceeded the drag threshold, so a drag cannot also
register as a click. `setInterceptsMouseClicks` widens to include the click
case while the inert case stays exactly as it is — `sru-25`'s translucent
visualizer underlays must keep passing clicks through to the encoders above
them.

On a node carrying both click and double-click, both fire, click first. The
DOM does this natively, and the File page's browser-entry buttons already
live with select-then-open (`RuntimePages.hpp:849-860`), so suppressing it
for `Draw` alone would make `Draw` diverge from `Button`.

The contract is deliberately written as *parity with `Button`* rather than
as a literal count, because the count is not obvious and guessing it wrong
would be worse than deferring to the established behaviour: the browser
attaches separate `click` and `dblclick` listeners, so a native double-click
delivers **two** click events before `dblclick`, while JUCE's mouse-up-derived
click has its own ordering around `mouseDoubleClick`. Rather than assert a
number that may be wrong in one backend, sru-52 requires a `Draw` node's
dispatched sequence for the **click and double-click** gestures to be
identical to a `Button` node's for the same actions in the same backend, and
requires each backend's suite to pin the complete ordered list and per-action
counts explicitly.

**The parity clause deliberately excludes the drag gesture** (narrowed
2026-07-30, during 4.3's review, which read an earlier draft of this paragraph
as requiring drag parity too). sru-52 specifies `Draw`'s drag behaviour
directly — a drag past the threshold dispatches the pointer-drag action and no
click action — and says nothing about `Button` drag, because a JUCE `Button`
has no pointer-drag path at all and nothing in the codebase gives one a drag
action: the only `pointerDragAction` producers are the Braid 4 and Mini App
encoder cells (`Braid4UI.hpp:149`, `MiniAppUI.hpp:134`), both `Draw` nodes.
Reading drag into the parity clause would require inventing `Button` drag
dispatch that no requirement asks for and no producer would reach, so the
clause covers click and double-click, and `Draw`'s drag behaviour is pinned
against sru-52's own scenario rather than against `Button`. A divergence between the two kinds then fails a test
instead of surfacing as a stateful action firing twice in production.

**Measured while implementing (2026-07-30).** The sequence is `click, click,
dbl` in **both** backends, so the two agree and both suites pin the same
literal, asserted against a `Button` carrying the same actions first. The
speculation above that "JUCE's mouse-up-derived click has its own ordering
around `mouseDoubleClick`" is therefore false — JUCE matches the DOM. The
contract stands unchanged: writing it as parity-with-`Button` plus an explicit
per-backend literal is what made the divergence checkable rather than assumed,
and it is what caught the two gaps below. Only the prediction was wrong, not
the approach.

Two Draw-vs-`Button` divergences this section did not anticipate surfaced and
were closed under sru-52's parity clause:

- The DOM fires a native `click` after a drag that stays inside one element, so
  "the browser fix is one listener" was incomplete — as first written, a drag
  also registered as a click, which a `Button` does not do.
- The `mouseUp`-derived JUCE click fired on release *outside* the node, where
  both a `juce::Button` and the DOM dispatch nothing.

Both are consequences of the parity requirement rather than new behaviour: the
whole point of specifying parity instead of a count is that gaps like these fail
a test. Each is pinned by a test verified failing first.

### D11: Explicit layering, enforced (sru-51)

The layers, and what each may know:

1. **Model** (`PortableUI.hpp`: `Node`, `NodeTree`, `Bounds`, `DrawCommand`,
   `Color`, `TextStyle`, `Action`): pure data and its documented coordinate/
   clipping contract. Includes nothing from the layers above.
2. **Component library + layout resolver + metrics contract**
   (`PortableUIBuilders.hpp`, split as needed): knows the model only. Owns
   all layout and sizing policy (D3/D4). No JUCE, no DOM/TypeScript, no
   page or app knowledge. Emits fully resolved trees.
3. **Producers** — the config-pages layer (`RuntimePages.hpp`,
   `ControllersPageUI.hpp`) and apps: own their own content and appearance
   choices; know the model and the library. JUCE-free. No wire or backend
   knowledge.
4. **Wire codec** (`BrowserCommandBuffer.hpp`, `protocol.ts`): model in,
   bytes out, and back. No library, page, or app knowledge; no policy.
5. **Backends** (`PortableJuceBackend.hpp`, `ui.ts`): consume resolved
   trees (directly or decoded) and translate input into portable actions.
   Never include the library's authoring/layout API; contain no layout,
   sizing, coordinate, or appearance policy (D8).

Enforcement, so this is a boundary and not a diagram: the JUCE-free compile
tests already idiomatic in this repo (`sru-7`, `sru-14`) pin layers 1–3;
include-graph inspection (grep-backed, run as a committed check) pins
layers 4–5 — backend sources must not include the builder/layout headers,
and the deleted-policy symbols (`FlowCursor`, `DefaultSizeForNode`,
`LooksLocal`, per-variant colour tables) must not reappear; the D8 geometry
property test pins the behavioral half of the backend boundary.

### D12: Config pages are rebuilt on the library, staged easiest-first

**One page cannot wait its turn: the File page.** The staging below is about
*rebuilding pages on the library*, which is a presentation concern and can be
sequenced freely. Node-bounds *coordinate space* is not: the File page's
nested browser rows are emitted surface-absolute today
(`RuntimePages.hpp:698-750`) and survive only because
`ExplicitBoundsAreParentLocal` rescues them. The moment that classifier is
deleted (D6), those rows render displaced. So the File page's nested bounds
are converted to parent-relative **in the wire series itself**, as a narrow
coordinate-only change that leaves its hand-rolled node assembly intact; its
full rebuild on the library still happens in this group's normal order. The
Sync and Audio pages emit flat children under an origin-zero root and are
unaffected; the Controllers page already emits parent-local nested bounds
(`ControllersPageUI.hpp:2417-2420`) and is likewise unaffected. Without this
split, groups 3 and 4 would leave the File page visibly broken and its
simulation suite red for the whole of two task groups.

**A second authoring path that is not a page.** `ControllerWizard.cpp:413-506`
returns its own hand-built, hand-laid-out `NodeTree` (`ControllerWizard.hpp:20-46`),
spliced by the Controllers page (`ControllersPageUI.hpp:2219-2298`). It is a
producer like any other and must migrate to the library, but it is not one of
the four pages and would otherwise fall through the gap between the page
rebuilds and the shim cleanup — surfacing after the visual baselines, when a
layout-changing refactor is at its most expensive. It migrates with the
Controllers page, before Controllers visual verification.

Order: Sync → Audio → File → Controllers. Sync is a flat toggle/status form
(`sru-31`) and proves the form-grid; Audio adds conditional rows and
(re)confirms the captioned-selector fix; File exercises `Splice` with the
patch browser (`sru-13`/`sru-16`–`sru-18`); Controllers is last because it
is 3132 lines backed by the densest behavioral contracts (`sru-4`–`sru-11`,
`sru-26`–`sru-33`) and an edit-session stability requirement (`sru-11`)
that the migration must not disturb: the view model and edit-session logic
are untouched — only tree construction moves to the library.

Each page migration must keep the page's existing behavioral tests and
simulation suites green before any visual change is evaluated. Layout and
coordinate-space deltas will intentionally break position-pinning tests;
those get re-pinned to the new resolved parent-relative layout, never
loosened.

Content audit (the "no useless text" mandate) runs per page with a hard
rule: text whose exact presence a spec scenario pins (e.g. `sru-31`'s status
readouts) cannot be silently dropped — if the audit concludes such text is
noise, that is a spec change to make explicitly first (update-spec-first
policy), not a rendering decision. Everything else — decorative chrome,
labels duplicating adjacent labels, placeholder strings leaking into the UI
— is removed, with the removals listed for human review in the sign-off
gate (D13).

### D13: "Looks better" is verified by named criteria, structural assertions, and a human-gated screenshot baseline

Three layers, because screenshots alone cannot distinguish regression from
intended change and criteria alone cannot catch what they do not name:

1. **Named visual criteria**, stated in the spec (sru-48) and enumerated in
   the tasks: like-type controls share column positions; all spacing on the
   library's shared spacing metrics; every form control captioned; no
   overlap or container overflow; text fits its allocated extent (the D4
   contract check); text contrast meets a stated minimum against its
   effective background; no non-informative text.
2. **Structural Playwright assertions** for the machine-checkable subset,
   computed from the live DOM: equal rendered x-positions for controls
   declared in the same form-grid column, no horizontal scroll/overflow at
   the reference viewport, per-text-element fit (`scrollWidth <=
   clientWidth`), caption presence per form control, computed-style
   contrast checks, and an extent spot-check (render at two root extents, assert
   weighted redistribution). These run in CI like any other test and fail
   on regression without any image diffing.
3. **Screenshot baselines with a human gate.** The iteration loop: build →
   render each config page in the browser backend → capture screenshots →
   evaluate against the criteria → adjust colours/layout → repeat. When the
   criteria pass and the human approves the look, screenshots are committed
   as baselines. Thereafter CI compares against approved baselines; an
   intended visual change is expressed by updating the baseline in the same
   commit with the human's sign-off, so an unapproved pixel drift is a
   regression by definition.

JUCE gets the structural subset through the existing simulation suites
(bounds are in the portable tree, so column alignment and containment are
assertable headlessly on the resolved parent-relative tree) plus the D8
geometry property test; the screenshot loop is browser-only, which is
accepted because layout is resolved producer-side (D3) and therefore
shared, and colour handling differences are covered by the JUCE parity
tests. JUCE-side text fit — the one thing headless assertions cannot fully
cover — is spot-checked at the human sign-off gate (D4).

## Risks / Trade-offs

- **[Coordinate flip produces mixed-space bugs mid-migration]** → The flip
  is atomic per the version bump: model, both backends, and all producers
  move in one change, and deleting the guessing apparatuses means a stale
  absolute-space producer renders visibly displaced instead of being
  silently rescued — failures are loud and local. Contract tests re-pin
  bounds in parent space.
- **[Killing the auto-flow strands cursor-dependent surfaces]** → Known
  dependents are exactly the Builder-built app controls (Braid 4, Mini App,
  the client's app); D10 re-scopes their migration as authored layout with
  re-baselined visuals. The client's app is theirs to rebuild against v2 —
  communicated via the version bump and release notes; their four asks are
  what this change (and the sibling) deliver in exchange.
- **[Reservation metrics too tight or too loose]** → Too tight shows as
  ellipsis and fails the sru-48 text-fit check naming the element; too
  loose wastes width, visible at the sign-off gate. Metrics are constants
  in one place; D4's option 3 (embedded font, exact metrics) is the
  designed upgrade path if the estimate keeps disappointing.
- **[Draw producers relying on out-of-bounds overdraw break under clipping]**
  → Explicit sweep task over every `DrawCommand` emitter; offenders grow
  their node bounds. The heuristic's own classification (geometry outside
  the box ⇒ treated absolute) means such producers are currently in the
  undefined-behavior lane anyway.
- **[Controllers migration destabilizes the densest contracts]** →
  Staged last (D12); view model and edit-session code untouched; existing
  simulation suites must stay green per task before visual work starts;
  `sru-11` session-stability scenarios called out explicitly in tasks.
- **[Extent-driven layout is claimed but not exercised]** → The property is
  cheap to assert and easy to leave untested, since nothing in this change
  actually resizes anything. Mitigation: it is pinned three ways (JUCE-free
  two-extent resolution test, Playwright two-extent check, source inspection
  for compiled-in dimensions) rather than assumed from the design.
- **[Direct colours drift into incoherent page styling]** → The pages'
  colour constants sit in one place by ordinary code organization (D5), and
  the visual criteria (D13) check the result. Accepted residual: nothing
  stops a third-party app from choosing ugly colours — that is their
  prerogative on their own surface.
- **[Content audit silently changes behavior]** → Hard rule in D12:
  spec-pinned text requires a spec delta first; all removals listed at
  sign-off.
- **[Shim period creates a third dialect]** → Shims are within this change
  only and deleted in its final task; the change is not complete while both
  surfaces exist.
- **[The standard layout accretes app-specific knowledge]** → Its slots take
  arbitrary components and it prescribes nothing about their contents
  (D10a), which is the whole point. If it turns out to need a grid mode, a
  cell count, or a content-kind branch to fit an app, that is a signal the
  library's containers are too weak — fix the containers rather than
  special-casing the standard layout.

## Migration Plan

1. Land the component library (containers, parent-relative layout resolver,
   metrics contract, direct colour/text-style parameters, composition,
   splice) with JUCE-free unit tests; old Builder signatures shimmed.
2. Land the version-2 wire change as one commit series, in an order that is
   not negotiable, because **every producer must be converted before the
   backend mechanisms that currently rescue it are deleted**. Two hazards make
   this concrete, and both were found by review rather than by design:

   - **The shell.** `RuntimeMainComponent.hpp` currently adds the sidebar
     offset to *every* sidebar node. Under parent-relative semantics that
     offset is already carried by the sidebar root, so leaving the loop in
     place double-offsets every descendant through component and DOM nesting.
     Shell composition must therefore move to subtree placement (MODIFIED
     `sprs-2`) *inside* this series, before either classifier is deleted —
     not in a later group.
   - **The apps.** Braid 4 and Mini App append unbounded labels, buttons,
     toggles, and sliders directly beneath `Root`; the auto-flow cursor is the
     only thing positioning them. The moment it is deleted, sru-49 requires
     those nodes to render at the parent origin with zero extent. Compilation
     shims do not help: they preserve the *signature*, not the layout. So the
     standard application layout and both app rebuilds land in this series
     too, before the cursor is deleted. "The cursor's deletion and their
     authored layout must land together" is a hard ordering constraint, not a
     preference.

   Order within the series: model semantics and style fields → version bump
   across all three version-advertising artifacts → every `Draw` producer
   swept to node-local geometry (including both apps and the File page's
   nested bounds) → shell subtree placement → the standard layout and both
   app rebuilds → **then** both backends stripped to dumb renderers
   (classifiers, auto-flow, colour policy deleted) with the D8 geometry
   property test in place → contract, parity, and `sprs-6`/`sprs-9` tests
   re-pinned. Draw-node click dispatch (D10b) lands with the backend work.

   The intermediate states are all green: while the classifiers still exist,
   a well-formed parent-relative tree whose children fit their parents is
   classified parent-local and translated correctly, so the classifiers are
   inert rather than wrong once the producers have converted. That is exactly
   why the File page — whose nested children do *not* fit — is the one
   producer that must convert early.
4. Pages in order Sync → Audio → File → Controllers, each: migrate tree
   construction → behavioral suites green → content audit → visual loop →
   human sign-off → commit baselines.
5. Delete shims, dead `Layout::` pixel constants, and any remaining
   hand-rolled node assembly; run the layering inspection (D11) as a
   committed check.
6. Rebuild and republish the shell bundle and every app package together
   (`sbap-3` whole-catalog publication). Rollback at any point before this
   is `git revert`; after it, redeploy the previous complete publication.

## Open Questions

1. **Does `Node::variant` survive at all? — RESOLVED: no. It retires entirely,
   and the residual set is empty.** An earlier draft of this document asserted
   that `variant` retained "interaction-semantics duty (list-row
   hover/selection behavior in `SetSemantics`)". That was factually wrong, and
   it survived into the task briefs before implementation caught it: the JUCE
   backend contains no hover handling at all — no `hover`, `mouseEnter`, or
   `mouseExit` anywhere in `PortableJuceBackend.hpp`. `SetSemantics` carries
   only appearance duty, which `Node::color` and `Node::textStyle` now replace
   outright. So there is no residual to preserve, no explicit replacement field
   is needed, and `variant` carries nothing this change preserves.

   **Staging, because "retired" and "deleted" are not the same task.** The
   *decision* had to precede the v2 schema, and it did: `variant` is gone from
   the wire in the schema task, so no second migration is possible. Removing the
   *field* from `Node` and its branches from both backends cannot happen there —
   roughly fifteen producer sites and both backends still reference it, and they
   are converted by the backend and page tasks. So the field survives as a
   documented dead bridge until the cleanup task (7.2) deletes it along with the
   appearance-string branches. The same split applies to `ComboBox::label`
   (OQ5): the schema task stops routing caption duty through it, the page
   rebuilds stop populating it, and cleanup removes it.

2. **Reservation metric values and JUCE text-fit verification depth.** The
   per-style advance estimates and per-kind intrinsic extents are seeded from
   the two existing backend tables, which currently agree: buttons 72x28,
   sliders 140x28, labels 22 high, combo boxes 160x28, text fields 120x28,
   and text reservations based on `chars * 6.5 + padding`. The portable
   library uses `AdvanceFor(style) = style.size * 0.62`, derived by rounding
   the old default-font ratio 6.5/14 upward so reservations are deliberately
   conservative. `TextWidth` uses a flat `+16` reservation: deliberately
   between the old label `+12` and button/toggle `+24`/`+25` padding because
   the same backend-free reservation feeds every text-bearing intrinsic. The
   old backend label floor of `max(120, ...)` is intentionally dropped; it was
   backend layout policy and made short labels reserve a wide control-like
   slot instead of their actual deterministic text reservation. Whether
   JUCE-side text fit deserves automated coverage (a JUCE-render harness
   measuring string widths against reservations) or the sign-off spot-check
   suffices is open until the truncation rate is seen in practice.
3. **Contrast criterion threshold — RESOLVED: WCAG AA, 4.5:1.** Pinned in
   sru-48 so the Playwright authors do not each invent a number. Whether the
   current dark colours meet it everywhere without adjustment is still
   unknown until the pages' constants are extracted; where they fail, the
   colours move (the criterion does not).
4. **Standard layout: which side, and does Mini App get a widget bay? —
   RESOLVED, see D10a.** Visualizer stack stays on the left in both apps;
   both apps populate the widget bay; the bay is the declared home for every
   semantic control outside the visualizer slots and encoder region; encoder
   frame behaviour is unchanged in both apps.
5. **`ComboBox.label` semantics — RESOLVED: retired, not renamed. `Node::label`
   has no meaning for `NodeKind::ComboBox` in version 2, and no `placeholder`
   field replaces it.** Captions are library-emitted `Label` nodes in the
   form-grid row (D5), which sidesteps the `setTextWhenNothingSelected()` trap
   (`PortableJuceBackend.hpp:1262`). Answered in the preconditions group
   because the Audio page rebuild (task 5.4) is the first surface to put a
   caption next to a combo, and an unanswered `label` field is exactly how the
   trap gets recreated.

   Every combo-box producer in the codebase sets `label` to a **caption**, not
   a placeholder: `"Audio output"`/`"Audio input"` (`RuntimePages.hpp:576,
   593`), `"Input"`/`"Output"`/`"Variant"`/`"Kind"`
   (`ControllersPageUI.hpp:2669, 2682, 2704, 3084`), `"Message"`
   (`ControllerWizard.cpp:476`). Fed to `setTextWhenNothingSelected()`, each of
   those captions disappears the instant an option is selected — which is
   precisely the defect sru-47 requires the Audio page to fix ("captions
   visible while a device is selected"). No producer and no requirement asks
   for genuine "nothing selected" hint text, so a renamed `placeholder` field
   would be speculative wire weight and, worse, a second home for
   caption-shaped strings — the trap rebuilt under a new name. Nothing is lost
   in the retirement: the empty-selection state that today shows the caption
   inside the closed combo will show the sibling caption `Label` beside it
   instead, which is strictly more information, not less.

   Note that retiring the combo-box meaning does not change the wire at all:
   `label` stays in the schema because `Button`, `Toggle`, `Slider`,
   `TextField`, and `Label` still carry their own text in it. So this decision
   neither creates nor avoids a future migration; it only closes the trap.
   Two follow-ons fall out of it, to be picked up by the tasks that own those
   files rather than by the schema task: task 7.1 drops the now-meaningless
   `label` parameter from `Builder::ComboBox`
   (`PortableUIBuilders.hpp:436-452`), and task 7.2 deletes the
   `setTextWhenNothingSelected()` call with the rest of the backend's retired
   appearance handling.
6. **Out-of-bounds draw sweep completeness.** The known absolute-geometry
   emitters are listed in D6, found by reading; the sweep task must be
   grep-backed over every `DrawCommand` construction site, and any producer
   found relying on overdraw beyond its node box needs a per-case call
   (grow the node vs. redesign the drawing).
7. **How much of `ControllersPageUI.hpp`'s node construction is genuinely
   tree-shape versus view-model presentation logic. RESOLVED by Task 13
   spike.** The controller-list-row spike found presentation logic adjacent
   to, but not fused with, tree construction. Row text, endpoint selections,
   enabled/action state, and status-dot colours still come from the existing
   view model, but they can be passed as builder arguments without changing the
   view model, edit-session logic, or wizard state machine. The implication for
   the remaining work is that the plan's risk was real but not a design defect:
   the rest of the 186-node migration is larger than a mechanical find/replace
   because list-like sections need real `ScrollArea` furniture and
   fixed/intrinsic row extents, but it does not require a new
   component-library primitive.
