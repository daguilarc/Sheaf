#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if ! command -v rg >/dev/null 2>&1; then
    printf 'check_ui_boundary.sh requires ripgrep (rg)\n' >&2
    exit 2
fi

set +e
rg -n --glob '*.hpp' --glob '*.h' --glob '*.cpp' --glob '*.mm' \
    --glob '!build/**' --glob '!apps/miniapp/build/**' --glob '!apps/sheaf-patch/build/**' \
    '(#include[[:space:]]*<juce[^>]*>|(^|[^[:alnum:]_])juce::)' . >"$tmp"
rg_status=$?
set -e
if [ "$rg_status" -gt 1 ]; then
    printf 'check_ui_boundary.sh: ripgrep scan failed with status %s\n' "$rg_status" >&2
    exit "$rg_status"
fi

failed=0
while IFS=: read -r path line match; do
    [ -n "${path:-}" ] || continue
    path="${path#./}"
    if [[ "$match" =~ ^[[:space:]]*// ]]; then
        continue
    fi

    case "$path" in
        juce/*|\
        runtime/AudioConfigPage.hpp|\
        runtime/FilePage.hpp|\
        runtime/HostDataPaths.cpp|\
        runtime/JuceRuntimeMainServices.hpp|\
        runtime/MainPane.hpp|\
        runtime/MidiConnectionManager.hpp|\
        runtime/Runtime.hpp|\
        runtime/Shell.hpp|\
        apps/miniapp/Main.cpp|\
        apps/sheaf-patch/Launcher.hpp|\
        apps/sheaf-patch/LauncherHarnessTests.cpp|\
        apps/sheaf-patch/Main.cpp)
            ;;
        *)
            printf 'JUCE boundary violation: %s:%s:%s\n' "$path" "$line" "$match" >&2
            failed=1
            ;;
    esac
done <"$tmp"

if [ "$failed" -ne 0 ]; then
    printf '\nJUCE references must stay under projects/synth/juce or explicit desktop runtime host files.\n' >&2
    exit 1
fi
