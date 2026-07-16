# Spec Coverage

Last audit: standard modulators, fifteen-source application adoption, and sparse modulation processing, 2026-07-16

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
| `spv-6` | covered | `portable_ui_tests` predictive round geometry and invalid-snapshot fallback; `miniapp_juce_backend_parity_tests` and `browser_command_buffer_tests` existing-backend command parity |
| `spv-7` | covered | `TestNoiseWaveformVisualizer` in `portable_ui_tests`; `TestStandardModulatorVisualizersRemainPortable` and `miniapp_registers_noise_at_standard_index_fourteen` cover the retained standard noise visualizer at index `14` |
| `spm-70` | covered | `projects/synth/tests/parameter_modulation_tests.cpp` visualizer topology flows metadata -> depth config -> UI state, clears on disconnect, and stays out of JSON |
| `sru-24` | covered | `projects/synth/tests/miniapp_system_tests.cpp` visualizer node shares encoder bounds, precedes encoder, and encoder actions remain; top-level/bank-transition no-visualizer regressions; null/hidden paths in portable/Braid tests |
| `sru-25` | covered | `projects/synth/tests/portable_ui_tests.cpp` shared encoder underlay body alpha and preserved non-body commands; `projects/synth/tests/miniapp_system_tests.cpp` visible and hidden visualizer underlay wiring |
| `sdsp-13` (modified) | covered | `projects/synth/tests/dsp_tests.cpp` deterministic seeded noise, strict open interval, one advance per voice, distribution sanity, stable pointers, and direct `ParameterGroup` publication; `miniapp_registers_noise_at_standard_index_fourteen` covers application adoption |
| `sdsp-33` (modified) | covered | `miniapp_registers_distinct_scope_visualizers_for_modulators` proves three distinct retained scope visualizers at application indexes `4/5/6`; `miniapp_registers_standard_fifteen_source_topology_without_changing_performer_topology` separates standard visualizers at `0..3/11/14` |
| `sdsp-34` | covered | `dsp_tests` shaped interpolation, reciprocal-time correlated increments, Hz-domain voice spread, validation, precision, and one-hour increment floor cases |
| `sdsp-35` | covered | `dsp_tests` deterministic voice wait/move/done transitions, exact and overshot boundaries, reset semantics, and double progress cases |
| `sdsp-36` | covered | `dsp_tests` canonical random draw order, correlated gang turnover, fixed storage/seed, bounded coherent snapshots, complete live fields, and assigned voice colors |
| `sdsp-37` | covered | `projects/synth/tests/dsp_tests.cpp` positive runtime voice count, zero rejection, non-copyable/non-movable lifetime, bounds-checked access, stable source pointers, and allocation-free/noexcept processing contract |
| `sdsp-38` | covered | `miniapp_registers_noise_at_standard_index_fourteen`, `miniapp_publishes_new_noise_values_before_each_modulation_update`, and `TestStandardModulatorVisualizersRemainPortable` |
| `spv-8` | covered | `projects/synth/tests/portable_ui_tests.cpp` ordered centered half-width constant bars, exact zero/top framing, invalid bounds, immutable redraw, constant-only frame preference, and builder composition; `projects/synth/tests/miniapp_system_tests.cpp` constant-frame suppression with default-frame preservation; existing JUCE/browser fill-command parity |
| `sdsp-39` | covered | `projects/synth/tests/dsp_tests.cpp` zero/one voice construction, exact even/odd greedy assignments, normalized rank coverage, maximal cyclic distance, immutable stable pointers, and direct `ParameterGroup` publication |
| `sdsp-40` | covered | `miniapp_registers_constant_at_standard_index_eleven_without_sample_work`, `miniapp_registers_standard_fifteen_source_topology_without_changing_performer_topology`, and `TestStandardModulatorVisualizersRemainPortable` |
| `ssm-1` | covered | `standard_modulators_owns_address_stable_source_and_visualizer_storage` plus compile-time copy/move assertions in `dsp_tests` |
| `ssm-2` | covered | `standard_modulators_defaults_match_min16_contract`, `standard_modulators_pre_registration_overrides_are_registered`, and `standard_modulators_configuration_freezes_after_registration` |
| `ssm-3` | covered | `standard_modulators_defaults_match_min16_contract` checks every exact derived timing field for all four sources |
| `ssm-4` | covered | the `standard_modulators_rejects_*` atomic-validation cases and `standard_modulators_mono_omits_constant_and_ignores_constant_collision` |
| `ssm-5` | covered | `standard_modulators_lifecycle_requires_registration_and_finite_preparation`, `standard_modulators_process_advances_dynamic_sources_once_and_copies_voice_order`, and `standard_modulators_group_updates_and_ui_publication_remain_explicit` |
| `spm-71` | covered | `miniapp_registers_standard_fifteen_source_topology_without_changing_performer_topology`, `miniapp_processes_and_publishes_ganged_random_lfo_at_audio_block_boundaries`, and `miniapp_loads_old_six_index_depth_data_without_alias_or_translation` |
| `d4-1` | covered | `initializes_parameter_groups_banks_slot_and_scene_endpoints`, `braid4_standard_bundles_register_exact_independent_sources`, and `braid4_groups_fit_sparse_fifteen_position_modulation_views` |
| `d4-3` | covered | `prepares_four_x_internal_rate_and_sequences_internal_subframes`, `matrix_feedback_uses_current_vco_outputs_and_delays_only_modulator_consumption_one_internal_sample`, and `braid4_deadline_tests` |
| `d4-8` | covered | `parallel_lfo_topology_banks_colors_and_modulator_slots`, `audio_and_lfo_outputs_publish_normalized_stereo_mono_and_quad_modulators`, and the matrix-delay case named for `d4-3` |
| `d4-9` | covered | `braid4_standard_modulation_view_renders_underlay_and_app_sources_remain_encoder_only`, `braid4_standard_bundles_register_exact_independent_sources`, and `TestBraid4StandardModulationViewsRemainPortable` |
| `spm-20` (modified) | covered | `parameter_ui_snapshot_owns_parameter_source_and_gesture_colors`, `ui_state_reports_affecting_masks_through_gesture_index_63`, `randomized_message_bus_ui_state_simulation`, and portable encoder snapshot/render assertions through bit 63 |
| `spm-25` (modified) | covered | `randomized_message_bus_ui_state_simulation` plus `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load` validate 64-bit UI masks and sparse lifecycle state against deterministic manager-owned oracles |
| `spm-72` | covered | `group_process_sample_visits_only_registered_roots`, `recursive_local_compute_seeds_display_without_audio_rate_processing`, active-route full-scan cases, and `braid4_sparse_work_counters_bound_inactive_capacity` |
| `spm-73` | covered | 0--64 gesture boundary/sparse-mask tests, `ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit`, portable bit-63 badge rendering, and randomized UI-state coverage |
| `spm-74` | covered | neutral-leaf guard, bottom-up collapse, pin, settling/detach, bounded-reuse, patch-load, semantic-JSON, and randomized lifecycle cases in `parameter_modulation_tests` |
| `spm-75` | covered | connected-only modulation-view materialization/capacity/randomization cases in `parameter_modulation_tests`, MiniApp and Braid4 sparse-position system assertions, and `TestBraid4StandardModulationViewsRemainPortable` |

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

### `ssm-1` - Opt-In Owned Standard Bundle

- [`dsp_tests.cpp`](../tests/dsp_tests.cpp):
  `standard_modulators_owns_address_stable_source_and_visualizer_storage`
  checks the retained target group, all processors, stable output and pointer
  rows, and distinct visualizers for `<1>`, `<2>`, and `<4>` specializations.
  Adjacent compile-time assertions reject copy and move construction and
  assignment for every specialization.

### `ssm-2` - Editable MIN-16 Configuration

- [`dsp_tests.cpp`](../tests/dsp_tests.cpp):
  `standard_modulators_defaults_match_min16_contract` checks exact indexes,
  names, short names, source colors, and voice palettes;
  `standard_modulators_pre_registration_overrides_are_registered` exercises
  every configurable family; and
  `standard_modulators_configuration_freezes_after_registration` proves the
  mutable accessor closes without changing registered addresses or metadata.

### `ssm-3` - Four Derived Random Time Scales

- [`dsp_tests.cpp`](../tests/dsp_tests.cpp):
  `standard_modulators_defaults_match_min16_contract` checks waiting means
  `0.5/2/6/16`, target sigmas `0.1/0.3/0.2/0.1`, and every waiting/moving sigma
  and reciprocal internal sigma derived from those means.

### `ssm-4` - Atomic Fifteen-Source Registration

- [`dsp_tests.cpp`](../tests/dsp_tests.cpp): the exact
  `standard_modulators_rejects_each_out_of_range_active_index_atomically`,
  `standard_modulators_rejects_each_duplicate_active_index_atomically`,
  `standard_modulators_rejects_invalid_random_timing_atomically`,
  `standard_modulators_rejects_empty_active_metadata_atomically`,
  `standard_modulators_rejects_wrong_voice_palette_size_atomically`,
  `standard_modulators_rejects_mismatched_group_shape_atomically`, and
  `standard_modulators_rejects_double_registration_without_mutation` cases
  cover validation and no partial mutation.
- `standard_modulators_mono_omits_constant_and_ignores_constant_collision`
  covers complete mono omission and inactive constant-index collision handling.

### `ssm-5` - Explicit Standard-Modulator Lifecycle

- [`dsp_tests.cpp`](../tests/dsp_tests.cpp):
  `standard_modulators_lifecycle_requires_registration_and_finite_preparation`,
  `standard_modulators_process_advances_dynamic_sources_once_and_copies_voice_order`,
  and `standard_modulators_group_updates_and_ui_publication_remain_explicit`
  cover preparation/re-preparation, one-step random/noise advancement, immutable
  constant storage, stable addresses, caller-owned group updates, and
  block-controlled random snapshot publication.

### `spm-71` - MiniApp Standard Modulation Topology

- [`miniapp_system_tests.cpp`](../tests/miniapp_system_tests.cpp):
  `miniapp_registers_standard_fifteen_source_topology_without_changing_performer_topology`
  checks fifteen modulators, capacity `192`, all sixteen physical positions,
  standard sources at `0..3/11/14`, application sources at `4/5/6`, disconnected
  gaps, all depth cells plus return, stable visualizers, and unchanged performer
  topology.
- `miniapp_processes_and_publishes_ganged_random_lfo_at_audio_block_boundaries`
  checks host-rate preparation, per-sample process-before-update ordering, voice
  order, and block-boundary publication; `miniapp_main_waveform_row_draws_three_distinct_bounded_panels`
  checks the VCO/LFO/standard-random-0 row.
- `miniapp_loads_old_six_index_depth_data_without_alias_or_translation` proves
  old saved depth numbers load literally while the live fifteen-source metadata
  remains authoritative. `miniapp_rig_patch_save_perturb_load_round_trip`
  covers current parameter persistence.
- [`MiniAppJuceBackendParityTests.cpp`](../juce/MiniAppJuceBackendParityTests.cpp)
  and `TestMiniAppThreePanelCommandsUseExistingBrowserSchema` in
  [`browser_command_buffer_tests.cpp`](../tests/browser_command_buffer_tests.cpp)
  cover the portable three-panel commands in both production backends.

### `sdsp-33` - MiniApp Scope Visualizers At `4/5/6`

- [`miniapp_system_tests.cpp`](../tests/miniapp_system_tests.cpp):
  `miniapp_registers_distinct_scope_visualizers_for_modulators` checks distinct
  retained VCO/VCO/LFO scope instances at `4`, `5`, and `6`;
  `miniapp_registers_standard_fifteen_source_topology_without_changing_performer_topology`
  distinguishes those from bundle-owned standard visualizers.

### `sdsp-38` - MiniApp Standard Noise

- [`miniapp_system_tests.cpp`](../tests/miniapp_system_tests.cpp):
  `miniapp_registers_noise_at_standard_index_fourteen` and
  `miniapp_publishes_new_noise_values_before_each_modulation_update` check index
  `14`, two stable voice pointers, bundle ownership, and process-before-update.
- `TestStandardModulatorVisualizersRemainPortable` in
  [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp) and
  `TestStandardModulatorUnderlaysUseExistingBrowserSchema` in
  [`browser_command_buffer_tests.cpp`](../tests/browser_command_buffer_tests.cpp)
  cover portable and browser noise-underlay rendering.

### `sdsp-40` - MiniApp Standard Constant

- [`miniapp_system_tests.cpp`](../tests/miniapp_system_tests.cpp):
  `miniapp_registers_constant_at_standard_index_eleven_without_sample_work`
  checks yellow `Constant`/`Const` metadata at `11`, stable values `(0, 1)`,
  stable pointers, and unchanged values across processing blocks.
- `TestStandardModulatorVisualizersRemainPortable` and
  `TestStandardModulatorUnderlaysUseExistingBrowserSchema` cover retained
  constant-underlay drawing without a sample-path copy.

### `d4-1` - Three Fifteen-Modulator Braid4 Groups

- [`braid4_system_tests.cpp`](../tests/braid4_system_tests.cpp):
  `initializes_parameter_groups_banks_slot_and_scene_endpoints` checks the three
  heterogeneous groups and shared sixteen-position slot;
  `braid4_standard_bundles_register_exact_independent_sources` checks retained
  independent `<2>/<4>/<1>` bundles and addresses; and
  `braid4_groups_fit_sparse_fifteen_position_modulation_views` checks capacities
  and connected-only sparse materialization in each group.

### `d4-3` - Braid4 Internal-Sample Signal Ordering

- [`braid4_system_tests.cpp`](../tests/braid4_system_tests.cpp):
  `prepares_four_x_internal_rate_and_sequences_internal_subframes` checks all
  three bundles at four-times-host rate, exact process/update cadence, and one
  publication per block.
- `matrix_feedback_uses_current_vco_outputs_and_delays_only_modulator_consumption_one_internal_sample`
  checks current post-gain matrix inputs, the existing one-internal-sample
  application-source delay at index `4`, and current standard-source visibility.
- [`braid4_deadline_tests.cpp`](../tests/braid4_deadline_tests.cpp) checks release
  callback budgets at `44.1`, `48`, and `96` kHz.

### `d4-8` - Parallel Braid4 LFO Sources At `4/5`

- [`braid4_system_tests.cpp`](../tests/braid4_system_tests.cpp):
  `parallel_lfo_topology_banks_colors_and_modulator_slots` checks the parallel
  module, shifted frequency ranges, bank layout, and application slots `4/5`;
  `audio_and_lfo_outputs_publish_normalized_stereo_mono_and_quad_modulators`
  checks every normalized application source in all three groups.
- `matrix_feedback_uses_current_vco_outputs_and_delays_only_modulator_consumption_one_internal_sample`
  and `runs_finite_non_silent_stereo_audio_after_decimation` pin application
  source timing and audible-path isolation.

### `d4-9` - Braid4 Standard Visualizers

- [`braid4_system_tests.cpp`](../tests/braid4_system_tests.cpp):
  `braid4_standard_modulation_view_renders_underlay_and_app_sources_remain_encoder_only`
  checks standard underlays and encoder-only application cells;
  `braid4_standard_bundles_register_exact_independent_sources` checks every
  visualizer pointer, mono index `11`, and cross-group non-aliasing.
- `TestBraid4StandardModulationViewsRemainPortable` in
  [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp) checks quad and mono
  node trees, including the disconnected mono constant cell.

### `spm-20` (modified) - 64-Bit Parameter UI Snapshots

- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
  `parameter_ui_snapshot_owns_parameter_source_and_gesture_colors`,
  `ui_state_reports_affecting_masks_through_gesture_index_63`, and
  `randomized_message_bus_ui_state_simulation` cover atomic parameter snapshots,
  source/gesture colors, visible cells, signed and unipolar ranges, and 64-bit
  gesture-affecting masks through index 63.
- [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp): the exact
  `encoder snapshot preserves gesture bit 63` and
  `encoder renders gesture 63 as badge 64` assertions pass a real
  `Parameter::UIState` through `EncoderDrawStateFromParameter` and the portable
  renderer.

### `spm-25` (modified) - Message-Driven Randomized UI State

- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
  `randomized_message_bus_ui_state_simulation` is the deterministic
  manager-owned gesture/UI oracle, including 64-bit masks, stable route source
  identities, inverse positions, current/target values, selected bank/view
  state, and reproducible seed/step/action/sample diagnostics.
- `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load`
  covers message-driven bank open/close, reset, collection, compatible slot
  reuse under a distinct parent, and patch-load boundaries.

### `spm-72` - Sparse Top-Level And Active-Route Traversal

- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
  `group_process_sample_visits_only_registered_roots` and
  `recursive_local_compute_seeds_display_without_audio_rate_processing` cover
  the top-level `ProcessLite` boundary and recursive local-state refresh.
  `modulators_apply_active_uses_explicit_stable_source_indices`,
  `active_modulation_routes_preserve_identity_and_settling_tail`,
  `active_modulation_route_union_keeps_source_with_only_voice_one_nonzero`, and
  `active_modulation_routes_randomized_full_scan_oracle_and_work_bound` cover
  compact application, stable source identity, swap/removal, across-voice
  route union, settling tails, and sample-by-sample full-scan equivalence.
- [`braid4_system_tests.cpp`](../tests/braid4_system_tests.cpp):
  `braid4_parameter_processing_ignores_materialized_local_depths` and
  `braid4_sparse_work_counters_bound_inactive_capacity` compare equal internal
  subframe counts across baseline, all materializable neutral locals, sparse
  active routes, and 64 configured inactive gestures. Observer visit counts are
  the authoritative complexity contract.

### `spm-73` - Sparse 64-Bit Gestures

- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
  `manager_gesture_count_supports_zero_through_64_and_rejects_65_without_mutation`,
  `gesture_masks_visit_only_active_bits_through_index_63`,
  `ui_state_reports_affecting_masks_through_gesture_index_63`, and
  `message_bus_and_patch_round_trip_gesture_indices_32_and_63` cover counts 0,
  1, 32, 33, and 64, rejected 65, sparse set-bit evaluation, UI masks,
  messaging, and persistence.
- [`instrument_tests.cpp`](../tests/instrument_tests.cpp):
  `MessageInJsonRoundTripsHighGestureIndex` and
  `ControllerGesture63SelectsAndEditsManagerGestureWhileBankMaskRemains32Bit`
  cover controller index 63 while preserving the separate 32-bit bank selector.
- [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp): exact badge assertions
  retain legacy labels through gesture 15 and distinguish gestures 16--63 with
  one-based labels 17--64.

### `spm-74` - Neutral Local-Node Reclamation

- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
  `neutral_local_collection_reclaims_leaf_and_preserves_high_water_accounting`,
  `neutral_local_collection_retains_non_default_scene_state`,
  `neutral_local_collection_retains_inactive_latent_gesture_value`,
  `neutral_local_collection_retains_active_gesture_at_default_value`,
  `neutral_local_collection_retains_unsnapped_runtime_state`, and
  `neutral_local_collection_retains_nonzero_normalization_state` cover the
  complete neutral/default eligibility guards and high-water accounting.
- `neutral_local_collection_retains_parent_with_non_collectible_child`,
  `neutral_local_collection_collapses_recursive_subtree_bottom_up`,
  `neutral_local_collection_detaches_child_while_parent_route_finishes_settling`,
  and `modulation_view_pins_visible_locals_until_deselect_boundary` cover
  bottom-up ownership, detach ordering, settling, and live-view pinning.
- `neutral_local_reuse_stays_bounded_beyond_configured_capacity`,
  `randomized_neutral_local_collection_reuses_slots_without_stale_topology`,
  `patch_load_collection_preserves_high_gesture_nested_state_and_collects_default_omissions`,
  `eligible_collection_preserves_semantic_parameter_json`, and
  `message_bus_sparse_lifecycle_model_tracks_pins_collection_reuse_and_patch_load`
  cover bounded reuse, complete reset, persistence, semantic JSON, and
  lifecycle integration.

### `spm-75` - Disconnected Sources Are Empty Modulation-View Positions

- [`parameter_modulation_tests.cpp`](../tests/parameter_modulation_tests.cpp):
  `modulation_view_leaves_disconnected_sources_empty_and_hides_explicit_depths`,
  `modulation_view_capacity_counts_only_connected_missing_depths`,
  `random_mod_maps_connected_ordinals_and_skips_disconnected_sources`, and
  `random_mod_with_no_connected_sources_is_a_noop` cover the generic Bank
  contract for sparse materialization, visible null cells, capacity, and
  connected-only randomization.
- [`miniapp_system_tests.cpp`](../tests/miniapp_system_tests.cpp):
  `miniapp_registers_standard_fifteen_source_topology_without_changing_performer_topology`
  proves nine connected depths, six disconnected physical gaps, and the
  unchanged return-cell position.
- [`braid4_system_tests.cpp`](../tests/braid4_system_tests.cpp):
  `braid4_standard_modulation_view_renders_underlay_and_app_sources_remain_encoder_only`
  proves the distinct polyphonic and monophonic sparse views, including the
  monophonic constant gap, while
  `braid4_groups_fit_sparse_fifteen_position_modulation_views` checks the
  connected-only materialization counts.
- [`portable_ui_tests.cpp`](../tests/portable_ui_tests.cpp):
  `TestBraid4StandardModulationViewsRemainPortable` proves a disconnected
  modulation position has neither an encoder cell nor a visualizer node.

### Sparse-Modulation Timing Evidence

- [`braid4_deadline_tests.cpp`](../tests/braid4_deadline_tests.cpp):
  `braid4_meets_48000hz_256_frame_deadline_and_continuity`,
  `braid4_meets_96000hz_256_frame_deadline_and_continuity`,
  `braid4_sparse_modulation_meets_48000hz_256_frame_deadline`, and
  `braid4_sparse_modulation_meets_96000hz_256_frame_deadline` print baseline and
  sparse-active average/p99 measurements at 48 kHz host/192 kHz internal and
  96 kHz host/384 kHz internal. These generous deadline ceilings are
  platform-sensitive smoke evidence; they do not assert a speedup ratio and do
  not replace the deterministic work-count contract above.

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
