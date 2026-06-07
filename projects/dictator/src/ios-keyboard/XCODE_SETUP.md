# iOS Direct-Device Setup

Active iOS project path:

- `projects/dictator/src/ios-keyboard/DictatorKeyboardHost/DictatorKeyboardHost.xcodeproj`

This guide assumes Xcode and iOS signing are already working on this machine.

## 1) Open and configure the existing project

1. Open `DictatorKeyboardHost.xcodeproj` in Xcode.
2. Confirm targets:
   - `DictatorKeyboardHost` (host app)
   - `DictatorKeyboardExtension` (custom keyboard)

## 2) Configure entitlements

1. Host target entitlements: `HostApp/HostApp.entitlements`
2. Extension target entitlements: `DictatorKeyboardExtension/KeyboardExtension.entitlements`
3. Confirm app group: `group.com.joyo.dictator`

## 3) Signing + capabilities

For both targets:

1. Team: your Apple Developer team.
2. Bundle IDs (example):
   - Host: `com.joyo.dictator.host`
   - Extension: `com.joyo.dictator.keyboard`
3. Capabilities:
   - App Groups: `group.com.joyo.dictator`

## 4) Configure keyboard runtime values

1. Set `ios_client_host_url` in host + extension `Info.plist` values to your Mac LAN URL on port `9003`.
2. Keep extension `RequestsOpenAccess = YES` for LAN networking.
3. Remember: a physical iPhone cannot reach `127.0.0.1` on your Mac. Use the Mac LAN address instead.

## 5) Install on iPhone directly

1. Connect iPhone and trust development profile.
2. Select iPhone as run destination.
3. Run host app target from Xcode.
4. On iPhone:
   - Settings > General > Keyboard > Keyboards > Add New Keyboard...
   - Choose `DictatorKeyboardExtension`
   - Enable `Allow Full Access`
5. Open host app and verify diagnostics.

## 6) Smoke test

1. Start the Dictator service on your Mac (`make dictator-run` from the Sheaf repo root).
2. Open Notes and switch to your custom keyboard.
3. Confirm the keyboard shows a QWERTY layout with dictation controls.
4. Start a take with the top-right control, then stop it from the same control.
5. While recording, confirm `Cancel Current Take` discards only the active take.
6. Confirm revised text is inserted on successful response.
7. Confirm failure messages are explicit if network/runtime is unavailable.

## 7) Makefile integration

From `projects/dictator/`:

```bash
make ios-build
make ios-test
```

Xcode build products are written under `.build/xcode/` and are git-ignored.
