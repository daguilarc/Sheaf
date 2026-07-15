#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOG_DIR="${REPO_ROOT}/logs/quest-runner"
STDOUT_LOG="${LOG_DIR}/quest_runner_stdout.log"
STDERR_LOG="${LOG_DIR}/quest_runner_stderr.log"
VENV_DIR="${SCRIPT_DIR}/.venv"

mkdir -p "${LOG_DIR}"

if [[ ! -d "${VENV_DIR}" ]]; then
  python3 -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/pip" install -r "${SCRIPT_DIR}/requirements.txt"

export PYTHONPATH="${SCRIPT_DIR}/src"
cd "${REPO_ROOT}"

exec "${VENV_DIR}/bin/python" -m quest_runner_service \
  >>"${STDOUT_LOG}" 2>>"${STDERR_LOG}"
