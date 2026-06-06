#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOG_DIR="${REPO_ROOT}/logs/conductor"
STDOUT_LOG="${LOG_DIR}/conductor_stdout.log"
STDERR_LOG="${LOG_DIR}/conductor_stderr.log"

mkdir -p "${LOG_DIR}"

npm --prefix "${REPO_ROOT}/projects/conductor" start \
  >>"${STDOUT_LOG}" 2>>"${STDERR_LOG}"
