# Spec Coverage

Last audit: ganged random LFO, 2026-07-15

| Requirement | Status | Primary exact coverage |
|---|---|---|
| `sprs-1` | covered | `runtime_main_component_tests`, `browser_runtime_contract_tests`, `runtime_shell_session_tests`, fake-app/miniapp Playwright, generic-runtime scan |
| `sprs-2` | covered | component validation/geometry tests, JUCE nested-root tests, browser layout tests, desktop/narrow Playwright |
| `sprs-3` | covered | browser service/audio/MIDI contract tests, retained JUCE runtime-page executables, browser page Playwright |
| `sprs-4` | covered | browser pointer backend tests, fake-app and miniapp real-mouse Playwright, JUCE parity executable |
| `sprs-5` | covered | browser isolated rounded-arc test, encoder geometry executable, real-miniapp Canvas/screenshots |
| `sprs-6` | covered | browser resolved-layout tests plus fake-app and miniapp desktop/narrow Playwright |
| `sprs-7` | covered | C++, JUCE, TypeScript/Chromium, real-WASM audio/MIDI/gesture/static-site acceptance |
| `sru-1` (modified) | covered | shared component navigation, JUCE shared renderer, browser page replacement/restore and narrow layout |
| `sar-10` (modified) | covered | shared host routing/refresh tests, JUCE shell session, browser worker/static typed-entry acceptance |
| `spv-1` | covered | `projects/synth/tests/portable_ui_tests.cpp` visualizer contract checks: bounds, default visible, hide/show, non-copyable/non-movable, JUCE-free compile |
| `spv-2` | covered | `projects/synth/tests/miniapp_system_tests.cpp` distinct MiniApp VCO visualizer addresses |
| `spv-3` | covered | `projects/synth/tests/portable_ui_tests.cpp` scope visualizer reads updated atomic model state without reconstruction; MiniApp retains app-owned instances |
| `spv-4` | covered | `projects/synth/tests/portable_ui_tests.cpp` `Builder::Visualizer` emits visible node and omits hidden node |
| `spv-5` | covered | `projects/synth/tests/portable_ui_tests.cpp` scope visualizer snapshots connected/color/scope/channel fields and keeps waveform geometry in bounds |
| `spm-70` | covered | `projects/synth/tests/parameter_modulation_tests.cpp` visualizer topology flows metadata -> depth config -> UI state, clears on disconnect, and stays out of JSON |
| `sru-24` | covered | `projects/synth/tests/miniapp_system_tests.cpp` visualizer node shares encoder bounds, precedes encoder, and encoder actions remain; top-level/bank-transition no-visualizer regressions; null/hidden paths in portable/Braid tests |
| `sru-25` | covered | `projects/synth/tests/portable_ui_tests.cpp` shared encoder underlay body alpha and preserved non-body commands; `projects/synth/tests/miniapp_system_tests.cpp` visible and hidden visualizer underlay wiring |
| `sdsp-33` | covered | `projects/synth/tests/miniapp_system_tests.cpp` MiniApp constructs visible distinct VCO visualizers and one LFO visualizer |
| `sdsp-34` | covered | `dsp_tests` shaped interpolation, reciprocal-time correlated increments, Hz-domain voice spread, validation, precision, and one-hour increment floor cases |
| `sdsp-35` | covered | `dsp_tests` deterministic voice wait/move/done transitions, exact and overshot boundaries, reset semantics, and double progress cases |
| `sdsp-36` | covered | `dsp_tests` canonical random draw order, correlated gang turnover, fixed storage/seed, bounded coherent snapshots, complete live fields, and assigned voice colors |
| `spv-6` | covered | `portable_ui_tests` predictive round geometry and invalid-snapshot fallback; `miniapp_juce_backend_parity_tests` and `browser_command_buffer_tests` existing-backend command parity |
| `spm-71` | covered | `miniapp_system_tests` source registration/configuration, audio-block processing/publishing, retained address-stable visualizer, and three-panel/underlay UI topology; JUCE/browser parity tests cover the same portable draw commands |
| `d4-9` | covered | `projects/synth/tests/braid4_system_tests.cpp` all Braid 4 modulator visualizers are null and modulation view is encoder-only |

## Requirement Mappings

### `sprs-1` - Shared Portable Composition

- [`runtime_main_component_tests.cpp`](../tests/runtime_main_component_tests.cpp):
  `TestSidebarOpensEachPageAndBackRestoresApp`,
  `TestAppActionsRouteOnlyToAppSurface`, and
  `TestRuntimeActionsRouteOnlyToOwningPageOrServices`.
- [`browser_runtime_contract_tests.cpp`](../tests/browser_runtime_contract_tests.cpp):
  `TestBrowserRuntimeUsesSharedFrameAndActionRouting`.
- [`RuntimeShellSessionTests.cpp`](../juce/RuntimeShellSessionTests.cpp): the
  `runtime_shell_session_tests` executable assertions that the JUCE shell owns
  exactly one portable renderer rooted at `runtime.main.root`, and that sidebar
  navigation replaces and restores the app through that renderer.
- [`fake-app.e2e.spec.ts`](../browser/tests/fake-app.e2e.spec.ts):
  `real fake-app WASM renders and refreshes the shared runtime shell`.
- [`miniapp-smoke.spec.ts`](../browser/tests/miniapp-smoke.spec.ts):
  `real miniapp WASM renders the complete shared shell and portable pages`.
- [`runtime-core.spec.ts`](../browser/tests/runtime-core.spec.ts):
  `browser worker contains no concrete application branch`, together with
  [`check-generic-runtime.mjs`](../browser/tests/check-generic-runtime.mjs).

### `sprs-2` - Additive Layout And Root Validation

- [`runtime_main_component_tests.cpp`](../tests/runtime_main_component_tests.cpp):
  `TestCompositeBoundsPreserveAppAndAddSidebar`,
  `TestRejectsRootSizeMismatch`, `TestRejectsDuplicateNodeIds`,
  `TestRejectsUnknownChild`, `TestRejectsCycle`,
  `TestRejectsAppRuntimeNamespace`, `TestRejectsDisconnectedGraph`, and
  `TestRejectsMultiplyParentedDiamondGraph`.
- [`PortableJuceBackendTests.cpp`](../juce/PortableJuceBackendTests.cpp): the
  `portable_juce_backend_tests` nested app/sidebar root auto-flow assertions.
- [`RuntimeShellSessionTests.cpp`](../juce/RuntimeShellSessionTests.cpp): the
  additive shell-width and unclipped 900-pixel app-draw assertions.
- [`ui-backend.spec.ts`](../browser/tests/ui-backend.spec.ts):
  `flows unbounded controls after explicit draw content`,
  `keeps absolute surface bounds while nesting composite roots`, and
  `reports stable generic errors for malformed node trees`.
- [`fake-app.e2e.spec.ts`](../browser/tests/fake-app.e2e.spec.ts):
  `real fake-app shared shell remains non-overlapping at narrow width`.
- [`miniapp-smoke.spec.ts`](../browser/tests/miniapp-smoke.spec.ts):
  `real miniapp WASM renders the complete shared shell and portable pages` and
  `real miniapp shared shell scales as one non-overlapping narrow surface`.

### `sprs-3` - Compile-time Host Services

- [`browser_audio_device_tests.cpp`](../tests/browser_audio_device_tests.cpp):
  `TestBrowserExposesOnlySystemDefaultOutput`,
  `TestBrowserDefaultSelectionPersistsAsEmptyName`,
  `TestBrowserRejectsNamedOutputSelection`, and
  `TestBrowserServicesExposeNegotiatedDefaultAudio`.
- [`browser_runtime_contract_tests.cpp`](../tests/browser_runtime_contract_tests.cpp):
  `TestBrowserPrepareFeedsNegotiatedAudioPageAndRejectsOversizedBlocks`,
  `TestSharedBrowserNavigationReplacesAndRestoresEveryRuntimePage`,
  `TestControllersUseLatestBridgeSnapshotCommitEditsAndSaveOnBack`, and
  `TestFilePageDispatchesPatchLifecycleThroughBrowserRuntime`.
- [`browser_midi_bridge_tests.cpp`](../tests/browser_midi_bridge_tests.cpp):
  `TestReconcileBindsSlotsIndependentlyAndResyncsOutputs`,
  `TestIncomingAndOutgoingSysexStayOnSelectedControllerSlot`,
  `TestOfflineSlotDoesNotRemapAnotherSelectedSlot`,
  `TestNameFallbackUpdatesStoredReferencesThroughTheBridge`, and
  `TestLatestDeviceListMatchesSubmittedEndpoints`.
- [`RuntimeShellSessionTests.cpp`](../juce/RuntimeShellSessionTests.cpp),
  [`RuntimePagesJuceTests.cpp`](../juce/RuntimePagesJuceTests.cpp),
  [`ControllersPageJuceTests.cpp`](../juce/ControllersPageJuceTests.cpp), and
  [`FilePageSimulationTests.cpp`](../juce/FilePageSimulationTests.cpp): retained
  JUCE services/page behavior.
- [`fake-app.e2e.spec.ts`](../browser/tests/fake-app.e2e.spec.ts):
  `real fake-app WASM renders and refreshes the shared runtime shell` opens and
  returns from Audio, Controllers, and File using the same generic binding.

### `sprs-4` - Browser Pointer Parity

- [`ui-backend.spec.ts`](../browser/tests/ui-backend.spec.ts):
  `captures pointer drags and dispatches accepted incremental two-axis deltas`,
  `compensates pointer movement for the current surface scale`,
  `keeps captured drags alive outside and clears them on cancel and lost capture`,
  `does not begin a drag when pointer capture fails`,
  `allows only one pointer to drive each drag element`, and
  `uses the current surface scale for each accepted drag increment`.
- [`fake-app.e2e.spec.ts`](../browser/tests/fake-app.e2e.spec.ts):
  `real fake-app WASM dispatches incremental drag and double-click actions`.
- [`miniapp-smoke.spec.ts`](../browser/tests/miniapp-smoke.spec.ts):
  `real miniapp WASM preserves gestures across fresh frames`.
- [`MiniAppJuceBackendParityTests.cpp`](../juce/MiniAppJuceBackendParityTests.cpp):
  the `miniapp_juce_backend_parity_tests` encoder drag and double-click
  assertions pin the desktop behavior being matched.

### `sprs-5` - Rounded Arc Drawing

- [`ui-backend.spec.ts`](../browser/tests/ui-backend.spec.ts):
  `draws arcs with isolated round cap and join state` uses a near-zero arc and
  verifies save/round-cap/round-join/restore ordering and subsequent line state.
- [`EncoderComponentGeometryTests.cpp`](../juce/EncoderComponentGeometryTests.cpp):
  the `encoder_component_geometry_tests` assertions pin dot-like resting arc
  geometry and portable encoder arc commands.
- [`miniapp-smoke.spec.ts`](../browser/tests/miniapp-smoke.spec.ts):
  `real miniapp shared shell scales as one non-overlapping narrow surface`
  verifies all seven encoder canvases retain nontrivial pixels, and the desktop
  and narrow smoke tests write the reviewed runtime-shell screenshots.

### `sprs-6` - One Resolved Browser Coordinate System

- [`ui-backend.spec.ts`](../browser/tests/ui-backend.spec.ts):
  `auto-sized controls contain long generic labels`,
  `sizes long status text within its nearest root before placing the next control`,
  `includes auto-flow below a declared root in the resolved host height`,
  `keeps scroll descendants out of the outer surface extent`,
  `keeps absolute surface bounds while nesting composite roots`,
  `keeps the scale transform only on the current parentless root`, and
  `fits a fixed portable surface into a narrow browser viewport`.
- [`fake-app.e2e.spec.ts`](../browser/tests/fake-app.e2e.spec.ts):
  `real fake-app WASM renders and refreshes the shared runtime shell` and
  `real fake-app shared shell remains non-overlapping at narrow width`.
- [`miniapp-smoke.spec.ts`](../browser/tests/miniapp-smoke.spec.ts):
  `real miniapp WASM renders the complete shared shell and portable pages` and
  `real miniapp shared shell scales as one non-overlapping narrow surface`.

### `sprs-7` - Cross-backend Acceptance

- JUCE-free C++: the exact `runtime_main_component_tests`,
  `browser_audio_device_tests`, `browser_midi_bridge_tests`, and
  `browser_runtime_contract_tests` cases listed above.
- JUCE: `portable_juce_backend_tests`, `miniapp_juce_backend_parity_tests`,
  `runtime_shell_session_tests`, and the retained runtime-page executables
  listed under `sprs-3`.
- Static site: [`static-site.spec.ts`](../browser/tests/static-site.spec.ts):
  `canonical static server applies browser isolation and MIDI sysex headers`,
  `static shell loads generic portable UI styling`, and
  `normal generic browser flows make no dynamic HTTP or WebSocket requests`.
- Audio: [`audio-flow.spec.ts`](../browser/tests/audio-flow.spec.ts):
  `starts a worklet from user activation and copies finite non-silent samples`
  and `real miniapp WASM renders four finite non-silent audio blocks`.
- MIDI: [`midi-flow.spec.ts`](../browser/tests/midi-flow.spec.ts):
  `requests Web MIDI sysex permission and remains offline when it is denied`,
  `routes sysex between selected ports and their independent controller slots`,
  `polling recovers missed port changes without remapping another slot`,
  `drains outbound MIDI on a fast cadence without polling endpoint snapshots`,
  and
  `real miniapp WASM keeps two Web MIDI controller slots independent through reconnect`.
- UI and visuals: the exact fake-app and miniapp gesture, page, desktop, and
  narrow tests listed under `sprs-1`, `sprs-2`, `sprs-4`, `sprs-5`, and `sprs-6`.

### `sru-1` (modified) - Main Pane, Sidebar, And Content Host

- [`runtime_main_component_tests.cpp`](../tests/runtime_main_component_tests.cpp):
  `TestCompositeBoundsPreserveAppAndAddSidebar` and
  `TestSidebarOpensEachPageAndBackRestoresApp`.
- [`RuntimeShellSessionTests.cpp`](../juce/RuntimeShellSessionTests.cpp): one
  JUCE renderer, synchronous Audio-page replacement/Back, retained app surface,
  additive content width, and unclipped full-width app draw.
- [`browser_runtime_contract_tests.cpp`](../tests/browser_runtime_contract_tests.cpp):
  `TestSharedBrowserNavigationReplacesAndRestoresEveryRuntimePage`.
- [`fake-app.e2e.spec.ts`](../browser/tests/fake-app.e2e.spec.ts) and
  [`miniapp-smoke.spec.ts`](../browser/tests/miniapp-smoke.spec.ts): the complete
  shell/page tests and their corresponding narrow non-overlap tests.

### `sar-10` (modified) - Runtime-hosted Application Component

- [`runtime_main_component_tests.cpp`](../tests/runtime_main_component_tests.cpp):
  `TestRefreshUpdatesRuntimePageModelsAndRollingDeadline`, action-routing tests,
  and page navigation tests.
- [`RuntimeShellSessionTests.cpp`](../juce/RuntimeShellSessionTests.cpp): the
  desktop runtime owns and refreshes one shared main component while retaining
  the app surface across page navigation.
- [`browser_runtime_contract_tests.cpp`](../tests/browser_runtime_contract_tests.cpp):
  `TestBrowserRuntimeUsesSharedFrameAndActionRouting` and the browser runtime-page
  service cases listed under `sprs-3`.
- [`runtime-core.spec.ts`](../browser/tests/runtime-core.spec.ts):
  `main bootstrap composes runtime, UI, audio channels, and actions generically`
  and `static auto boot uses the default worker runtime client and receives idle status`.
- [`miniapp-smoke.spec.ts`](../browser/tests/miniapp-smoke.spec.ts):
  `miniapp smoke wiring keeps the generic fake-app gate first` verifies the typed
  browser entry names only the application type; the real-WASM shell and gesture
  cases verify the resulting host behavior.

### `sdsp-34` - Shaped Interpolation And Correlated Increments

- [`dsp_tests.cpp`](../tests/dsp_tests.cpp):
  `shaped_interpolate_endpoints_and_landmarks`,
  `shaped_interpolate_preserves_double_progress`,
  `correlated_increments_use_reciprocal_center_and_hz_sigma`,
  `correlated_increments_floor_near_zero_rate`, and
  `correlated_increments_reject_invalid_config` cover cosine-table interpolation,
  time-domain center sampling, rate-domain per-voice spread, precision, floors,
  and invalid inputs.

### `sdsp-35` - Deterministic Ganged Voice

- [`dsp_tests.cpp`](../tests/dsp_tests.cpp):
  `ganged_random_lfo_voice_runs_wait_move_and_done_states` covers default done,
  waiting and moving increments, exact and overshot boundaries, output holds,
  double progress, and reset source/target semantics.

### `sdsp-36` - Ganged Random Processor And Coherent Snapshot

- [`dsp_tests.cpp`](../tests/dsp_tests.cpp):
  `ganged_random_lfo_samples_round_in_canonical_logical_order`,
  `ganged_random_lfo_slowest_voice_gates_round_turnover`,
  `ganged_random_lfo_floors_heavy_tail_increments`,
  `ganged_random_lfo_fixed_seed_is_reproducible`, and
  `ganged_random_lfo_validates_setup_and_uses_fixed_storage` cover correlation,
  turnover, deterministic injection, validation, and realtime-safe fixed storage.
- The `ganged_random_lfo_snapshot_*` cases in the same executable cover explicit
  publication of every live field and voice color, no recorded history, odd or
  changing revisions, bounded retries, and unchanged destination on failed read.

### `spv-6` - Predictive Ganged-LFO Round Visualizer

- [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp):
  `TestGangedRandomLfoVisualizer` covers the shared maximum-duration axis,
  per-voice waiting/movement/hold paths, reconstructed present dots, solid past,
  dashed future, snapshot colors, fixed geometry bounds, and invalid snapshots.
- [`MiniAppJuceBackendParityTests.cpp`](../juce/MiniAppJuceBackendParityTests.cpp):
  `miniapp_juce_backend_parity_tests` renders the predictive polylines and dots
  through the existing JUCE backend.
- [`browser_command_buffer_tests.cpp`](../tests/browser_command_buffer_tests.cpp):
  `TestPredictiveGangedLfoUsesExistingDrawSchema` proves the browser consumes the
  same commands without a protocol-version change or diagnostic.

### `spm-71` - MiniApp Ganged Random Modulation

- [`miniapp_system_tests.cpp`](../tests/miniapp_system_tests.cpp):
  `miniapp_registers_ganged_random_lfo_without_changing_performer_topology` and
  `miniapp_processes_and_publishes_ganged_random_lfo_at_audio_block_boundaries`
  cover source index 3, preserved sources 0--2, two-second/0.5-second/0.125-Hz
  configuration, target sigma 0.1, cyan/orange voices, per-sample processing
  before modulation update, negotiated sample rate, and block-boundary snapshot
  publication.
- `miniapp_main_waveform_row_draws_three_distinct_bounded_panels`,
  `miniapp_modulation_view_draws_visualizer_beneath_encoder`, and the top-level,
  hidden, and bank-transition visualizer cases in that executable cover three
  distinct waveform panels, a separate retained address-stable modulator
  underlay, and unchanged performer controls, parameters, banks, and persistence.
- [`MiniAppJuceBackendParityTests.cpp`](../juce/MiniAppJuceBackendParityTests.cpp):
  `miniapp_juce_backend_parity_tests` and
  `TestMiniAppThreePanelCommandsUseExistingBrowserSchema` in
  [`browser_command_buffer_tests.cpp`](../tests/browser_command_buffer_tests.cpp)
  cover the three-panel commands in both production backends.

## Known Gaps

- Browser realtime audio underrun safety is intentionally not claimed by these
  mappings. The current deterministic scheduler deficit and the deferred
  render-ahead design are recorded in
  [`browser-audio-underrun-diagnosis.md`](browser-audio-underrun-diagnosis.md).
- Audio input remains outside the browser runtime scope.
- Browser MIDI is bidirectional and covers SysEx, multiple selected devices,
  polling, disconnect, reconnect, and a low-latency output drain cadence.
  Overflow signaling for bursts beyond the bridge's bounded output queue should
  be handled as a follow-up once the browser shell lands.
