#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

rg -n --glob '*.hpp' --glob '*.h' --glob '*.cpp' --glob '*.mm' \
    --glob '!build/**' --glob '!apps/miniapp/build/**' \
    '(#include[[:space:]]*<juce[^>]*>|(^|[^[:alnum:]_])juce::)' . >"$tmp" || true

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
        runtime/ControllersPage.hpp|\
        runtime/FilePage.hpp|\
        runtime/MainPane.hpp|\
        runtime/MidiConnectionManager.hpp|\
        runtime/Runtime.hpp|\
        runtime/Shell.hpp|\
        apps/miniapp/Main.cpp)
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
