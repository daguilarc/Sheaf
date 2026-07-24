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
import json
import os
import sys
import tempfile
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

    def test_turn_timestamps(self):
        # followup-4 (session_turns): turn 1's items span timestamps 04-08
        # (closed by the token_count event at 09, whose own ts is ended_at);
        # turn 2's items span 10-14 (closed by the token_count at 15).
        self.assertEqual(self.rec.turns[0].started_at, "2026-07-02T00:00:04Z")
        self.assertEqual(self.rec.turns[0].ended_at, "2026-07-02T00:00:09Z")
        self.assertEqual(self.rec.turns[1].started_at, "2026-07-02T00:00:10Z")
        self.assertEqual(self.rec.turns[1].ended_at, "2026-07-02T00:00:15Z")

    def test_no_verdict_turns(self):
        self.assertFalse(any(t.is_verdict for t in self.rec.turns))


class TestExtractCodexPersistentReviewer(unittest.TestCase):
    """followup-4: a persistent reviewer session doing review + re-review
    inside one transcript -- two assistant turns, each ending with a
    SPEC/QUALITY verdict pair, must both be detected as verdict turns with
    their own (distinct) ended_at timestamps."""

    def setUp(self):
        self.rec = extractors.extract_codex(os.path.join(FIXTURES, "codex_persistent_reviewer.jsonl"))

    def test_two_turns_both_flagged_as_verdicts(self):
        self.assertEqual(self.rec.n_turns, 2)
        self.assertTrue(self.rec.turns[0].is_verdict)
        self.assertTrue(self.rec.turns[1].is_verdict)

    def test_verdict_turns_have_distinct_ended_at(self):
        boundaries = [t.ended_at for t in self.rec.turns if t.is_verdict]
        self.assertEqual(boundaries, ["2026-07-05T00:00:08Z", "2026-07-05T01:00:05Z"])
        self.assertEqual(len(set(boundaries)), 2)


class TestExtractCodexLeaky(unittest.TestCase):
    """followup-5: silent-checkpoint reconciliation. codex_leaky.jsonl has
    three real (visible-content) turns plus THREE silent token_count
    checkpoints that used to leak their deltas entirely: one before the
    first turn (leading mass), one between turns 2 and 3 (a mid-session
    gap), and one after the last turn (trailing mass). None of them may
    create a new turn or renumber an existing one -- each must fold into
    the correct EXISTING adjacent turn (leading/gap -> the next visible
    turn; trailing -> the last visible turn), per design.md D5's
    followup-5 amendment.

    Hand-traced expected values (see the fixture file's own token_count
    events): turn 1 = 200 (leading, silent) + 50 (its own delta) = 250;
    turn 2 = 50 (its own delta only, no adjacent silent checkpoint);
    turn 3 = 40 (its own delta) + 20 (trailing, silent) = 60 + ... =
    100. Reasoning tokens fold identically: turn 1 = 5+3=8, turn 2 = 2,
    turn 3 = 1+2+1 = 4. Session totals (final cumulative checkpoint):
    output_tokens=400, reasoning_tokens=14.
    """

    def setUp(self):
        self.rec = extractors.extract_codex(os.path.join(FIXTURES, "codex_leaky.jsonl"))

    def test_turn_count_and_indices_unchanged_by_folding(self):
        # The hard constraint: folding silent deltas must never create a
        # new turn or renumber an existing one.
        self.assertEqual(self.rec.n_turns, 3)
        self.assertEqual([t.index for t in self.rec.turns], [1, 2, 3])

    def test_leading_silent_mass_folds_into_turn_one(self):
        self.assertEqual(self.rec.turns[0].output_tokens, 250)
        self.assertEqual(self.rec.turns[0].reasoning_tokens, 8)

    def test_mid_session_gap_has_no_effect_when_absent(self):
        # Turn 2 has no adjacent silent checkpoint of its own in this
        # fixture (the gap sits between turns 2 and 3) -- its own delta
        # is unmodified.
        self.assertEqual(self.rec.turns[1].output_tokens, 50)
        self.assertEqual(self.rec.turns[1].reasoning_tokens, 2)

    def test_trailing_silent_mass_folds_into_last_turn(self):
        self.assertEqual(self.rec.turns[2].output_tokens, 100)
        self.assertEqual(self.rec.turns[2].reasoning_tokens, 4)

    def test_turn_items_unchanged_by_folding(self):
        # Folded deltas change turn TOKEN numbers, never turn TEXT.
        self.assertEqual(
            self.rec.turns[0].items,
            ["CALL shell: bash -lc ls", "OUT: file1\nfile2", "SAY: Turn 1 content."],
        )

    def test_reconciliation_invariant_sum_equals_session_totals(self):
        self.assertEqual(sum(t.output_tokens for t in self.rec.turns), self.rec.tokens.output_tokens)
        self.assertEqual(sum(t.reasoning_tokens for t in self.rec.turns), self.rec.tokens.reasoning_tokens)
        self.assertEqual(self.rec.tokens.output_tokens, 400)
        self.assertEqual(self.rec.tokens.reasoning_tokens, 14)


class TestExtractCodexDecreasingTotalFallback(unittest.TestCase):
    """followup-5: total_token_usage is monotonically non-decreasing in
    every real transcript checked (see followup-5-report.md), but the
    cumulative-diff reconciliation must not crash or invent a negative
    delta if it somehow isn't -- it falls back to this checkpoint's own
    last_token_usage instead, exactly the pre-fix behavior for that one
    checkpoint."""

    def test_a_decreasing_total_falls_back_to_last_token_usage(self):
        lines = [
            {"timestamp": "2026-07-20T00:00:00Z", "type": "session_meta",
             "payload": {"id": "decrease-sess", "cwd": "/repo", "source": "exec"}},
            {"timestamp": "2026-07-20T00:00:01Z", "type": "event_msg",
             "payload": {"type": "user_message", "message": "Do the thing."}},
            {"timestamp": "2026-07-20T00:00:02Z", "type": "response_item",
             "payload": {"type": "message", "role": "assistant",
                         "content": [{"type": "output_text", "text": "First."}]}},
            {"timestamp": "2026-07-20T00:00:03Z", "type": "event_msg", "payload": {
                "type": "token_count",
                "info": {"total_token_usage": {"output_tokens": 500, "reasoning_output_tokens": 0},
                          "last_token_usage": {"output_tokens": 500, "reasoning_output_tokens": 0}},
            }},
            {"timestamp": "2026-07-20T00:00:04Z", "type": "response_item",
             "payload": {"type": "message", "role": "assistant",
                         "content": [{"type": "output_text", "text": "Second."}]}},
            # Total went DOWN from 500 to 100 -- not physically possible in
            # practice (never observed in the real corpus), but must not
            # produce a negative delta; falls back to last_token_usage's
            # own reported 30 for this checkpoint instead.
            {"timestamp": "2026-07-20T00:00:05Z", "type": "event_msg", "payload": {
                "type": "token_count",
                "info": {"total_token_usage": {"output_tokens": 100, "reasoning_output_tokens": 0},
                          "last_token_usage": {"output_tokens": 30, "reasoning_output_tokens": 0}},
            }},
        ]
        with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as fh:
            for line in lines:
                fh.write(json.dumps(line) + "\n")
            path = fh.name
        try:
            rec = extractors.extract_codex(path)
        finally:
            os.unlink(path)

        self.assertEqual(rec.n_turns, 2)
        self.assertEqual(rec.turns[0].output_tokens, 500)
        # Falls back to last_token_usage (30), not a negative/garbage value.
        self.assertEqual(rec.turns[1].output_tokens, 30)


class TestExtractClaudeLeaky(unittest.TestCase):
    """followup-5: silent-checkpoint reconciliation, claude side.
    claude_leaky.jsonl has a silent (whitespace-only text) assistant
    message before the first real turn, and a silent (empty content)
    assistant message trailing the last real turn -- neither may create a
    new turn; both must fold into the adjacent existing one.

    Hand-traced: turn 1 = 15 (leading, silent) + 50 (its own) = 65;
    turn 2 = 40 (its own) + 25 (trailing, silent) = 65. Session total
    output_tokens = 15 + 50 + 40 + 25 = 130.
    """

    def setUp(self):
        self.rec = extractors.extract_claude(os.path.join(FIXTURES, "claude_leaky.jsonl"))

    def test_turn_count_and_indices_unchanged_by_folding(self):
        self.assertEqual(self.rec.n_turns, 2)
        self.assertEqual([t.index for t in self.rec.turns], [1, 2])

    def test_leading_silent_mass_folds_into_turn_one(self):
        self.assertEqual(self.rec.turns[0].output_tokens, 65)

    def test_trailing_silent_mass_folds_into_last_turn(self):
        self.assertEqual(self.rec.turns[1].output_tokens, 65)

    def test_turn_items_unchanged_by_folding(self):
        self.assertEqual(
            self.rec.turns[0].items,
            ["SAY: Turn 1 content.", "CALL Bash: ls", "OUT: file1\nfile2"],
        )
        self.assertEqual(self.rec.turns[1].items, ["SAY: Turn 2 content."])

    def test_reconciliation_invariant_sum_equals_session_totals(self):
        self.assertEqual(sum(t.output_tokens for t in self.rec.turns), self.rec.tokens.output_tokens)
        self.assertEqual(self.rec.tokens.output_tokens, 130)


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

    def test_turn_timestamps(self):
        # followup-4 (session_turns): turn 1 opens at its own assistant
        # message (ts05) and its last item is the tool_result at ts07
        # (ts08's queue-operation isn't a turn item and doesn't extend it,
        # and flush() happens at ts10, which belongs to turn 2, not 1).
        # Turn 2 opens at ts10 and its last item is the [CONTEXT
        # COMPACTION] marker at ts14 (isCompactSummary, appended before the
        # next assistant message flushes it at ts15). Turn 3 is just its
        # own single assistant message at ts15.
        self.assertEqual(self.rec.turns[0].started_at, "2026-07-03T00:00:05Z")
        self.assertEqual(self.rec.turns[0].ended_at, "2026-07-03T00:00:07Z")
        self.assertEqual(self.rec.turns[1].started_at, "2026-07-03T00:00:10Z")
        self.assertEqual(self.rec.turns[1].ended_at, "2026-07-03T00:00:14Z")
        self.assertEqual(self.rec.turns[2].started_at, "2026-07-03T00:00:15Z")
        self.assertEqual(self.rec.turns[2].ended_at, "2026-07-03T00:00:15Z")

    def test_no_verdict_turns(self):
        self.assertFalse(any(t.is_verdict for t in self.rec.turns))

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


class TestIsVerdictText(unittest.TestCase):
    """followup-4: verdict-turn detection requires BOTH a SPEC and a
    QUALITY line (real transcripts use a varying vocabulary for the
    QUALITY line across rubric iterations -- APPROVE(D)/NEEDS-FIXES/
    PASS/FAIL/REVISE -- grepped from analysis/sdd-model-analysis/data and
    ~/.codex/sessions during authoring)."""

    def test_both_lines_present_is_a_verdict(self):
        self.assertTrue(extractors._is_verdict_text("Findings.\n\nSPEC: PASS\nQUALITY: APPROVED"))
        self.assertTrue(extractors._is_verdict_text("SPEC: FAIL (bug)\nQUALITY: NEEDS-FIXES"))
        self.assertTrue(extractors._is_verdict_text("spec: pass\nquality: revise"))
        self.assertTrue(extractors._is_verdict_text("SPEC: PASS\nQUALITY: APPROVE"))

    def test_only_one_line_is_not_a_verdict(self):
        self.assertFalse(extractors._is_verdict_text("SPEC: PASS only, no quality line"))
        self.assertFalse(extractors._is_verdict_text("QUALITY: APPROVED only, no spec line"))

    def test_incidental_prose_is_not_a_verdict(self):
        self.assertFalse(extractors._is_verdict_text("This spec covers quality separately in prose."))
        self.assertFalse(extractors._is_verdict_text(""))
        self.assertFalse(extractors._is_verdict_text(None))

    def test_reviewer_quoting_its_own_brief_is_not_a_verdict(self):
        # fix-round-1 review, finding 2: every review brief literally
        # contains this template text ("End with EXACTLY: SPEC: PASS or
        # SPEC: FAIL / QUALITY: APPROVE or QUALITY: REVISE"). A reviewer
        # restating its own instructions must NOT be treated as having
        # rendered a verdict.
        self.assertFalse(extractors._is_verdict_text(
            "As instructed, I will end with SPEC: PASS or SPEC: FAIL\n"
            "and QUALITY: APPROVE or QUALITY: REVISE."
        ))

    def test_backtick_quoted_brief_format_is_not_a_verdict(self):
        self.assertFalse(extractors._is_verdict_text(
            "I must end with exactly two lines: `SPEC: PASS|FAIL` and "
            "`QUALITY: APPROVE|REVISE`."
        ))

    def test_pipe_alternation_brief_format_is_not_a_verdict(self):
        self.assertFalse(extractors._is_verdict_text(
            "Return SPEC: PASS|FAIL\nQUALITY: APPROVE|REVISE as your final answer."
        ))

    def test_genuine_verdict_with_trailing_reason_still_matches(self):
        # Real corpus format (analysis/sdd-model-analysis/data/timelines):
        # a genuine verdict line commonly carries a one-line parenthetical
        # reason -- this must still be recognized, not just a bare
        # "SPEC: PASS" with nothing else on the line.
        self.assertTrue(extractors._is_verdict_text(
            "Findings: none critical. I verified all six prior issues.\n\n"
            "SPEC: PASS (required kind input addresses are now enforced)\n"
            "QUALITY: APPROVED"
        ))
        self.assertTrue(extractors._is_verdict_text(
            "SPEC: FAIL (non-Launchpad system-message entries can be "
            "accepted without the required chan/CC address variant.)\n"
            "QUALITY: NEEDS-FIXES"
        ))

    def test_verdict_lines_far_from_each_other_is_not_a_verdict(self):
        # "adjacent or near-adjacent" -- a SPEC line and a QUALITY line
        # separated by many lines of unrelated prose is not a genuine
        # two-line verdict block.
        filler = "\n".join(f"finding {i}: some unrelated prose line" for i in range(20))
        self.assertFalse(extractors._is_verdict_text(f"SPEC: PASS\n{filler}\nQUALITY: APPROVED"))

    def test_verdict_lines_not_near_the_end_is_not_a_verdict(self):
        # "in the trailing portion of the message" -- a clean SPEC/QUALITY
        # pair that appears early, followed by a long report, is not
        # treated as the message's real (i.e. final) verdict.
        trailer = "\n".join(f"additional finding {i} after the verdict-looking lines" for i in range(30))
        self.assertFalse(extractors._is_verdict_text(f"SPEC: PASS\nQUALITY: APPROVED\n{trailer}"))

    def test_multiple_verdict_values_on_one_line_is_not_a_verdict(self):
        self.assertFalse(extractors._is_verdict_text("SPEC: PASS or FAIL (one-line reason)\nQUALITY: APPROVED or NEEDS-FIXES"))


if __name__ == "__main__":
    unittest.main()
