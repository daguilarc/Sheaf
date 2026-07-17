## 1. Hierarchical generic JUCE rendering

- [x] 1.1 Add failing `PortableJuceBackendTests` coverage for parent-local row/section bounds, an unbounded semantic child resolved through nearest-root flow, nested absolute roots, node-local nested draw painting/interaction, and focused text-editor identity/draft retention across stable hosting and reparenting; reconstruct surface-space positions with a shared parent-walk helper when asserting host-local JUCE bounds.
- [x] 1.2 Implement resolved parent maps, semantic JUCE hosting/reparenting, and reusable hosted draw components in `PortableComponent` until the hierarchy and refresh tests pass without page-specific branches.

## 2. Generic JUCE scroll areas

- [x] 2.1 Add failing generic-backend tests that distinguish viewport bounds from content extent and prove vertical/horizontal scrolling keeps a final nested control reachable, clipped, and interactive.
- [x] 2.2 Implement the reusable `ScrollArea` viewport/content host with stable scroll position and declared content sizing, then pass the generic backend tests.

## 3. Production migration and verification

- [x] 3.1 Add desktop runtime-shell coverage that opens the real shared Controllers page and verifies non-overlap plus final-row reachability; move the standalone Controllers harness/simulation onto `PortableComponent`, updating overlap assertions to compare surface-space bounds through a shared parent-walk conversion helper; remove the obsolete Controllers-specific renderer, host alias, and dead renderer tests.
- [x] 3.2 Run the complete synth JUCE suite, JUCE-free synth suite, Controllers simulation/harness build, and browser TypeScript/backend tests; confirm the generic boundary contains no application-specific node IDs or branches and record coverage for `sprs-9` through `sprs-11`.
