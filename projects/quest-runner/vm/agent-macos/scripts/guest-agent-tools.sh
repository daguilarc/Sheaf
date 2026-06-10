#!/usr/bin/env bash
set -euo pipefail

eval "$(/opt/homebrew/bin/brew shellenv)"

mkdir -p "$HOME/.npm-global" "$HOME/bin"
npm config set prefix "$HOME/.npm-global"

grep -q '.npm-global/bin' "$HOME/.zprofile" 2>/dev/null || echo 'export PATH="$HOME/.npm-global/bin:$HOME/bin:$PATH"' >> "$HOME/.zprofile"
grep -q '.npm-global/bin' "$HOME/.bash_profile" 2>/dev/null || echo 'export PATH="$HOME/.npm-global/bin:$HOME/bin:$PATH"' >> "$HOME/.bash_profile"
export PATH="$HOME/.npm-global/bin:$HOME/bin:$PATH"

npm install -g @openai/codex @anthropic-ai/claude-code </dev/null

# GUI/editor installs are useful in the golden VM, but CLI use should still
# work if a cask is temporarily unavailable.
brew install --cask cursor </dev/null || true
brew install --cask codex </dev/null || true
brew install --cask claude-code </dev/null || true

if [[ -x /Applications/Cursor.app/Contents/Resources/app/bin/cursor ]]; then
  ln -sf /Applications/Cursor.app/Contents/Resources/app/bin/cursor "$HOME/bin/cursor"
fi

codex --version || true
claude --version || true
cursor --version || true
