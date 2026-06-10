#!/usr/bin/env bash
set -euo pipefail

export NONINTERACTIVE=1

sudo mkdir -p /etc/sudoers.d
echo 'admin ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/90-agent-admin >/dev/null
sudo chmod 0440 /etc/sudoers.d/90-agent-admin

if ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

eval "$(/opt/homebrew/bin/brew shellenv)"

grep -q '/opt/homebrew/bin/brew shellenv' "$HOME/.zprofile" 2>/dev/null || {
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
}
grep -q '/opt/homebrew/bin/brew shellenv' "$HOME/.bash_profile" 2>/dev/null || {
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.bash_profile"
}

brew update
brew install \
  bash \
  git \
  node \
  python

if [[ -n "${SHEAF_DEPS_SCRIPT:-}" && -f "$SHEAF_DEPS_SCRIPT" ]]; then
  bash "$SHEAF_DEPS_SCRIPT"
fi

if [[ -n "${SHEAF_AGENT_TOOLS_SCRIPT:-}" && -f "$SHEAF_AGENT_TOOLS_SCRIPT" ]]; then
  bash "$SHEAF_AGENT_TOOLS_SCRIPT"
fi

mkdir -p "$HOME/work"

cat > "$HOME/AGENT_VM_NOTES.txt" <<'NOTES'
This is a golden macOS agent VM image.

Do not store long-lived credentials in this VM if you plan to clone it.
Authenticate disposable clones after they boot, or mount short-lived config
from the host when you intentionally need it.

Mounted host directories appear under:
  /Volumes/My Shared Files/<mount-name>

The agent runner mounts the selected worktree as:
  /Volumes/My Shared Files/worktree
NOTES

echo "Versions:"
sw_vers
git --version
python3 --version
node --version
npm --version
codex --version || true
claude --version || true
cursor --version || true
