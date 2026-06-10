from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from quest_runner_service.agent_vm import (
    AgentVmConfig,
    AgentVmManager,
    AgentVmMount,
    AgentVmRecord,
    AgentVmRegistry,
    read_agent_vm_config,
    service_config_path,
)


class AgentVmConfigTests(unittest.TestCase):
    def test_missing_config_disables_agent_vm(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cfg = read_agent_vm_config(Path(tmp))
        self.assertFalse(cfg.enabled)
        self.assertEqual(cfg.golden_vm, "agent-macos-golden")
        self.assertEqual(cfg.host_ports, tuple(range(9000, 9010)))

    def test_reads_explicit_agent_vm_config(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "config").mkdir()
            (root / "config" / "quest-runner.json").write_text(
                json.dumps(
                    {
                        "agent_vm": {
                            "enabled": True,
                            "golden_vm": "gold",
                            "host_ports": "9000-9002,9009",
                            "mounts": [
                                {
                                    "name": "worktree",
                                    "host_path": "$WORKTREE",
                                    "guest_path": "$WORKTREE",
                                }
                            ],
                        }
                    }
                ),
                encoding="utf-8",
            )
            cfg = read_agent_vm_config(root)
        self.assertTrue(cfg.enabled)
        self.assertEqual(cfg.golden_vm, "gold")
        self.assertEqual(cfg.host_ports, (9000, 9001, 9002, 9009))
        self.assertEqual(cfg.mounts[0].name, "worktree")

    def test_service_config_path_uses_source_checkout_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source"
            worktree = Path(tmp) / "worktree"
            source.mkdir()
            worktree.mkdir()
            with patch(
                "quest_runner_service.agent_vm.source_checkout_root",
                return_value=source,
            ):
                self.assertEqual(
                    service_config_path(worktree),
                    source / "config" / "quest-runner.json",
                )


class AgentVmRegistryTests(unittest.TestCase):
    def test_put_get_remove_record(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            registry = AgentVmRegistry(Path(tmp) / "agent-vms.json")
            worktree = Path(tmp) / "wt"
            worktree.mkdir()
            record = AgentVmRecord(
                worktree_path=str(worktree.resolve()),
                guest_worktree_path=str(worktree.resolve()),
                vm_name="agent-wt-1",
                golden_vm="gold",
                host_ports=(9000,),
                mounts=(
                    AgentVmMount(
                        name="worktree",
                        host_path=str(worktree.resolve()),
                        guest_path=str(worktree.resolve()),
                    ),
                ),
            )
            registry.put(record)
            self.assertEqual(registry.get(worktree), record)
            self.assertEqual(registry.remove(worktree), record)
            self.assertIsNone(registry.get(worktree))


class AgentVmManagerTests(unittest.TestCase):
    def test_ensure_for_worktree_reuses_existing_vm(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "wt"
            worktree.mkdir()
            registry = AgentVmRegistry(root / "agent-vms.json")
            record = AgentVmRecord(
                worktree_path=str(worktree.resolve()),
                guest_worktree_path=str(worktree.resolve()),
                vm_name="agent-existing",
                golden_vm="gold",
                host_ports=(9000,),
                mounts=(),
            )
            registry.put(record)
            cfg = AgentVmConfig(
                enabled=True,
                golden_vm="gold",
                host_ports=(9000,),
                mounts=(),
            )
            manager = AgentVmManager(root, config=cfg, registry=registry, toolkit_dir=root)
            with patch.object(manager, "_vm_exists", return_value=True), patch.object(
                manager, "_create_vm"
            ) as create_vm:
                self.assertEqual(manager.ensure_for_worktree(worktree), record)
            create_vm.assert_not_called()

    def test_ensure_for_worktree_creates_vm_and_expands_mounts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "wt"
            worktree.mkdir()
            home_mount = root / "home-state"
            cfg = AgentVmConfig(
                enabled=True,
                golden_vm="gold",
                host_ports=(9000, 9001),
                mounts=(
                    AgentVmMount("worktree", "$WORKTREE", "$WORKTREE"),
                    AgentVmMount("state", str(home_mount), "/Users/test/.state"),
                ),
            )
            registry = AgentVmRegistry(root / "agent-vms.json")
            manager = AgentVmManager(root, config=cfg, registry=registry, toolkit_dir=root)
            with patch.object(manager, "_vm_exists", return_value=False), patch.object(
                manager, "_create_vm"
            ) as create_vm:
                record = manager.ensure_for_worktree(worktree)
            assert record is not None
            self.assertEqual(record.guest_worktree_path, str(worktree.resolve()))
            self.assertTrue(home_mount.is_dir())
            create_vm.assert_called_once()
            self.assertEqual(registry.get(worktree), record)

    def test_ensure_for_worktree_mounts_git_common_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "wt"
            git_common = root / ".git"
            worktree.mkdir()
            git_common.mkdir()
            cfg = AgentVmConfig(
                enabled=True,
                golden_vm="gold",
                host_ports=(9000,),
                mounts=(AgentVmMount("worktree", "$WORKTREE", "$WORKTREE"),),
            )
            registry = AgentVmRegistry(root / "agent-vms.json")
            manager = AgentVmManager(root, config=cfg, registry=registry, toolkit_dir=root)
            with patch.object(manager, "_vm_exists", return_value=False), patch.object(
                manager, "_create_vm"
            ), patch(
                "quest_runner_service.agent_vm.git_common_dir",
                return_value=git_common,
            ):
                record = manager.ensure_for_worktree(worktree)
            assert record is not None
            source_mount = next(m for m in record.mounts if m.name == "source-checkout")
            self.assertEqual(source_mount.host_path, str(root))
            self.assertEqual(source_mount.guest_path, str(root))
            self.assertFalse(any(m.name == "git-common" for m in record.mounts))

    def test_delete_for_worktree_removes_registry_and_runs_agent_clean(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            clean = root / "bin" / "agent-clean"
            clean.parent.mkdir()
            clean.write_text("#!/bin/sh\n", encoding="utf-8")
            registry = AgentVmRegistry(root / "agent-vms.json")
            worktree = root / "wt"
            worktree.mkdir()
            record = AgentVmRecord(
                worktree_path=str(worktree.resolve()),
                guest_worktree_path=str(worktree.resolve()),
                vm_name="agent-wt-1",
                golden_vm="gold",
                host_ports=(9000,),
                mounts=(),
            )
            registry.put(record)
            manager = AgentVmManager(
                root,
                config=AgentVmConfig(False, "gold", (9000,), ()),
                registry=registry,
                toolkit_dir=root,
            )
            with patch("quest_runner_service.agent_vm.subprocess.run") as run:
                manager.delete_for_worktree(worktree)
            run.assert_called_once()
            self.assertIsNone(registry.get(worktree))

    def test_executor_maps_worktree_cwd_to_guest_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            worktree = root / "wt"
            subdir = worktree / "projects" / "p"
            subdir.mkdir(parents=True)
            record = AgentVmRecord(
                worktree_path=str(worktree.resolve()),
                guest_worktree_path="/Users/joyo/.quest-worktrees/wt",
                vm_name="agent-wt",
                golden_vm="gold",
                host_ports=(9000,),
                mounts=(),
            )
            manager = AgentVmManager(
                root,
                config=AgentVmConfig(False, "gold", (9000,), ()),
                registry=AgentVmRegistry(root / "agent-vms.json"),
                toolkit_dir=root,
            )
            manager.vm_ip = MagicMock(return_value="192.168.64.2")  # type: ignore[method-assign]
            executor = manager.executor_for_record(record)
            cmd = executor._ssh_command(["node", "--version"], subdir)
        self.assertIn("admin@192.168.64.2", cmd)
        self.assertIn("cd /Users/joyo/.quest-worktrees/wt/projects/p", cmd[-1])
        self.assertIn("node --version", cmd[-1])
        self.assertIn('source "$HOME/.sheaf-agent-vm.env"', cmd[-1])
        self.assertNotIn("export PATH=", cmd[-1])


if __name__ == "__main__":
    unittest.main()
