"""Tests for the task-analyzer transcript extraction library (extractors.py).

Fixtures live in tests/fixtures/ and are small, hand-built JSONL transcripts
that mimic the shape of real codex rollout files and real claude project
transcripts (schemas confirmed against real files under ~/.codex/sessions
and ~/.claude/projects during authoring; see task-3-report.md).
"""
import glob
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import extractors  # noqa: E402

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


class TestExtractCodexExec(unittest.TestCase):
    def setUp(self):
        self.rec = extractors.extract_codex(os.path.join(FIXTURES, "codex_exec.jsonl"))

    def test_session_id_and_entry(self):
        self.assertEqual(self.rec.session_id, "exec-sess-1")
        self.assertEqual(self.rec.provider, "codex")
        self.assertEqual(self.rec.harness_entry, "exec")
        self.assertIsNone(self.rec.spawn_path)
        self.assertIsNone(self.rec.spawn_role)

    def test_model_and_effort(self):
        self.assertEqual(self.rec.model, "gpt-5.5-codex")
        self.assertEqual(self.rec.effort, "high")

    def test_prompt_skips_init_handshake(self):
        self.assertEqual(self.rec.prompt, "Implement task 3 in the repo.")

    def test_turn_count_and_per_turn_output_tokens(self):
        self.assertEqual(self.rec.n_turns, 2)
        self.assertEqual(len(self.rec.turns), 2)
        self.assertEqual(self.rec.turns[0].output_tokens, 50)
        self.assertEqual(self.rec.turns[0].reasoning_tokens, 10)
        self.assertEqual(self.rec.turns[1].output_tokens, 40)
        self.assertEqual(self.rec.turns[1].reasoning_tokens, 10)

    def test_token_totals_sum_from_turns(self):
        self.assertEqual(self.rec.tokens.output_tokens, 90)
        self.assertEqual(self.rec.tokens.reasoning_tokens, 20)
        self.assertEqual(
            sum(t.output_tokens for t in self.rec.turns), self.rec.tokens.output_tokens
        )
        self.assertEqual(
            sum(t.reasoning_tokens for t in self.rec.turns), self.rec.tokens.reasoning_tokens
        )
        self.assertEqual(self.rec.tokens.input_tokens, 1800)
        self.assertEqual(self.rec.tokens.cached_tokens, 400)

    def test_compaction_counted(self):
        self.assertEqual(self.rec.n_compactions, 1)
        self.assertTrue(any("[CONTEXT COMPACTION]" in it for it in self.rec.turns[1].items))

    def test_tool_calls_counted(self):
        self.assertEqual(self.rec.n_tool_calls, 2)

    def test_last_message(self):
        self.assertEqual(self.rec.last_message, "Applied the patch and compacted context.")


class TestExtractCodexSpawn(unittest.TestCase):
    def setUp(self):
        self.rec = extractors.extract_codex(os.path.join(FIXTURES, "codex_spawn.jsonl"))

    def test_thread_spawn_entry_and_spawn_fields(self):
        self.assertEqual(self.rec.session_id, "spawn-sess-1")
        self.assertEqual(self.rec.harness_entry, "thread_spawn")
        self.assertEqual(self.rec.spawn_path, "/root/task_3_x")
        self.assertEqual(self.rec.spawn_role, "implementer")

    def test_model_effort_and_turns(self):
        self.assertEqual(self.rec.model, "gpt-5.5-codex")
        self.assertEqual(self.rec.effort, "medium")
        self.assertEqual(self.rec.n_turns, 1)
        self.assertEqual(self.rec.turns[0].output_tokens, 40)

    def test_prompt_skips_init_handshake(self):
        self.assertEqual(self.rec.prompt, "Implement task_3_x subroutine.")

    def test_no_compactions(self):
        self.assertEqual(self.rec.n_compactions, 0)


class TestExtractClaudeSession(unittest.TestCase):
    def setUp(self):
        self.rec = extractors.extract_claude(os.path.join(FIXTURES, "claude_session.jsonl"))

    def test_session_id_and_entry(self):
        self.assertEqual(self.rec.session_id, "claude-sess-1")
        self.assertEqual(self.rec.provider, "claude")
        self.assertEqual(self.rec.harness_entry, "main")

    def test_model(self):
        self.assertEqual(self.rec.model, "claude-sonnet-5")

    def test_prompt(self):
        self.assertEqual(self.rec.prompt, "Implement task 3.")

    def test_turn_count_and_per_turn_output_tokens(self):
        # 3 assistant API messages -> 3 turns, split per-message.
        self.assertEqual(self.rec.n_turns, 3)
        self.assertEqual(len(self.rec.turns), 3)
        self.assertEqual(self.rec.turns[0].output_tokens, 80)
        self.assertEqual(self.rec.turns[1].output_tokens, 120)
        self.assertEqual(self.rec.turns[2].output_tokens, 60)

    def test_token_totals(self):
        self.assertEqual(self.rec.tokens.output_tokens, 260)
        self.assertEqual(
            sum(t.output_tokens for t in self.rec.turns), self.rec.tokens.output_tokens
        )
        self.assertEqual(self.rec.tokens.input_tokens, 1400)
        self.assertEqual(self.rec.tokens.cached_tokens, 350)

    def test_compaction_counted_via_isCompactSummary(self):
        self.assertEqual(self.rec.n_compactions, 1)
        self.assertTrue(
            any("[CONTEXT COMPACTION]" in it for turn in self.rec.turns for it in turn.items)
        )

    def test_tool_calls_and_tool_result_items(self):
        self.assertEqual(self.rec.n_tool_calls, 2)
        self.assertTrue(any(it.startswith("OUT:") for turn in self.rec.turns for it in turn.items))
        self.assertTrue(any(it.startswith("CALL ") for turn in self.rec.turns for it in turn.items))

    def test_last_message(self):
        self.assertEqual(self.rec.last_message, "Done implementing task 3.")


class TestExtractClaudeSubagent(unittest.TestCase):
    def setUp(self):
        self.rec = extractors.extract_claude(os.path.join(FIXTURES, "claude_subagent.jsonl"))

    def test_session_id_is_basename(self):
        self.assertEqual(self.rec.session_id, "claude_subagent")
        self.assertEqual(self.rec.harness_entry, "subagent")

    def test_turns_and_tokens(self):
        self.assertEqual(self.rec.n_turns, 2)
        self.assertEqual(self.rec.turns[0].output_tokens, 30)
        self.assertEqual(self.rec.turns[1].output_tokens, 20)
        self.assertEqual(self.rec.tokens.output_tokens, 50)

    def test_prompt_and_last_message(self):
        self.assertEqual(self.rec.prompt, "Implement task 3 subroutine.")
        self.assertEqual(self.rec.last_message, "Tests pass, done.")


class TestRenderTimeline(unittest.TestCase):
    def test_codex_timeline_has_turn_header_and_call_line(self):
        rec = extractors.extract_codex(os.path.join(FIXTURES, "codex_exec.jsonl"))
        out = extractors.render_timeline(rec)
        self.assertIn("## Turn 1", out)
        self.assertIn("CALL", out)

    def test_claude_timeline_has_turn_header_and_call_line(self):
        rec = extractors.extract_claude(os.path.join(FIXTURES, "claude_session.jsonl"))
        out = extractors.render_timeline(rec)
        self.assertIn("## Turn 1", out)
        self.assertIn("CALL", out)


class TestRealCorpusSmoke(unittest.TestCase):
    REAL = os.path.expanduser("~/.codex/sessions")

    @unittest.skipUnless(os.path.isdir(REAL), "no codex sessions on this machine")
    def test_real_corpus_parses_one(self):
        files = sorted(glob.glob(os.path.join(self.REAL, "**", "rollout-*.jsonl"), recursive=True))[:3]
        self.assertTrue(files, "expected at least one real rollout file")
        for f in files:
            rec = extractors.extract_codex(f)
            self.assertTrue(rec.session_id)


if __name__ == "__main__":
    unittest.main()
