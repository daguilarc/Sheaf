#!/usr/bin/env bash
set -euo pipefail

TOOLKIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$TOOLKIT_DIR/profile.env"

mkdir -p "$AGENT_VM_LOG_DIR"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_tooling() {
  [[ -x "$TART" ]] || die "Tart not found at $TART"
  [[ -x "$SSHPASS" ]] || die "sshpass not found at $SSHPASS"
}

vm_exists() {
  "$TART" list --source local --quiet | awk '{print $1}' | grep -Fxq "$1"
}

vm_ip() {
  "$TART" ip "$1" --wait "${2:-180}"
}

launch_label() {
  local vm="$1"
  local safe
  safe="$(printf '%s' "$vm" | tr -c 'A-Za-z0-9_.-' '-')"
  printf 'com.sheaf.agent-vm.%s\n' "$safe"
}

ssh_base() {
  "$SSHPASS" -p "$SSH_PASSWORD" ssh \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    -o ConnectTimeout=10 \
    -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    -o IdentitiesOnly=yes \
    -o KbdInteractiveAuthentication=no \
    -o NumberOfPasswordPrompts=1 \
    "$SSH_USER@$1" "$@"
}

ssh_exec() {
  local ip="$1"
  shift
  "$SSHPASS" -p "$SSH_PASSWORD" ssh \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    -o ConnectTimeout=10 \
    -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    -o IdentitiesOnly=yes \
    -o KbdInteractiveAuthentication=no \
    -o NumberOfPasswordPrompts=1 \
    "$SSH_USER@$ip" "$@"
}

ssh_stdin() {
  local ip="$1"
  shift
  "$SSHPASS" -p "$SSH_PASSWORD" ssh \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    -o ConnectTimeout=10 \
    -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    -o IdentitiesOnly=yes \
    -o KbdInteractiveAuthentication=no \
    -o NumberOfPasswordPrompts=1 \
    "$SSH_USER@$ip" "$@"
}

ssh_exec_retry() {
  local ip="$1"
  shift
  local attempt
  for attempt in 1 2 3; do
    if ssh_exec "$ip" "$@"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

ssh_upload() {
  local ip="$1"
  local src="$2"
  local dst="$3"
  ssh_stdin "$ip" "cat > '$dst'" < "$src"
}

start_vm_background() {
  local vm="$1"
  shift
  local log="$AGENT_VM_LOG_DIR/$vm.log"
  local launcher="$AGENT_VM_LOG_DIR/$vm.launch.sh"
  local label
  label="$(launch_label "$vm")"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'set -euo pipefail\n'
    printf 'exec'
    printf ' %q' "$TART" run --no-graphics --no-audio --no-clipboard "$@" "$vm"
    printf ' >>%q 2>&1\n' "$log"
  } > "$launcher"
  chmod +x "$launcher"
  launchctl remove "$label" >/dev/null 2>&1 || true
  launchctl submit -l "$label" -- "$launcher"
  printf '%s\n' "$label" > "$AGENT_VM_LOG_DIR/$vm.launchctl-label"
  printf '%s\n' "$log"
}

wait_for_ssh() {
  local vm="$1"
  local ip
  ip="$(vm_ip "$vm" 300)"
  for _ in $(seq 1 60); do
    if ssh_exec "$ip" true >/dev/null 2>&1; then
      printf '%s\n' "$ip"
      return 0
    fi
    sleep 2
  done
  die "SSH did not become ready for $vm at $ip"
}
