# iOS Keyboard App

This iOS implementation is retained but quarantined. It is not part of the
default Dictator build or test workflow; use these files only for manual checks
or a future reactivation pass.

Canonical iOS implementation lives in:

- `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/HostApp`: host diagnostics and setup guidance.
- `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardExtension`: custom keyboard with dictation controls and transcript insertion.
- `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj`: retained Xcode project.
- `projects/dictator/tests/ios-keyboard/`: unit and UI tests referenced by the Xcode project.

## Runtime model

- The host app records 16 kHz mono PCM audio and uploads it to the migrated Dictator service.
- Dictation endpoint: `POST /v1/dictate-audio` (`audio/wav` payload + metadata headers).
- The keyboard extension inserts `revised_text` returned by the server into the active text field.

## Service endpoint

- Default server URL: `http://127.0.0.1:9003` (simulator/local development).
- On a physical iPhone, `127.0.0.1` refers to the phone itself, not your Mac. Set the host app server URL to your Mac's LAN address with port `9003`, for example `http://192.168.0.42:9003`.
- Override the endpoint in the host app **Status** section or via `ios_client_host_url` in host/extension `Info.plist`.

## Configuration

- Host URL is read from `ios_client_host_url` in the host/extension `Info.plist`, with app-group overrides persisted by the host app.
- Keyboard extension requires Full Access (`RequestsOpenAccess = YES`) for network requests and host-app handoff.

## Build and test

From `projects/dictator/`:

```bash
make ios-build
make ios-test   # manual quarantine check; requires an available iOS Simulator destination
```

See `XCODE_SETUP.md` for device installation steps.
