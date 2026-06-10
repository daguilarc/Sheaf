#!/usr/bin/env bash
set -euo pipefail

eval "$(/opt/homebrew/bin/brew shellenv)"

SHEAF_TOOL_PATH='/opt/homebrew/opt/sqlite/bin:/opt/homebrew/opt/make/libexec/gnubin:/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/opt/libtool/libexec/gnubin'
for shell_profile in "$HOME/.zprofile" "$HOME/.bash_profile"; do
  grep -q 'SHEAF_TOOL_PATH' "$shell_profile" 2>/dev/null || {
    echo "export SHEAF_TOOL_PATH=\"$SHEAF_TOOL_PATH\"" >> "$shell_profile"
    echo 'export PATH="$SHEAF_TOOL_PATH:$PATH"' >> "$shell_profile"
  }
done
export PATH="$SHEAF_TOOL_PATH:$PATH"

# Runtime/build tools used across the Sheaf repo:
# - Node projects: conductor, sheaf-chat, realtime-agent, VS Code extension.
# - Python quest-runner service.
# - Swift/dictator core plus its whisper-cpp linkage.
# - Native Node modules: better-sqlite3 and naudiodon.
brew install \
  autoconf \
  automake \
  bash \
  cmake \
  coreutils \
  fd \
  ffmpeg \
  gh \
  git \
  git-lfs \
  jq \
  libtool \
  make \
  node \
  openssl@3 \
  pkg-config \
  pnpm \
  portaudio \
  python \
  ripgrep \
  shellcheck \
  sqlite \
  tree \
  uv \
  wget \
  whisper-cpp

# Pre-warm the Python wheels used by projects/quest-runner. Project venvs still
# install from their own requirements.txt so the repo remains the source of truth.
python3 -m pip download --dest "$HOME/.cache/sheaf-python-wheels" \
  'flask>=3.0' \
  'flask-sock>=0.7' \
  'httpx>=0.27' \
  'pyyaml>=6.0'

git lfs install --skip-repo

echo "Sheaf dependency layer installed."
