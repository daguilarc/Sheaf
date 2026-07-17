## Context

`RuntimeMainComponent` now produces one portable node tree for both browser and desktop hosts. The browser backend constructs the semantic DOM hierarchy, resolves parent-local bounds against parent origins, and implements `ScrollArea` with an overflow container. The generic JUCE `PortableComponent` instead flattens all renderable descendants under itself, applies each node's raw bounds directly, paints draw nodes at the root, and treats `ScrollArea` as an ordinary panel. This violates the portable tree's mixed coordinate contract and made the shared Controllers page unusable after desktop adopted the generic backend. A separate `ControllersTreeRenderer` still implements the old correct desktop behavior, but it is no longer the production path and its passing tests conceal the regression.

## Goals / Non-Goals

**Goals:**

- Make `PortableComponent` a complete generic JUCE renderer for nested semantic containers and scroll areas.
- Match the browser backend's observable coordinate semantics without adding application- or page-specific branches.
- Preserve stable JUCE component identity, focus, draft text, current actions, drawing, and pointer behavior across refreshes.
- Move the Controllers harness and desktop integration coverage onto the production generic path, then remove the obsolete specialized renderer.

**Non-Goals:**

- Redesign the Controllers page or change its portable tree, MIDI model, mapping behavior, or visual language.
- Change browser layout behavior, persistence formats, audio/MIDI runtime behavior, or the public portable node protocol.
- Introduce a general flex/grid layout engine or replace JUCE's native viewport and controls.

## Decisions

### 1. Resolve the portable tree before hosting components

`PortableComponent` will build a parent map and resolved-layout record for each node on every frame. Explicit child bounds that fit inside their semantic parent's coordinate extent are parent-local and receive that parent's resolved origin once; bounds already expressed in the enclosing root's surface space remain absolute. `ScrollArea` uses its content extent when determining whether a child is parent-local. Unbounded controls retain the existing nearest-root flow behavior: their flow positions are first resolved in root surface coordinates, after all ancestors have resolved, then converted to the actual semantic JUCE host's local coordinates by subtracting that host's resolved origin. Parent-before-child resolution is mandatory; an unresolved or cyclic parent graph is invalid rather than a cue to flatten the node.

This matches the browser backend's established coordinate rule and correctly distinguishes Controllers row children (`x/y` local to a row) from composite sidebar descendants that already carry the sidebar's absolute offset. Merely adding ancestor offsets unconditionally was rejected because it would double-translate nested absolute roots; special-casing Controllers IDs was rejected because the backend must stay generic.

### 2. Mirror semantic hosting with JUCE component ownership

Renderable rows and sections remain lightweight panel components, but descendants are attached to their nearest semantic component rather than flattened under `PortableComponent`. Stable node ID and kind continue to key component reuse; refresh reparents retained components only when semantic parentage changes. Bounds passed to a child component are relative to its actual JUCE host, derived from the resolved surface bounds.

Nested component ownership lets JUCE provide clipping and coordinate conversion naturally. Reparenting a retained component does not recreate it: stable ID/kind must preserve its live editor draft and focus even if the semantic host changes. A root-only absolute-bounds patch was rejected because it would make the initial screenshot look better while leaving clipping, focus traversal, pointer coordinates, and scrolling incorrect.

### 3. Represent `ScrollArea` with a dedicated generic viewport host

The generic backend will use an internal scroll host containing a `juce::Viewport` and one content component. The host occupies the node's visible resolved bounds; the content component is sized to the maximum of the visible dimensions and declared `scrollContentWidth`/`scrollContentHeight`; scroll descendants are attached to the content component. Scroll position is retained when the node ID and kind survive refresh and clamped by JUCE when extents shrink.

Using the native viewport is preferred over translating sibling controls manually because it supplies clipping, input routing, and both scrollbars as one coherent contract.

### 4. Make draw nodes real hosted components

Each draw node will be represented by a reusable component that owns its commands, paints the existing node-local draw-command coordinates against a local `{0, 0, width, height}` node rectangle, and optionally handles the existing drag and double-click actions. This puts drawing under the same semantic parent, viewport clipping, and scroll translation as controls. Root-level painting plus a transparent interaction overlay was rejected because scrolled drawing would require a second layout and clipping implementation.

### 5. Delete the alternate Controllers renderer after parity is proven

Backend unit tests will first pin hierarchy, nested-root translation, viewport/content extents, scrolling, drawing, focus, and action refresh. The runtime-shell test will then open the production Controllers page through the sidebar. Finally, the standalone harness will use `PortableComponent` and the specialized `ControllersTreeRenderer`/host tests and unused runtime alias will be removed. This ordering keeps a working reference until generic parity is demonstrated while ensuring the final test suite cannot pass against a renderer the app does not use.

## Risks / Trade-offs

- [The existing local-versus-absolute heuristic is structurally ambiguous for some unusual trees] → Pin the current browser rule as the cross-backend contract, add nested-root and nested-container tests, and fail loudly on invalid parent graphs rather than adding page heuristics.
- [Reparenting retained JUCE controls can disturb focus or callbacks] → Key reuse by stable ID/kind, update callbacks from the current node at dispatch time, reparent only when the resolved semantic host changes, and add focused-editor/draft regression coverage.
- [Changing draw nodes from root painting to child components can alter z-order] → Preserve semantic child order within each host and test a nested interactive draw node alongside ordinary controls.
- [Viewport scrollbar thickness can reduce the effective visible client area] → Treat node bounds as viewport bounds and declared content extents as content size; assert reachability rather than hard-coding platform scrollbar pixels.
- [Removing the dedicated renderer reduces an immediate fallback] → Remove it only after generic backend, runtime-shell, Controllers simulation, and harness builds pass; source control remains the rollback mechanism.

## Migration Plan

1. Add failing generic JUCE backend and runtime-shell tests that reproduce the overlap and missing-scroll behavior.
2. Implement resolved hierarchy, semantic reparenting, hosted draw nodes, and the viewport host until those tests pass.
3. Move the Controllers harness/tests to `PortableComponent`, remove the specialized renderer path, and run the complete synth/JUCE suites.
4. Roll back the implementation commits if cross-backend layout or desktop interaction verification regresses; no data migration is required.

## Open Questions

None. The existing browser coordinate behavior and JUCE viewport semantics define the required implementation contract.
