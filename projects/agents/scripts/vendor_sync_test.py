from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_DIR = Path(__file__).resolve().parent
MODULE_PATH = SCRIPT_DIR / "vendor_sync.py"

spec = importlib.util.spec_from_file_location("agents_vendor_sync", MODULE_PATH)
assert spec is not None
vendor_sync = importlib.util.module_from_spec(spec)
sys.modules["agents_vendor_sync"] = vendor_sync
assert spec.loader is not None
spec.loader.exec_module(vendor_sync)


class ParseVendorTomlTests(unittest.TestCase):
    def test_parse_vendor_toml_requires_required_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "VENDOR.toml"
            path.write_text(
                'url = "https://example.com/repo.git"\n'
                'revision = "abc123"\n'
                'version = "1.0.0"\n'
                'retrieved_at = "2026-07-27T00:00:00Z"\n',
                encoding="utf-8",
            )
            pin = vendor_sync.parse_vendor_toml(path)
            self.assertEqual("https://example.com/repo.git", pin["url"])
            self.assertEqual("abc123", pin["revision"])
            self.assertEqual("1.0.0", pin["version"])
            self.assertEqual("2026-07-27T00:00:00Z", pin["retrieved_at"])

    def test_parse_vendor_toml_rejects_missing_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir) / "VENDOR.toml"
            path.write_text('url = "https://example.com/repo.git"\n', encoding="utf-8")
            with self.assertRaises(ValueError):
                vendor_sync.parse_vendor_toml(path)


class SyncRefuseToClobberTests(unittest.TestCase):
    def test_sync_without_force_raises_when_vendor_dir_has_local_modifications(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            repo_root = Path(tempdir)
            vendor_dir = repo_root / "projects" / "agents" / "vendor" / "openspec"
            vendor_dir.mkdir(parents=True)
            (vendor_dir / "VENDOR.toml").write_text(
                'url = "https://example.com/openspec.git"\n'
                'revision = "old"\n'
                'version = "0.0.1"\n'
                'retrieved_at = "2026-01-01T00:00:00Z"\n',
                encoding="utf-8",
            )
            (vendor_dir / "local-mod.txt").write_text("dirty\n", encoding="utf-8")

            with mock.patch.object(
                vendor_sync,
                "vendor_tree_is_dirty",
                return_value=True,
            ):
                with self.assertRaises(vendor_sync.VendorDirtyError):
                    vendor_sync.sync_tool(
                        repo_root=repo_root,
                        tool="openspec",
                        ref="1.4.1",
                        force=False,
                    )


if __name__ == "__main__":
    unittest.main()
