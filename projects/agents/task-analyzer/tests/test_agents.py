"""Tests for agents.xagent_runner (Task 7's real agent_runner).

Every test monkeypatches ``agents.subprocess.run`` with a fake that never
touches node/an LLM: it inspects the batch's ``items.json``/``prompt.md``
(found via the fake's ``cwd`` kwarg, which ``agents.py`` sets to the
per-batch scratch work dir) and writes canned JSON into ``output/`` --
mimicking what a real xagent subagent run would leave behind. Zero real
dispatches happen anywhere in this file.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import agents  # noqa: E402


def _kind_of_entry(entry: dict) -> str:
    if "brief_file" in entry:
        return "complexity"
    if "review_files" in entry:
        return "grading"
    return "phase_labeling"


def _canned_valid(kind: str, entity_key: str) -> dict:
    if kind == "complexity":
        return {
            "task_key": entity_key,
            "C1": 2, "C2": 2, "C3": 2, "C4": 2, "C5": 2, "C6": 2, "C7": 1,
            "composite": 2.0,
            "rationale": {k: "n/a" for k in ("C1", "C2", "C3", "C4", "C5", "C6", "C7")},
        }
    if kind == "grading":
        return {
            "task_key": entity_key,
            "G1": 5, "G2": 5, "G3": 5, "G4": 5, "G5": 5,
            "n_critical": 0, "n_important": 0, "n_minor": 0,
            "verdict_sequence": "PASS", "rounds_to_accept": 1,
            "final_grade": "A", "evidence": "clean review",
            "reviewer_models": ["claude-sonnet-5"], "excluded_reviews": [],
        }
    return {"session_key": entity_key, "labels": {"1": "green"}}


class FakeXagent:
    """Stand-in for ``subprocess.run`` -- records every call (cmd + kwargs)
    and, for each item in the batch it's handed (read from cwd/items.json),
    writes an output JSON file per ``behavior(entity_key, attempt_number)``.

    ``behavior`` defaults to always-valid; tests override it to simulate
    malformed/missing output for specific keys on specific attempts.

    ``rc_and_log`` defaults to always-succeed (exit 0, empty log); tests
    override it to simulate a crashed/misconfigured xagent process -- it's
    given the 1-based call index across the whole fake's lifetime and
    returns ``(returncode, log_text)``; ``log_text`` is written to the
    ``stdout`` file object the real code passes (mirroring how a real
    subprocess's output lands in the log file agents.py reads back).
    """

    def __init__(self, behavior=None, rc_and_log=None):
        self.calls = []  # list of (cmd, kwargs)
        self.batch_sizes = []
        self.call_index = 0
        self._attempts = {}  # entity_key -> attempt count so far
        self.behavior = behavior or (lambda kind, key, attempt: ("valid", _canned_valid(kind, key)))
        self.rc_and_log = rc_and_log or (lambda call_index: (0, ""))

    def __call__(self, cmd, **kwargs):
        self.calls.append((list(cmd), kwargs))
        self.call_index += 1
        cwd = Path(kwargs["cwd"])
        manifest = json.loads((cwd / "items.json").read_text())
        self.batch_sizes.append(len(manifest))
        output_dir = cwd / "output"

        returncode, log_text = self.rc_and_log(self.call_index)
        kwargs["stdout"].write(log_text.encode("utf-8"))
        kwargs["stdout"].flush()

        for entry in manifest:
            kind = _kind_of_entry(entry)
            entity_key = entry.get("task_key") or entry.get("session_key")
            self._attempts[entity_key] = self._attempts.get(entity_key, 0) + 1
            attempt = self._attempts[entity_key]
            action, payload = self.behavior(kind, entity_key, attempt)
            out_path = output_dir / f"{entity_key}.json"
            if action == "valid":
                out_path.write_text(json.dumps(payload), encoding="utf-8")
            elif action == "invalid":
                out_path.write_text(json.dumps(payload), encoding="utf-8")
            elif action == "missing":
                pass  # no file written at all
            else:
                raise AssertionError(f"unknown behavior action {action!r}")
        return subprocess.CompletedProcess(cmd, returncode)


class AgentsTestBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.staging_dir = Path(self._tmp.name) / "staging"

        self._real_run = agents.subprocess.run
        self.addCleanup(setattr, agents.subprocess, "run", self._real_run)

        # Every test gets a dummy (existing, but never executed) xagent
        # entry point as the default -- the existence check added for the
        # "missing binary silently drops items" fix would otherwise reject
        # every call in this suite, since the real
        # projects/xagent/dist/src/main.js doesn't exist in this checkout.
        self._dummy_xagent_bin = Path(self._tmp.name) / "dummy_xagent_main.js"
        self._dummy_xagent_bin.write_text("// dummy xagent entry point for tests\n")
        self._orig_xagent_bin = agents._XAGENT_BIN
        agents._XAGENT_BIN = self._dummy_xagent_bin
        self.addCleanup(setattr, agents, "_XAGENT_BIN", self._orig_xagent_bin)

        # Isolate TASK_ANALYZER_XAGENT_MAIN so host-environment leakage
        # never affects resolution-order tests.
        had_env = agents._XAGENT_MAIN_ENV_VAR in os.environ
        orig_env = os.environ.get(agents._XAGENT_MAIN_ENV_VAR)
        os.environ.pop(agents._XAGENT_MAIN_ENV_VAR, None)

        def _restore_env():
            if had_env:
                os.environ[agents._XAGENT_MAIN_ENV_VAR] = orig_env
            else:
                os.environ.pop(agents._XAGENT_MAIN_ENV_VAR, None)

        self.addCleanup(_restore_env)

    def _patch(self, fake):
        agents.subprocess.run = fake


class TestBatching(AgentsTestBase):
    def test_25_items_yields_3_invocations_of_at_most_12(self):
        fake = FakeXagent()
        self._patch(fake)

        items = [
            {
                "session_key": f"claude:sess-{i}",
                "version": "1",
                "input_sha256": f"{'a' * 63}{i % 10}",
                "timeline": f"turn 1: did thing {i}",
            }
            for i in range(25)
        ]

        written = agents.xagent_runner("phase_labeling", items, self.staging_dir)

        self.assertEqual(len(fake.calls), 3)
        self.assertTrue(all(n <= 12 for n in fake.batch_sizes))
        self.assertEqual(sum(fake.batch_sizes), 25)
        self.assertEqual(len(written), 25)
        for p in written:
            self.assertTrue(p.exists())
            self.assertTrue(p.name.endswith(".json"))
            self.assertEqual(p.parent, self.staging_dir / "phase_labeling")

    def test_empty_items_returns_empty_without_dispatch(self):
        fake = FakeXagent()
        self._patch(fake)

        written = agents.xagent_runner("complexity", [], self.staging_dir)

        self.assertEqual(written, [])
        self.assertEqual(len(fake.calls), 0)

    def test_unknown_kind_raises(self):
        fake = FakeXagent()
        self._patch(fake)
        with self.assertRaises(ValueError):
            agents.xagent_runner("bogus", [{"task_key": "x"}], self.staging_dir)


class TestPromptRendering(AgentsTestBase):
    def test_rendered_prompt_includes_rubric_and_staging_paths(self):
        fake = FakeXagent()
        self._patch(fake)

        items = [
            {
                "task_key": "add-widget--task-1",
                "version": "1",
                "input_sha256": "b" * 64,
                "brief_text": "Implement the widget core module.",
            },
            {
                "task_key": "add-widget--task-2",
                "version": "1",
                "input_sha256": "c" * 64,
                "brief_text": "Implement the gadget core module.",
            },
        ]

        agents.xagent_runner("complexity", items, self.staging_dir)

        self.assertEqual(len(fake.calls), 1)
        cwd = Path(fake.calls[0][1]["cwd"])
        prompt_text = (cwd / "prompt.md").read_text(encoding="utf-8")

        self.assertIn(str(agents._RUBRIC_PATH["complexity"]), prompt_text)
        self.assertIn(str(cwd / "items.json"), prompt_text)
        self.assertIn(str(cwd / "output"), prompt_text)
        # placeholders must be fully substituted, none left over.
        self.assertNotIn("{{RUBRIC_PATH}}", prompt_text)
        self.assertNotIn("{{ITEMS_JSON_PATH}}", prompt_text)
        self.assertNotIn("{{OUTPUT_DIR}}", prompt_text)

        manifest = json.loads((cwd / "items.json").read_text())
        self.assertEqual(len(manifest), 2)
        brief_file = Path(manifest[0]["brief_file"])
        self.assertEqual(brief_file.read_text(encoding="utf-8"), "Implement the widget core module.")

    def test_stdin_closed_and_stdout_is_a_file_not_a_pipe(self):
        fake = FakeXagent()
        self._patch(fake)

        items = [{"session_key": "claude:s1", "version": "1", "input_sha256": "d" * 64, "timeline": "t"}]
        agents.xagent_runner("phase_labeling", items, self.staging_dir)

        kwargs = fake.calls[0][1]
        self.assertNotEqual(kwargs["stdin"], subprocess.PIPE)
        self.assertNotEqual(kwargs["stdout"], subprocess.PIPE)
        self.assertEqual(kwargs["stdin"].name, os.devnull)
        # stdout is a real file on disk (the log), not an in-memory pipe.
        self.assertTrue(Path(kwargs["stdout"].name).exists())


class TestValidationAndRetry(AgentsTestBase):
    def test_malformed_output_is_retried_once_then_succeeds(self):
        def behavior(kind, key, attempt):
            if key == "add-widget--task-1" and attempt == 1:
                return "invalid", {"task_key": key}  # missing required keys
            return "valid", _canned_valid(kind, key)

        fake = FakeXagent(behavior=behavior)
        self._patch(fake)

        items = [
            {"task_key": "add-widget--task-1", "version": "1", "input_sha256": "e" * 64, "brief_text": "brief one"},
            {"task_key": "add-widget--task-2", "version": "1", "input_sha256": "f" * 64, "brief_text": "brief two"},
        ]

        written = agents.xagent_runner("complexity", items, self.staging_dir)

        self.assertEqual(len(fake.calls), 2)  # initial batch + one retry batch
        self.assertEqual(fake.batch_sizes, [2, 1])  # retry batch has only the invalid item
        self.assertEqual(len(written), 2)

        names = sorted(p.name for p in written)
        self.assertTrue(any("add-widget--task-1" in n for n in names))
        self.assertTrue(any("add-widget--task-2" in n for n in names))

    def test_still_invalid_after_retry_is_dropped_not_written(self):
        def behavior(kind, key, attempt):
            if key == "add-widget--task-1":
                return "missing", None  # never produces output, even on retry
            return "valid", _canned_valid(kind, key)

        fake = FakeXagent(behavior=behavior)
        self._patch(fake)

        items = [
            {"task_key": "add-widget--task-1", "version": "1", "input_sha256": "1" * 64, "brief_text": "brief one"},
            {"task_key": "add-widget--task-2", "version": "1", "input_sha256": "2" * 64, "brief_text": "brief two"},
        ]

        written = agents.xagent_runner("complexity", items, self.staging_dir)

        self.assertEqual(len(fake.calls), 2)
        self.assertEqual(len(written), 1)
        self.assertIn("add-widget--task-2", written[0].name)
        self.assertFalse(any("add-widget--task-1" in p.name for p in written))


class TestModelHint(AgentsTestBase):
    def test_model_hint_honored_by_default(self):
        fake = FakeXagent()
        self._patch(fake)

        # phase_labeling's prompt frontmatter declares model_hint: haiku.
        items = [{"session_key": "claude:s1", "version": "1", "input_sha256": "3" * 64, "timeline": "t"}]
        agents.xagent_runner("phase_labeling", items, self.staging_dir)
        cmd = fake.calls[0][0]
        self.assertEqual(cmd[cmd.index("--model") + 1], "haiku")

        fake.calls.clear()
        # complexity/grading declare model_hint: sonnet.
        items = [{"task_key": "t1", "version": "1", "input_sha256": "4" * 64, "brief_text": "b"}]
        agents.xagent_runner("complexity", items, self.staging_dir)
        cmd = fake.calls[0][0]
        self.assertEqual(cmd[cmd.index("--model") + 1], "sonnet")

    def test_model_override_wins_over_hint(self):
        fake = FakeXagent()
        self._patch(fake)

        items = [{"session_key": "claude:s2", "version": "1", "input_sha256": "5" * 64, "timeline": "t"}]
        agents.xagent_runner("phase_labeling", items, self.staging_dir, model="opus")
        cmd = fake.calls[0][0]
        self.assertEqual(cmd[cmd.index("--model") + 1], "opus")

    def test_harness_default_and_override(self):
        fake = FakeXagent()
        self._patch(fake)

        items = [{"task_key": "t1", "version": "1", "input_sha256": "6" * 64, "brief_text": "b"}]
        agents.xagent_runner("complexity", items, self.staging_dir)
        cmd = fake.calls[0][0]
        self.assertEqual(cmd[cmd.index("--harness") + 1], "claude_code")

        fake.calls.clear()
        agents.xagent_runner("complexity", items, self.staging_dir, harness="codex")
        cmd = fake.calls[0][0]
        self.assertEqual(cmd[cmd.index("--harness") + 1], "codex")


class TestGradingReviewFiles(AgentsTestBase):
    def test_grading_item_writes_review_text_and_uses_review_files_list(self):
        fake = FakeXagent()
        self._patch(fake)

        items = [
            {
                "task_key": "add-widget--task-1",
                "version": "1",
                "input_sha256": "7" * 64,
                "review_text": "PASS: looks correct, no issues found.",
            }
        ]
        written = agents.xagent_runner("grading", items, self.staging_dir)

        self.assertEqual(len(written), 1)
        cwd = Path(fake.calls[0][1]["cwd"])
        manifest = json.loads((cwd / "items.json").read_text())
        self.assertIsInstance(manifest[0]["review_files"], list)
        review_file = Path(manifest[0]["review_files"][0])
        self.assertEqual(review_file.read_text(encoding="utf-8"), "PASS: looks correct, no issues found.")

        data = json.loads(written[0].read_text(encoding="utf-8"))
        self.assertEqual(data["final_grade"], "A")


class TestXagentBinResolution(AgentsTestBase):
    """Review fix: the xagent entry point must be resolvable without editing
    source -- explicit param beats env var beats the repo-relative default."""

    def test_param_beats_env_beats_default(self):
        fake = FakeXagent()
        self._patch(fake)

        tmp = Path(self._tmp.name)
        env_bin = tmp / "env_main.js"
        param_bin = tmp / "param_main.js"
        for p in (env_bin, param_bin):
            p.write_text("// fake xagent entry\n")

        item = [{"task_key": "t1", "version": "1", "input_sha256": "a" * 64, "brief_text": "b"}]

        # Default (no override) -- setUp already pointed agents._XAGENT_BIN
        # at a dummy existing file.
        agents.xagent_runner("complexity", item, self.staging_dir)
        cmd = fake.calls[-1][0]
        self.assertEqual(cmd[1], str(self._dummy_xagent_bin))

        # Env var beats the default.
        os.environ[agents._XAGENT_MAIN_ENV_VAR] = str(env_bin)
        agents.xagent_runner("complexity", item, self.staging_dir)
        cmd = fake.calls[-1][0]
        self.assertEqual(cmd[1], str(env_bin))

        # Explicit param beats the env var.
        agents.xagent_runner("complexity", item, self.staging_dir, xagent_main=str(param_bin))
        cmd = fake.calls[-1][0]
        self.assertEqual(cmd[1], str(param_bin))


class TestXagentBinMissing(AgentsTestBase):
    """Review fix: a missing entry point must raise loudly, before any
    dispatch is attempted, naming the resolved path and all three
    resolution sources -- not silently produce zero staged files."""

    def test_missing_binary_raises_before_any_dispatch(self):
        fake = FakeXagent()
        self._patch(fake)

        missing = Path(self._tmp.name) / "does-not-exist" / "main.js"
        item = [{"task_key": "t1", "version": "1", "input_sha256": "a" * 64, "brief_text": "b"}]

        with self.assertRaises(RuntimeError) as ctx:
            agents.xagent_runner("complexity", item, self.staging_dir, xagent_main=str(missing))

        msg = str(ctx.exception)
        self.assertIn(str(missing), msg)
        self.assertIn("xagent_main", msg)
        self.assertIn(agents._XAGENT_MAIN_ENV_VAR, msg)
        self.assertEqual(len(fake.calls), 0)  # never dispatched


class TestNonzeroExit(AgentsTestBase):
    """Review fix: a subprocess that exits nonzero must not be silently
    treated the same as "the model produced bad JSON" -- if it's still
    failing after the one retry, raise with the exit code and log tail
    rather than quietly returning fewer staged files than requested."""

    def test_nonzero_exit_after_retry_raises_with_exit_code_and_log_tail(self):
        def rc_and_log(call_index):
            return 1, f"call {call_index}: node crash TAIL_MARKER_XYZ\n"

        def behavior(kind, key, attempt):
            return "missing", None  # process crashed -- no output ever produced

        fake = FakeXagent(behavior=behavior, rc_and_log=rc_and_log)
        self._patch(fake)

        items = [{"task_key": "t1", "version": "1", "input_sha256": "a" * 64, "brief_text": "b"}]

        with self.assertRaises(RuntimeError) as ctx:
            agents.xagent_runner("complexity", items, self.staging_dir)

        msg = str(ctx.exception)
        self.assertIn("1", msg)  # exit code
        self.assertIn("TAIL_MARKER_XYZ", msg)
        self.assertIn("t1", msg)
        self.assertEqual(len(fake.calls), 2)  # initial dispatch + exactly one retry, never more

    def test_nonzero_exit_on_first_attempt_recovers_on_successful_retry(self):
        def rc_and_log(call_index):
            return (1, "boom\n") if call_index == 1 else (0, "")

        def behavior(kind, key, attempt):
            if attempt == 1:
                return "missing", None
            return "valid", _canned_valid(kind, key)

        fake = FakeXagent(behavior=behavior, rc_and_log=rc_and_log)
        self._patch(fake)

        items = [{"task_key": "t1", "version": "1", "input_sha256": "a" * 64, "brief_text": "b"}]
        written = agents.xagent_runner("complexity", items, self.staging_dir)

        self.assertEqual(len(written), 1)
        self.assertEqual(len(fake.calls), 2)

    def test_genuine_validation_failure_with_zero_exit_still_just_drops(self):
        """Not every retry failure is a crash -- if xagent exits 0 both times
        but the model's output never validates, that item is still silently
        dropped (an accepted, pre-existing behavior; only nonzero-exit
        failures must raise)."""
        def behavior(kind, key, attempt):
            return "invalid", {"task_key": key}  # always missing required keys

        fake = FakeXagent(behavior=behavior)  # rc_and_log defaults to always-0
        self._patch(fake)

        items = [{"task_key": "t1", "version": "1", "input_sha256": "a" * 64, "brief_text": "b"}]
        written = agents.xagent_runner("complexity", items, self.staging_dir)

        self.assertEqual(written, [])
        self.assertEqual(len(fake.calls), 2)  # initial + 1 retry, then dropped -- no raise


if __name__ == "__main__":
    unittest.main()
