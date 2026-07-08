## 1. Regression Coverage First

- [ ] 1.1 Add a JUCE-free miniapp UI test that verifies encoder nodes expose host-neutral drag and double-click action metadata with the correct slot/position identity.
- [ ] 1.2 Add a JUCE-free miniapp action-routing test that dispatches the encoder drag action and observes one `MessageIn::ParamIncDec` on the UI bus with the expected slot, position, timestamp, and delta.
- [ ] 1.3 Add a JUCE-free miniapp action-routing test that dispatches the encoder double-click/push action and observes one `MessageIn::ParamPush` on the UI bus with the expected slot and position.
- [ ] 1.4 Add a JUCE portable-backend regression test that renders the miniapp encoder node through `PortableComponent`, drives or directly invokes the JUCE mouse drag/double-click path, and verifies the dispatched portable actions/messages.

## 2. Portable UI Contract

- [ ] 2.1 Extend `synth::ui::Node` and `PortableUIBuilders` with the minimal pointer-drag action metadata needed by bespoke draw nodes, keeping the header JUCE-free.
- [ ] 2.2 Reuse existing `doubleClickAction` for encoder push where possible; otherwise add only the narrow host-neutral metadata needed to represent encoder double-click.
- [ ] 2.3 Add a shared helper for formatting/parsing encoder gesture action values so slot, position, and delta handling are not duplicated across tests and surface code.

## 3. Miniapp Encoder Surface

- [ ] 3.1 Mark each miniapp encoder draw node with drag and double-click actions carrying its slot/position identity.
- [ ] 3.2 Update `MiniAppUiSurface::DispatchAction` handling so encoder drag actions push `MessageIn::ParamIncDec` through `AppContext::uiBus`.
- [ ] 3.3 Update `MiniAppUiSurface::DispatchAction` handling so encoder double-click actions push `MessageIn::ParamPush` through `AppContext::uiBus`.
- [ ] 3.4 Preserve the prior encoder drag formula, sensitivity, tiny movement threshold, and timestamp source/fallback behavior from `EncoderComponent`.

## 4. JUCE Backend Restoration

- [ ] 4.1 Add a transparent interactive draw-node JUCE component in `PortableJuceBackend` for draw nodes that opt in to pointer gestures.
- [ ] 4.2 Retain interactive draw-node components by stable node ID across `RefreshFromSurface`, matching existing semantic-control retention behavior.
- [ ] 4.3 Translate JUCE mouse-down and mouse-drag events over interactive encoder nodes into the portable drag action value expected by `MiniAppUiSurface`.
- [ ] 4.4 Translate JUCE mouse double-click events over interactive encoder nodes into the portable double-click action.
- [ ] 4.5 Ensure the interactive overlay does not alter draw-node painting, bounds, layout, or non-interactive draw-node behavior.

## 5. Verification

- [ ] 5.1 Run `make -C projects/synth test` and confirm the JUCE-free portable UI and miniapp system tests pass.
- [ ] 5.2 Run the JUCE backend/miniapp test targets that include `PortableJuceBackendTests`, `MiniAppJuceBackendParityTests`, and `EncoderComponentGeometryTests`.
- [ ] 5.3 Run the UI boundary check for synth headers to confirm no new JUCE include leaks into portable miniapp or `include/synth` code.
