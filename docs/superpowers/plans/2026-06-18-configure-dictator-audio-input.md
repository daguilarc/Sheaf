# Configure Dictator Audio Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add config-driven Dictator audio input selection where null/blank uses the default input and a named unavailable input disables visible record controls with no fallback.

**Architecture:** Add `audio_input` to `RuntimeConfigFile`, expose it through the existing runtime configuration manager and Web API mappings, and introduce an `AudioInputResolving` seam that both `/api/status` and Launchpad recording use. Launchpad renders `(0,7)` off and ignores record presses when a non-blank selected input is unavailable; capture binds to a resolved input before recording starts.

**Tech Stack:** Swift Package Manager, XCTest, AVFoundation/CoreAudio, Dictator static HTML/CSS/JS dashboard, OpenSpec.

---

## File Structure

- Modify `projects/dictator/src/Sources/DictatorCore/RuntimeConfig.swift`: persisted `audioInput` field, patch field, normalization, default restore.
- Modify `projects/dictator/src/Sources/DictatorCore/RuntimeConfiguration.swift`: add simple string runtime configuration for `audio_input`.
- Create `projects/dictator/src/Sources/DictatorService/AudioInputResolver.swift`: device model, resolver result, protocol, system resolver, static resolver for tests.
- Modify `projects/dictator/src/Sources/DictatorService/AudioRecorder.swift`: accept optional resolved input and fail without fallback when selection cannot be applied.
- Modify `projects/dictator/src/Sources/DictatorService/WebAPIModels.swift` and `WebAPIService.swift`: status/config/options/patch support.
- Modify `projects/dictator/src/Sources/DictatorService/WebServiceFactory.swift`: register `audio_input` runtime configuration.
- Modify `projects/dictator/src/Sources/DictatorService/LaunchpadServiceController.swift`: resolve input before recording, render/ignore unavailable record control.
- Modify `projects/dictator/src/Sources/DictatorService/LaunchpadDSL.swift` only if action-level availability needs to be enforced at page dispatch instead of controller dispatch.
- Modify `projects/dictator/src/web/app.js`, `index.html`, and `styles.css`: render input field/options and hide record button on unavailable status.
- Modify tests in `projects/dictator/tests/DictatorCoreTests/RuntimeConfigProviderTests.swift`, `RuntimeConfigurationManagerTests.swift`, `projects/dictator/tests/DictatorServiceTests/WebAPITests.swift`, `LaunchpadTests.swift`; create `AudioInputResolverTests.swift` and `AudioRecorderTests.swift` if no suitable files exist.
- Modify docs `projects/dictator/docs/contracts/config.md` and any directly affected Dictator docs.

## OpenSpec Requirements Covered

- `dictator-launchpad` `lp-7`: default/null/blank input, selected input first channel, no fallback.
- `dictator-launchpad` `lp-26`: `(0,7)` off/unlit and ignored when selected input unavailable.
- `dictator-web-ui` `web-3`, `web-5`, `web-6`, `web-10`, `web-19`: status/config/options/patch/dashboard availability behavior.
- `openspec/changes/configure-dictator-audio-input/tasks.md`: all 21 implementation and verification tasks.

### Task 1: Runtime Config Foundation

**Files:**
- Modify: `projects/dictator/src/Sources/DictatorCore/RuntimeConfig.swift`
- Modify: `projects/dictator/src/Sources/DictatorCore/RuntimeConfiguration.swift`
- Modify: `projects/dictator/src/Sources/DictatorService/WebServiceFactory.swift`
- Test: `projects/dictator/tests/DictatorCoreTests/RuntimeConfigProviderTests.swift`
- Test: `projects/dictator/tests/DictatorCoreTests/RuntimeConfigurationManagerTests.swift`

- [ ] **Step 1: Write failing config tests**

Add tests that assert:

```swift
XCTAssertNil(RuntimeConfigFile.bootstrap(now: fixedDate).audioInput)
XCTAssertNil(decodedMissingAudioInput.audioInput)
XCTAssertNil(decodedNullAudioInput.audioInput)
XCTAssertNil(decodedBlankAudioInput.audioInput)
XCTAssertEqual(decodedNamedAudioInput.audioInput, "Scarlett 2i2")
XCTAssertEqual(patched.audioInput, "Scarlett 2i2")
XCTAssertNil(patchedBackToDefault.audioInput)
XCTAssertEqual(restored.audioInput, safeDefault.audioInput)
```

Add a runtime-configuration manager test asserting there is an `Audio Input` string configuration whose options can include `""` and whose `set(.string("  Scarlett 2i2  "))` persists `"Scarlett 2i2"`.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
swift test --package-path projects/dictator --filter 'RuntimeConfigProviderTests|RuntimeConfigurationManagerTests'
```

Expected: FAIL because `audioInput`, patch support, and `Audio Input` manager mapping do not exist.

- [ ] **Step 3: Implement minimal config support**

In `RuntimeConfigFile` add:

```swift
public static let defaultAudioInput: String? = nil
public let audioInput: String?
```

Add `audioInput: String? = Self.defaultAudioInput` to the initializer, normalize with:

```swift
self.audioInput = Self.normalizedNonEmpty(audioInput)
```

Add coding key `case audioInput = "audio_input"`, decode with `decodeIfPresent(String.self, forKey: .audioInput)`, encode `audioInput` with `encodeIfPresent`, include it in `bootstrap`, `RuntimeConfigPatch(audioInput:)`, `isEmpty`, `resolvedConfig(for:)`, and `restoreDefaultsToDisk`.

In `RuntimeConfiguration.swift`, add a simple `RuntimeStringConfiguration` if no reusable string config exists. Its `getOptions()` returns injected options and `set(.string(value))` applies a provided async setter.

Register `"Audio Input"` in `WebServiceFactory` with current/default values from `audioInput ?? ""`.

- [ ] **Step 4: Run tests to verify GREEN**

Run the same `swift test --package-path projects/dictator --filter 'RuntimeConfigProviderTests|RuntimeConfigurationManagerTests'`.

Expected: PASS.

### Task 2: Audio Input Resolver And Recorder Binding

**Files:**
- Create: `projects/dictator/src/Sources/DictatorService/AudioInputResolver.swift`
- Modify: `projects/dictator/src/Sources/DictatorService/AudioRecorder.swift`
- Test: `projects/dictator/tests/DictatorServiceTests/AudioInputResolverTests.swift`
- Test: `projects/dictator/tests/DictatorServiceTests/AudioRecorderTests.swift`

- [ ] **Step 1: Write failing resolver tests**

Create tests for:

```swift
XCTAssertEqual(resolver.resolve(configuredAudioInput: nil).mode, .systemDefault)
XCTAssertEqual(resolver.resolve(configuredAudioInput: "  ").mode, .systemDefault)
XCTAssertEqual(resolver.resolve(configuredAudioInput: "scarlett").device?.id, "id-1")
XCTAssertFalse(resolver.resolve(configuredAudioInput: "missing").isAvailable)
XCTAssertFalse(resolver.resolve(configuredAudioInput: "scar").isAvailable) // ambiguous
```

Create recorder tests with an injected device-applier closure:

```swift
let recorder = AudioRecorder(inputSelectionApplier: { selection in
    appliedSelection = selection
    return true
})
```

Assert selected input is applied before record starts and that an applier returning `false` produces `.inputUnavailable` or `.recorderSetupFailed` without trying default input.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
swift test --package-path projects/dictator --filter 'AudioInputResolverTests|AudioRecorderTests'
```

Expected: FAIL because resolver and recorder injection do not exist.

- [ ] **Step 3: Implement resolver and recorder seam**

Define:

```swift
struct AudioInputDevice: Sendable, Equatable {
    let id: String
    let name: String
    let channelCount: Int
}

struct ResolvedAudioInput: Sendable, Equatable {
    enum Mode: Sendable, Equatable { case systemDefault, selected }
    let mode: Mode
    let configuredValue: String?
    let device: AudioInputDevice?
    let isAvailable: Bool
    let unavailableReason: String?
}

protocol AudioInputResolving: Sendable {
    func availableInputs() -> [AudioInputDevice]
    func resolve(configuredAudioInput: String?) -> ResolvedAudioInput
}
```

System resolver lists AVCapture `.audio` devices and maps `uniqueID`, `localizedName`, and channel count best-effort. Matching rules: blank => default; exact id/name first; unique case-insensitive substring second; missing/ambiguous => unavailable.

Update `AudioRecorder.start(resolvedInput:)` to apply selected input before `prepareToRecord()`. If selected input cannot be applied or has no channels, return a non-fallback failure.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
swift test --package-path projects/dictator --filter 'AudioInputResolverTests|AudioRecorderTests'
```

Expected: PASS.

### Task 3: Web API And Dashboard

**Files:**
- Modify: `projects/dictator/src/Sources/DictatorService/WebAPIModels.swift`
- Modify: `projects/dictator/src/Sources/DictatorService/WebAPIService.swift`
- Modify: `projects/dictator/src/Sources/DictatorService/WebServiceFactory.swift`
- Modify: `projects/dictator/src/web/app.js`
- Modify: `projects/dictator/src/web/index.html`
- Modify: `projects/dictator/src/web/styles.css`
- Test: `projects/dictator/tests/DictatorServiceTests/WebAPITests.swift`

- [ ] **Step 1: Write failing Web API/dashboard tests**

Add tests asserting:

```swift
XCTAssertEqual(status["audio_input"] as? String, "")
XCTAssertEqual(status["audio_input_available"] as? Bool, true)
XCTAssertNotNil(status["audio_input_unavailable_reason"])
XCTAssertEqual(configFields.map(\.name).contains("audio_input"), true)
XCTAssertEqual(audioInputField.type, "string")
XCTAssertEqual(options.name, "audio_input")
XCTAssertTrue(options.options.contains { $0.value == "" })
```

Add patch tests for `{"audio_input": null}`, `{"audio_input": ""}`, and `{"audio_input": "Scarlett 2i2"}`. Add static-source assertions that dashboard code branches on `audio_input_available` and hides the record button.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
swift test --package-path projects/dictator --filter WebAPITests
```

Expected: FAIL because web API/status/dashboard fields do not exist.

- [ ] **Step 3: Implement Web API**

Add `audio_input`, `audio_input_effective`, `audio_input_available`, and `audio_input_unavailable_reason` to `StatusResponse`. Add `audio_input: String??` or a custom nullable decoder to `ConfigPatchRequest` so explicit null is distinguishable from absent. Add `WebConfigFieldMapping.audioInput = "audio_input"` with label `"Audio input"`.

Inject `AudioInputResolving` into Web API context/factory. In `status()`, resolve `config.audioInput`; default mode is available unless the resolver reports no default input. In `configOptions`, return `""` plus resolver `availableInputs()` names/ids.

- [ ] **Step 4: Implement dashboard behavior**

In `app.js`, when rendering status, hide the record button if `status.audio_input_available === false`. In config rendering, include the `audio_input` field naturally through `/api/config`; options should call `/api/config/options?name=audio_input`. Keep visible explanation in status text, not in the hidden control.

- [ ] **Step 5: Run focused tests to verify GREEN**

Run:

```bash
swift test --package-path projects/dictator --filter WebAPITests
```

Expected: PASS.

### Task 4: Launchpad Availability And Recording

**Files:**
- Modify: `projects/dictator/src/Sources/DictatorService/LaunchpadServiceController.swift`
- Modify: `projects/dictator/src/Sources/DictatorService/LaunchpadDSL.swift` if required for dispatch gating
- Test: `projects/dictator/tests/DictatorServiceTests/LaunchpadTests.swift`

- [ ] **Step 1: Write failing Launchpad tests**

Add tests proving:

```swift
XCTEqual(recordStatusColor(configuredAudioInput: "missing"), .off)
XCTFalse(recordingStartedAfterPressingRecordWhenInputUnavailable)
XCTEqual(recordStatusColor(configuredAudioInput: nil), PadColor(r: 255, g: 255, b: 255))
XCTEqual(recordingResolvedInput.device?.name, "Scarlett 2i2")
```

Use existing Launchpad page/render helpers where possible. If controller construction is too concrete, add a small injected fake resolver/recorder seam first in test code.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
swift test --package-path projects/dictator --filter LaunchpadTests
```

Expected: FAIL because Launchpad ignores audio-input availability and always records default input.

- [ ] **Step 3: Implement Launchpad behavior**

Inject `AudioInputResolving` into `LaunchpadServiceController`. Update `recordStatusColor()`:

```swift
let resolved = audioInputResolver.resolve(configuredAudioInput: runtimeConfig.audioInput)
guard resolved.isAvailable else { return .off }
```

Before `startRecording`, resolve again; if non-blank selected input is unavailable, log `launchpad dictation unavailable: audio_input=<value> reason=<reason>`, keep state idle, and return. Pass the resolved input into `audioRecorder.start(resolvedInput:)`.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
swift test --package-path projects/dictator --filter LaunchpadTests
```

Expected: PASS.

### Task 5: Docs, OpenSpec Task Sync, And Contracts

**Files:**
- Modify: `projects/dictator/docs/contracts/config.md`
- Modify if needed: `projects/dictator/docs/operations.md`
- Modify if needed: `projects/dictator/docs/architecture.md`
- Modify if needed: `projects/dictator/docs/coverage.md`
- Modify if tracked: `config/dictator.json`, `config/dictator.safe`, `config/dictator.example.json`
- Modify: `openspec/changes/configure-dictator-audio-input/tasks.md`

- [ ] **Step 1: Write or update docs checks if existing tests pin docs**

Run:

```bash
rg -n "audio input|default input|record button|record_status|editable fields|seven editable|dictator.json" projects/dictator/docs projects/dictator/tests
```

If a test pins doc text, update that test first and verify it fails.

- [ ] **Step 2: Update docs**

In config docs add a row:

```markdown
| `audio_input` | string or null | `null` | Audio input selector. Missing, null, or blank uses the system default input; non-blank selects that input's first channel with no fallback if unavailable. |
```

Update the worked example with `"audio_input": null` or omit only if docs explicitly describe omission. Remove stale "seven editable fields" docs if present.

- [ ] **Step 3: Mark matching OpenSpec tasks complete**

After code/tests/docs are green, update `openspec/changes/configure-dictator-audio-input/tasks.md` checkboxes for tasks 1.1 through 5.3 only.

### Task 6: Full Verification

**Files:**
- Modify: `openspec/changes/configure-dictator-audio-input/tasks.md`

- [ ] **Step 1: Run OpenSpec validation**

Run:

```bash
openspec validate configure-dictator-audio-input
```

Expected: `Change 'configure-dictator-audio-input' is valid`.

- [ ] **Step 2: Run Dictator tests**

Run:

```bash
make dictator-test
```

Expected: all Dictator tests pass.

- [ ] **Step 3: Optional manual smoke**

If local audio hardware access is available in this session, run Dictator with `audio_input` blank and with a non-existent configured input. Confirm the blank case preserves normal record controls and the non-existent selected input hides dashboard record and Launchpad `(0,7)` with no default fallback. If hardware access is not practical, record that this manual step was not run.

- [ ] **Step 4: Mark verification tasks complete**

Update `openspec/changes/configure-dictator-audio-input/tasks.md` for tasks 6.1 and 6.2 when complete, and 6.3 only if the smoke check was actually performed.

## Self-Review

- Spec coverage: covered `lp-7`, `lp-26`, `web-3`, `web-5`, `web-6`, `web-10`, `web-19`, plus all OpenSpec task groups.
- Placeholder scan: no TBD/TODO/later placeholders.
- Type consistency: plan uses `audioInput` Swift property and `audio_input` JSON field consistently; resolver names are defined before use.
