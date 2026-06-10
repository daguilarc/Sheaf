"""Tart-backed agent VM configuration, metadata, and command execution."""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class AgentVmError(RuntimeError):
    """Agent VM allocation or command execution failed."""


@dataclass(frozen=True)
class AgentVmMount:
    name: str
    host_path: str
    guest_path: str
    read_only: bool = False


@dataclass(frozen=True)
class AgentVmConfig:
    enabled: bool
    golden_vm: str
    host_ports: tuple[int, ...]
    mounts: tuple[AgentVmMount, ...]


@dataclass(frozen=True)
class AgentVmRecord:
    worktree_path: str
    guest_worktree_path: str
    vm_name: str
    golden_vm: str
    host_ports: tuple[int, ...]
    mounts: tuple[AgentVmMount, ...]


_DEFAULT_GOLDEN_VM = "agent-macos-golden"
_DEFAULT_HOST_PORTS = tuple(range(9000, 9010))
_MOUNT_NAME_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def service_config_path(repo_root: Path) -> Path:
    return source_checkout_root(repo_root) / "config" / "quest-runner.json"


def _parse_host_ports(raw: object) -> tuple[int, ...]:
    if raw is None:
        return _DEFAULT_HOST_PORTS
    ports: list[int] = []
    if isinstance(raw, str):
        pieces = [p.strip() for p in raw.split(",") if p.strip()]
        for piece in pieces:
            if "-" in piece:
                start_raw, end_raw = piece.split("-", 1)
                start = int(start_raw)
                end = int(end_raw)
                ports.extend(range(start, end + 1))
            else:
                ports.append(int(piece))
    elif isinstance(raw, list):
        for item in raw:
            if not isinstance(item, int):
                raise ValueError("agent_vm.host_ports list entries must be integers")
            ports.append(item)
    else:
        raise ValueError("agent_vm.host_ports must be a string or integer list")
    for port in ports:
        if port < 1 or port > 65535:
            raise ValueError(f"agent_vm.host_ports contains invalid port {port}")
    return tuple(dict.fromkeys(ports))


def _parse_mounts(raw: object) -> tuple[AgentVmMount, ...]:
    if raw is None:
        return ()
    if not isinstance(raw, list):
        raise ValueError("agent_vm.mounts must be a list")
    mounts: list[AgentVmMount] = []
    seen: set[str] = set()
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"agent_vm.mounts[{idx}] must be an object")
        name = item.get("name")
        host_path = item.get("host_path")
        guest_path = item.get("guest_path")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"agent_vm.mounts[{idx}].name must be non-empty")
        if not isinstance(host_path, str) or not host_path.strip():
            raise ValueError(f"agent_vm.mounts[{idx}].host_path must be non-empty")
        if not isinstance(guest_path, str) or not guest_path.strip():
            raise ValueError(f"agent_vm.mounts[{idx}].guest_path must be non-empty")
        safe_name = _MOUNT_NAME_RE.sub("-", name.strip()).strip("-")
        if not safe_name:
            raise ValueError(f"agent_vm.mounts[{idx}].name has no safe characters")
        if safe_name in seen:
            raise ValueError(f"agent_vm.mounts contains duplicate name {safe_name!r}")
        seen.add(safe_name)
        mounts.append(
            AgentVmMount(
                name=safe_name,
                host_path=host_path.strip(),
                guest_path=guest_path.strip(),
                read_only=bool(item.get("read_only", False)),
            )
        )
    return tuple(mounts)


def read_agent_vm_config(repo_root: Path) -> AgentVmConfig:
    path = service_config_path(repo_root)
    if not path.is_file():
        return AgentVmConfig(
            enabled=False,
            golden_vm=_DEFAULT_GOLDEN_VM,
            host_ports=_DEFAULT_HOST_PORTS,
            mounts=(),
        )
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{path} must be a JSON object")
    agent_vm = raw.get("agent_vm")
    if agent_vm is None:
        return AgentVmConfig(
            enabled=False,
            golden_vm=_DEFAULT_GOLDEN_VM,
            host_ports=_DEFAULT_HOST_PORTS,
            mounts=(),
        )
    if not isinstance(agent_vm, dict):
        raise ValueError(f"{path}: 'agent_vm' must be an object")
    golden_vm = agent_vm.get("golden_vm", _DEFAULT_GOLDEN_VM)
    if not isinstance(golden_vm, str) or not golden_vm.strip():
        raise ValueError(f"{path}: agent_vm.golden_vm must be a non-empty string")
    return AgentVmConfig(
        enabled=bool(agent_vm.get("enabled", False)),
        golden_vm=golden_vm.strip(),
        host_ports=_parse_host_ports(agent_vm.get("host_ports")),
        mounts=_parse_mounts(agent_vm.get("mounts")),
    )


def source_checkout_root(path: Path) -> Path:
    result = subprocess.run(
        [
            "git",
            "-C",
            str(path),
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return path.resolve()
    common = Path(result.stdout.strip()).resolve()
    if common.name == ".git":
        return common.parent
    return path.resolve()


def git_common_dir(path: Path) -> Path | None:
    result = subprocess.run(
        [
            "git",
            "-C",
            str(path),
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    raw = result.stdout.strip()
    if not raw:
        return None
    return Path(raw).resolve()


def agent_vm_metadata_path(repo_root: Path) -> Path:
    return source_checkout_root(repo_root) / "data" / "quest-runner" / "agent-vms.json"


class AgentVmRegistry:
    def __init__(self, path: Path) -> None:
        self.path = path

    def _load(self) -> dict[str, Any]:
        if not self.path.is_file():
            return {"version": 1, "records": {}}
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{self.path} must be a JSON object")
        records = raw.get("records", {})
        if not isinstance(records, dict):
            raise ValueError(f"{self.path}: records must be an object")
        return {"version": int(raw.get("version", 1)), "records": records}

    def get(self, worktree_path: Path) -> AgentVmRecord | None:
        key = str(worktree_path.resolve())
        data = self._load()["records"].get(key)
        if not isinstance(data, dict):
            return None
        return _record_from_json(data)

    def put(self, record: AgentVmRecord) -> None:
        raw = self._load()
        records = raw["records"]
        records[record.worktree_path] = _record_to_json(record)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(raw, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    def remove(self, worktree_path: Path) -> AgentVmRecord | None:
        if not self.path.is_file():
            return None
        key = str(worktree_path.resolve())
        raw = self._load()
        data = raw["records"].pop(key, None)
        if data is None:
            return None
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(raw, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        if not isinstance(data, dict):
            return None
        return _record_from_json(data)


def _record_to_json(record: AgentVmRecord) -> dict[str, Any]:
    return {
        "worktree_path": record.worktree_path,
        "guest_worktree_path": record.guest_worktree_path,
        "vm_name": record.vm_name,
        "golden_vm": record.golden_vm,
        "host_ports": list(record.host_ports),
        "mounts": [
            {
                "name": m.name,
                "host_path": m.host_path,
                "guest_path": m.guest_path,
                "read_only": m.read_only,
            }
            for m in record.mounts
        ],
    }


def _record_from_json(data: dict[str, Any]) -> AgentVmRecord:
    return AgentVmRecord(
        worktree_path=str(data["worktree_path"]),
        guest_worktree_path=str(data["guest_worktree_path"]),
        vm_name=str(data["vm_name"]),
        golden_vm=str(data["golden_vm"]),
        host_ports=tuple(int(p) for p in data.get("host_ports", [])),
        mounts=_parse_mounts(data.get("mounts", [])),
    )


class AgentVmManager:
    def __init__(
        self,
        repo_root: Path,
        *,
        config: AgentVmConfig | None = None,
        registry: AgentVmRegistry | None = None,
        toolkit_dir: Path | None = None,
    ) -> None:
        self.repo_root = repo_root.resolve()
        self.config = config or read_agent_vm_config(self.repo_root)
        self.registry = registry or AgentVmRegistry(agent_vm_metadata_path(self.repo_root))
        self.toolkit_dir = toolkit_dir or (
            source_checkout_root(self.repo_root)
            / "projects"
            / "quest-runner"
            / "vm"
            / "agent-macos"
        )

    def ensure_for_worktree(self, worktree_path: Path) -> AgentVmRecord | None:
        if not self.config.enabled:
            return None
        worktree = worktree_path.resolve()
        existing = self.registry.get(worktree)
        if existing is not None and self._vm_exists(existing.vm_name):
            return existing

        mounts = self._expanded_mounts(worktree)
        guest_worktree_path = next(
            (m.guest_path for m in mounts if m.name == "worktree"),
            str(worktree),
        )
        vm_name = self._new_vm_name(worktree)
        self._create_vm(vm_name, worktree, mounts)
        record = AgentVmRecord(
            worktree_path=str(worktree),
            guest_worktree_path=guest_worktree_path,
            vm_name=vm_name,
            golden_vm=self.config.golden_vm,
            host_ports=self.config.host_ports,
            mounts=mounts,
        )
        self.registry.put(record)
        return record

    def delete_for_worktree(self, worktree_path: Path) -> None:
        record = self.registry.remove(worktree_path)
        if record is None:
            return
        clean = self.toolkit_dir / "bin" / "agent-clean"
        subprocess.run([str(clean), record.vm_name], check=False, capture_output=True, text=True)

    def executor_for_record(self, record: AgentVmRecord) -> "AgentVmCommandExecutor":
        return AgentVmCommandExecutor(self, record)

    def _expanded_mounts(self, worktree: Path) -> tuple[AgentVmMount, ...]:
        mounts: list[AgentVmMount] = []
        has_worktree = False
        mount_names: set[str] = set()
        for mount in self.config.mounts:
            host_path = self._expand_path(mount.host_path, worktree)
            guest_path = self._expand_path(mount.guest_path, worktree)
            Path(host_path).expanduser().mkdir(parents=True, exist_ok=True)
            if mount.name == "worktree":
                has_worktree = True
            mount_names.add(mount.name)
            mounts.append(
                AgentVmMount(
                    name=mount.name,
                    host_path=str(Path(host_path).expanduser().resolve()),
                    guest_path=str(Path(guest_path).expanduser()),
                    read_only=mount.read_only,
                )
            )
        if not has_worktree:
            mounts.insert(
                0,
                AgentVmMount(
                    name="worktree",
                    host_path=str(worktree),
                    guest_path=str(worktree),
                ),
            )
        common_dir = git_common_dir(worktree)
        if common_dir is not None and common_dir.is_dir():
            source_root = common_dir.parent if common_dir.name == ".git" else source_checkout_root(worktree)
            if (
                source_root != worktree
                and source_root.is_dir()
                and "source-checkout" not in mount_names
            ):
                mounts.append(
                    AgentVmMount(
                        name="source-checkout",
                        host_path=str(source_root),
                        guest_path=str(source_root),
                        read_only=False,
                    )
                )
            elif "git-common" not in mount_names:
                mounts.append(
                    AgentVmMount(
                        name="git-common",
                        host_path=str(common_dir),
                        guest_path=str(common_dir),
                        read_only=False,
                    )
                )
        return tuple(mounts)

    def _expand_path(self, value: str, worktree: Path) -> str:
        home = str(Path.home())
        return (
            value.replace("$WORKTREE", str(worktree))
            .replace("${WORKTREE}", str(worktree))
            .replace("$HOME", home)
            .replace("${HOME}", home)
        )

    def _new_vm_name(self, worktree: Path) -> str:
        import time

        safe = _MOUNT_NAME_RE.sub("-", worktree.name).strip("-") or "worktree"
        return f"agent-{safe}-{int(time.time())}"

    def _vm_exists(self, vm_name: str) -> bool:
        tart = os.environ.get("TART", "/opt/homebrew/bin/tart")
        result = subprocess.run(
            [tart, "list", "--source", "local", "--quiet"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return False
        return vm_name in {line.strip().split()[0] for line in result.stdout.splitlines() if line.strip()}

    def _create_vm(
        self,
        vm_name: str,
        worktree: Path,
        mounts: tuple[AgentVmMount, ...],
    ) -> None:
        runner = self.toolkit_dir / "bin" / "agent-run"
        cmd = [
            str(runner),
            "--name",
            vm_name,
            "--golden",
            self.config.golden_vm,
            "--host-port-range",
            _format_port_range(self.config.host_ports),
        ]
        for mount in mounts:
            spec = f"{mount.name}:{mount.host_path}:{mount.guest_path}"
            if mount.read_only:
                spec = f"{spec}:ro"
            cmd.extend(["--mount", spec])
        cmd.append(str(worktree))
        result = subprocess.run(cmd, check=False, capture_output=True, text=True)
        if result.returncode != 0:
            clean = self.toolkit_dir / "bin" / "agent-clean"
            subprocess.run([str(clean), vm_name], check=False, capture_output=True, text=True)
            raise AgentVmError(
                "Failed to create agent VM "
                f"{vm_name}: {result.stderr.strip() or result.stdout.strip()}"
            )

    def vm_ip(self, vm_name: str, wait_seconds: int = 60) -> str:
        tart = os.environ.get("TART", "/opt/homebrew/bin/tart")
        result = subprocess.run(
            [tart, "ip", vm_name, "--wait", str(wait_seconds)],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise AgentVmError(
                f"Failed to resolve IP for agent VM {vm_name}: "
                f"{result.stderr.strip() or result.stdout.strip()}"
            )
        return result.stdout.strip()


def _format_port_range(ports: tuple[int, ...]) -> str:
    if not ports:
        return ""
    sorted_ports = sorted(set(ports))
    if sorted_ports == list(range(sorted_ports[0], sorted_ports[-1] + 1)):
        return f"{sorted_ports[0]}-{sorted_ports[-1]}"
    return ",".join(str(p) for p in sorted_ports)


class AgentVmCommandExecutor:
    def __init__(self, manager: AgentVmManager, record: AgentVmRecord) -> None:
        self.manager = manager
        self.record = record

    def guest_cwd(self, cwd: Path) -> Path:
        cwd_resolved = cwd.resolve()
        worktree = Path(self.record.worktree_path).resolve()
        try:
            rel = cwd_resolved.relative_to(worktree)
        except ValueError:
            return cwd_resolved
        return Path(self.record.guest_worktree_path) / rel

    def run_probe(self, cmd: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess[str]:
        ssh_cmd = self._ssh_command(cmd, cwd)
        return subprocess.run(
            ssh_cmd,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def run_cli_streaming(
        self,
        cmd: list[str],
        cwd: Path,
        idle_timeout_seconds: int,
        *,
        env: dict[str, str] | None = None,
        log_sink: Any = None,
    ) -> dict[str, Any]:
        from .harness import _run_cli_streaming

        ssh_cmd = self._ssh_command(cmd, cwd, env=env)
        return _run_cli_streaming(
            ssh_cmd,
            cwd=Path(self.record.worktree_path),
            idle_timeout_seconds=idle_timeout_seconds,
            env=None,
            log_sink=log_sink,
        )

    def _ssh_command(
        self,
        cmd: list[str],
        cwd: Path,
        *,
        env: dict[str, str] | None = None,
    ) -> list[str]:
        ip = self.manager.vm_ip(self.record.vm_name)
        sshpass = os.environ.get("SSHPASS", "/opt/homebrew/bin/sshpass")
        ssh_user = os.environ.get("SSH_USER", "admin")
        ssh_password = os.environ.get("SSH_PASSWORD", "admin")
        env_prefix = ""
        if env:
            env_prefix = " ".join(
                f"{shlex.quote(k)}={shlex.quote(v)}" for k, v in env.items()
            )
            env_prefix = f"{env_prefix} "
        remote = (
            "source \"$HOME/.zprofile\" 2>/dev/null || true; "
            "source \"$HOME/.sheaf-agent-vm.env\" 2>/dev/null || true; "
            f"cd {shlex.quote(str(self.guest_cwd(cwd)))} && "
            f"{env_prefix}{shlex.join(cmd)}"
        )
        return [
            sshpass,
            "-p",
            ssh_password,
            "ssh",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "UserKnownHostsFile=/dev/null",
            "-o",
            "LogLevel=ERROR",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "PreferredAuthentications=password",
            "-o",
            "PubkeyAuthentication=no",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "KbdInteractiveAuthentication=no",
            "-o",
            "NumberOfPasswordPrompts=1",
            f"{ssh_user}@{ip}",
            remote,
        ]


def vm_executor_for_worktree(repo_root: Path) -> AgentVmCommandExecutor | None:
    manager = AgentVmManager(repo_root)
    record = manager.ensure_for_worktree(repo_root)
    if record is None:
        return None
    return manager.executor_for_record(record)
