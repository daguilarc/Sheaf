"""Tests for the task-analyzer transcript extraction library (extractors.py).

Fixtures live in tests/fixtures/ and are small, hand-built JSONL transcripts
that mimic the shape of real codex rollout files and real claude project
transcripts (schemas confirmed against real files under ~/.codex/sessions
and ~/.claude/projects during authoring; see task-3-report.md). Every
fixture's expected numbers were hand-traced through the turn/token-splitting
algorithm and cross-checked by running the implementation once it existed
(see task-3-report.md for the TDD RED/GREEN evidence and the review-fix
follow-up that introduced the cost-ready TokenTotals semantics below).

TokenTotals semantics (see extractors.TokenTotals docstring for the full
ruling): ``input_tokens`` is every token billed at the full input rate;
``cached_tokens`` is cache-READ tokens only. codex: input_tokens = provider
input_tokens - cached_input_tokens, cached_tokens = cached_input_tokens.
claude: input_tokens = uncached input + cache_creation_input_tokens (cache
creation is billed near, but not exactly at, the input rate; folded in here
per the Task 6 cost-model approximation), cached_tokens =
cache_read_input_tokens only.
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

    def test_token_totals(self):
        # final total_token_usage: input=1800, cached_input=400, output=90, reasoning=20
        # cost-ready mapping: input_tokens = 1800 - 400 = 1400, cached_tokens = 400
        self.assertEqual(self.rec.tokens.input_tokens, 1400)
        self.assertEqual(self.rec.tokens.cached_tokens, 400)
        self.assertEqual(self.rec.tokens.output_tokens, 90)
        self.assertEqual(self.rec.tokens.reasoning_tokens, 20)
        self.assertEqual(
            sum(t.output_tokens for t in self.rec.turns), self.rec.tokens.output_tokens
        )
        self.assertEqual(
            sum(t.reasoning_tokens for t in self.rec.turns), self.rec.tokens.reasoning_tokens
        )

    def test_peak_context(self):
        # turn 1 ctx = 1000 + 50 = 1050; turn 2 ctx = 800 + 40 = 840; max = 1050
        self.assertEqual(self.rec.peak_context, 1050)

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

    def test_session_id_and_entry(self):
        self.assertEqual(self.rec.session_id, "spawn-sess-1")
        self.assertEqual(self.rec.provider, "codex")
        self.assertEqual(self.rec.harness_entry, "thread_spawn")
        self.assertEqual(self.rec.spawn_path, "/root/task_3_x")
        self.assertEqual(self.rec.spawn_role, "implementer")

    def test_model_and_effort(self):
        self.assertEqual(self.rec.model, "gpt-5.5-codex")
        self.assertEqual(self.rec.effort, "medium")

    def test_prompt_skips_init_handshake(self):
        self.assertEqual(self.rec.prompt, "Implement task_3_x subroutine.")

    def test_turn_count_and_per_turn_output_tokens(self):
        self.assertEqual(self.rec.n_turns, 1)
        self.assertEqual(len(self.rec.turns), 1)
        self.assertEqual(self.rec.turns[0].output_tokens, 40)
        self.assertEqual(self.rec.turns[0].reasoning_tokens, 5)

    def test_token_totals(self):
        # total_token_usage: input=600, cached_input=100, output=40, reasoning=5
        # cost-ready mapping: input_tokens = 600 - 100 = 500, cached_tokens = 100
        self.assertEqual(self.rec.tokens.input_tokens, 500)
        self.assertEqual(self.rec.tokens.cached_tokens, 100)
        self.assertEqual(self.rec.tokens.output_tokens, 40)
        self.assertEqual(self.rec.tokens.reasoning_tokens, 5)

    def test_peak_context(self):
        self.assertEqual(self.rec.peak_context, 640)

    def test_no_compactions(self):
        self.assertEqual(self.rec.n_compactions, 0)

    def test_tool_calls_counted(self):
        # shell(pytest) + shell(grep) + shell(git status), padded per review fix
        self.assertEqual(self.rec.n_tool_calls, 3)


class TestExtractClaudeSession(unittest.TestCase):
    def setUp(self):
        self.rec = extractors.extract_claude(os.path.join(FIXTURES, "claude_session.jsonl"))

    def test_session_id_and_entry(self):
        self.assertEqual(self.rec.session_id, "claude-sess-1")
        self.assertEqual(self.rec.provider, "claude")
        self.assertEqual(self.rec.harness_entry, "main")

    def test_model_and_effort(self):
        self.assertEqual(self.rec.model, "claude-sonnet-5")
        self.assertIsNone(self.rec.effort)

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
        # per-message usage: (inp=500,cr=100,cc=50,out=80), (600,150,0,120), (300,50,0,60)
        # input_tokens = sum(inp + cc) = 550 + 600 + 300 = 1450
        # cached_tokens = sum(cr) = 100 + 150 + 50 = 300
        self.assertEqual(self.rec.tokens.input_tokens, 1450)
        self.assertEqual(self.rec.tokens.cached_tokens, 300)
        self.assertEqual(self.rec.tokens.output_tokens, 260)
        self.assertEqual(self.rec.tokens.reasoning_tokens, 0)
        self.assertEqual(
            sum(t.output_tokens for t in self.rec.turns), self.rec.tokens.output_tokens
        )

    def test_peak_context(self):
        # per-message inp+cr+cc+out: 730, 870, 410 -> max 870
        self.assertEqual(self.rec.peak_context, 870)

    def test_compaction_counted_via_isCompactSummary(self):
        self.assertEqual(self.rec.n_compactions, 1)
        self.assertTrue(
            any("[CONTEXT COMPACTION]" in it for turn in self.rec.turns for it in turn.items)
        )

    def test_tool_calls_and_tool_result_items(self):
        # Bash+Grep (msg1), Edit+Bash+Read (msg2) = 5 tool_use blocks
        self.assertEqual(self.rec.n_tool_calls, 5)
        self.assertTrue(any(it.startswith("OUT:") for turn in self.rec.turns for it in turn.items))
        self.assertTrue(any(it.startswith("CALL ") for turn in self.rec.turns for it in turn.items))

    def test_last_message(self):
        self.assertEqual(self.rec.last_message, "Done implementing task 3.")


class TestExtractClaudeSubagent(unittest.TestCase):
    def setUp(self):
        self.rec = extractors.extract_claude(os.path.join(FIXTURES, "claude_subagent.jsonl"))

    def test_session_id_is_basename_and_entry(self):
        self.assertEqual(self.rec.session_id, "claude_subagent")
        self.assertEqual(self.rec.provider, "claude")
        self.assertEqual(self.rec.harness_entry, "subagent")

    def test_model_and_effort(self):
        self.assertEqual(self.rec.model, "claude-haiku-4-5")
        self.assertIsNone(self.rec.effort)

    def test_turn_count_and_per_turn_output_tokens(self):
        # 3 assistant messages -> 3 turns
        self.assertEqual(self.rec.n_turns, 3)
        self.assertEqual(self.rec.turns[0].output_tokens, 30)
        self.assertEqual(self.rec.turns[1].output_tokens, 25)
        self.assertEqual(self.rec.turns[2].output_tokens, 20)

    def test_token_totals(self):
        # per-message usage: (200,10,0,30), (180,20,0,25), (150,0,0,20)
        # input_tokens = sum(inp + cc) = 200 + 180 + 150 = 530
        # cached_tokens = sum(cr) = 10 + 20 + 0 = 30
        self.assertEqual(self.rec.tokens.input_tokens, 530)
        self.assertEqual(self.rec.tokens.cached_tokens, 30)
        self.assertEqual(self.rec.tokens.output_tokens, 75)
        self.assertEqual(self.rec.tokens.reasoning_tokens, 0)

    def test_peak_context(self):
        # per-message inp+cr+cc+out: 240, 225, 170 -> max 240
        self.assertEqual(self.rec.peak_context, 240)

    def test_no_compactions(self):
        self.assertEqual(self.rec.n_compactions, 0)

    def test_prompt_and_last_message(self):
        self.assertEqual(self.rec.prompt, "Implement task 3 subroutine.")
        self.assertEqual(self.rec.last_message, "Tests pass, done.")


class TestRenderTimeline(unittest.TestCase):
    def test_codex_exec_timeline_has_turn_header_and_call_line(self):
        rec = extractors.extract_codex(os.path.join(FIXTURES, "codex_exec.jsonl"))
        out = extractors.render_timeline(rec)
        self.assertIn("## Turn 1", out)
        self.assertIn("CALL", out)

    def test_codex_spawn_timeline_has_turn_header_and_call_line(self):
        rec = extractors.extract_codex(os.path.join(FIXTURES, "codex_spawn.jsonl"))
        out = extractors.render_timeline(rec)
        self.assertIn("## Turn 1", out)
        self.assertIn("CALL", out)

    def test_claude_session_timeline_has_turn_header_and_call_line(self):
        rec = extractors.extract_claude(os.path.join(FIXTURES, "claude_session.jsonl"))
        out = extractors.render_timeline(rec)
        self.assertIn("## Turn 1", out)
        self.assertIn("CALL", out)

    def test_claude_subagent_timeline_has_turn_header_and_call_line(self):
        rec = extractors.extract_claude(os.path.join(FIXTURES, "claude_subagent.jsonl"))
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
