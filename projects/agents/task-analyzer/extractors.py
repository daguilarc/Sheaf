"""Transcript extraction library for the SDD task-analyzer pipeline.

Parses codex rollout files (``rollout-*.jsonl``) and Claude Code project
transcripts (``*.jsonl``) into a common ``SessionRecord`` shape, and renders
a condensed markdown timeline used for LLM-driven phase labeling.

This is a clean-room port + refactor of the behavior in
``analysis/sdd-model-analysis/scripts/extract_codex.py`` and
``extract_claude.py`` (read for reference; not imported). Key semantics
preserved from those scripts:

- codex: turns are split on ``token_count`` events, using that event's
  ``last_token_usage`` as the just-closed turn's delta; ``session_meta``'s
  ``source`` field distinguishes ``exec`` (a plain string) from
  ``thread_spawn`` (a nested ``{"subagent": {"thread_spawn": {...}}}``
  dict, from which ``agent_path``/``agent_role`` are captured as
  ``spawn_path``/``spawn_role``); compaction is any ``event_msg`` whose
  inner ``type`` is one of ``compacted|compaction|context_compacted``.
- claude: turns are split per assistant API message (each ``assistant``
  line is one API response), using that message's own ``usage`` as the
  delta for the turn it closes; tool-result content on a following
  ``user`` line is folded into the turn as an ``OUT:`` item without
  starting a new turn; a plain user message (not a tool result) also
  closes the turn in progress; ``isCompactSummary`` on a ``user`` line
  marks a compaction and is not treated as a prompt or turn item.
  Subagent transcripts are recognized by the presence of an ``agentId``
  key (real subagent files at ``*/subagents/agent-*.jsonl`` carry this
  and never carry ``sessionId``); for those, and for any file that never
  states its own ``sessionId``, the file's basename (sans ``.jsonl``) is
  used as ``session_id``.

Stdlib only.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import List, Optional

COMPACT_TYPES = {"compacted", "compaction", "context_compacted"}

# Condensed item snippets are truncated to keep timelines readable.
_SNIPPET_LEN = 400
_MESSAGE_LEN = 600

# Verdict-turn detection (followup-4, design.md D5 amendment; tightened in
# the fix-round-1 review): a reviewer turn whose assistant text contains
# BOTH a standalone "SPEC: PASS/FAIL" line and a standalone "QUALITY: ..."
# line, near each other, near the end of the message, is a genuine review
# verdict -- not incidental prose that happens to mention "spec" or
# "quality" separately, and NOT a reviewer merely quoting its own brief's
# instructions back (every review brief literally contains template text
# like "SPEC: PASS or SPEC: FAIL" / "`SPEC: PASS|FAIL`" / "QUALITY: APPROVE
# or QUALITY: REVISE" -- an earlier looser regex treated that quoted
# instruction text itself as a verdict, corrupting review-boundary
# detection). The QUALITY alternation is deliberately permissive -- real
# transcripts (grepped from analysis/sdd-model-analysis/data/*.json and
# ~/.codex/sessions) use APPROVE(D), NEEDS-FIXES, PASS, FAIL, and REVISE
# across different rubric iterations, not one fixed vocabulary. A genuine
# verdict line MAY carry a trailing one-line reason (real corpus examples:
# "SPEC: FAIL (non-Launchpad system-message entries can be accepted
# without the required chan/CC address variant.)") -- only template/
# quoting artifacts are rejected: a line naming BOTH alternatives (almost
# always joined by literal " or ", "|", or backticks in every brief we
# grepped) is never a real verdict, since a real verdict commits to
# exactly one value.
#
# Checked against the FULL (untruncated) assistant text at extraction
# time, never the condensed/truncated `SAY:` timeline snippet
# (_MESSAGE_LEN=600) a long review response's verdict lines -- conventionally
# at the very END, per every reviewer prompt's "End with EXACTLY: ..."
# instruction -- would frequently fall outside of.
_SPEC_LINE_RE = re.compile(r"^\s*SPEC:\s*(PASS|FAIL)\b", re.I)
_QUALITY_LINE_RE = re.compile(r"^\s*QUALITY:\s*(APPROVE[D]?|NEEDS[- ]FIXES|PASS|FAIL|REVISE)\b", re.I)
# Any of these on a candidate verdict line marks it as template/quoted
# instructional text rather than a real, committed verdict: a literal
# "or" between alternatives, a "|" alternation, or a backtick (every brief
# quotes the verdict format in one of exactly these three ways). Checked
# only against the verdict line's CORE -- everything up to its first
# reason delimiter (" - ", " -- ", em-dash, or an opening paren) -- never
# the full line: a genuine verdict's trailing one-line reason routinely
# contains the word "or" in ordinary prose (e.g. "missing signature or
# wrong type") or a backtick-quoted code identifier (e.g. "SPEC: FAIL -
# `LoadPatchJSON` uses..."), real examples grepped from
# analysis/sdd-model-analysis/data/timelines -- scanning the whole line
# for these artifacts (an earlier version of this fix did) incorrectly
# rejected such genuine verdicts as though they were brief-quoting.
_QUOTING_ARTIFACT_RE = re.compile(r"`|\|| or ", re.I)
_VERDICT_CORE_DELIMITER_RE = re.compile(r"\(| --? |—")
# A verdict pair must be within this many lines of each other ("adjacent or
# near-adjacent" -- real verdicts are always two consecutive lines, but
# tolerate a small gap for stray blank lines or a short intervening label).
_VERDICT_ADJACENCY_LINES = 3
# ...and within this many lines of the END of the message ("the trailing
# portion") -- real verdicts are the literal last thing a reviewer prompt
# demands ("End with EXACTLY: ..."), never buried mid-report.
_VERDICT_TRAILING_LINES = 20


def _verdict_core(line: str) -> str:
    """`line` truncated at its first reason delimiter (opening paren, " - ",
    " -- ", or an em-dash) -- the part of a verdict line that actually
    DECLARES the value, as opposed to a free-text reason that follows it.
    Quoting-artifact detection (`_is_clean_verdict_line`) only inspects
    this core, never the trailing reason."""
    m = _VERDICT_CORE_DELIMITER_RE.search(line)
    return line[: m.start()] if m else line


def _is_clean_verdict_line(line: str, pattern: "re.Pattern") -> bool:
    """True iff `line` opens with `pattern` (anchored at line start) and its
    CORE (see `_verdict_core`) contains none of the template/quoting
    artifacts (see `_QUOTING_ARTIFACT_RE`) that mark it as instructional
    text quoting the verdict format rather than a real, single-valued
    verdict."""
    if not pattern.match(line):
        return False
    return not _QUOTING_ARTIFACT_RE.search(_verdict_core(line))


def _is_verdict_text(text: str) -> bool:
    """True iff ``text`` (an assistant turn's full, untruncated text)
    contains a standalone SPEC verdict line and a standalone QUALITY
    verdict line -- neither a template/quoting artifact (see
    `_QUOTING_ARTIFACT_RE`) -- within `_VERDICT_ADJACENCY_LINES` of each
    other and within `_VERDICT_TRAILING_LINES` of the message's end. See
    the module-level comment for the false-positive this replaced (a
    reviewer's own brief-quoting text) and why trailing one-line reasons
    are still accepted."""
    if not text:
        return False
    lines = text.splitlines()
    n = len(lines)
    spec_idxs = [i for i, ln in enumerate(lines) if _is_clean_verdict_line(ln, _SPEC_LINE_RE)]
    if not spec_idxs:
        return False
    quality_idxs = [i for i, ln in enumerate(lines) if _is_clean_verdict_line(ln, _QUALITY_LINE_RE)]
    if not quality_idxs:
        return False
    trailing_cutoff = n - _VERDICT_TRAILING_LINES
    for i in spec_idxs:
        if i < trailing_cutoff:
            continue
        for j in quality_idxs:
            if j < trailing_cutoff:
                continue
            if abs(i - j) <= _VERDICT_ADJACENCY_LINES:
                return True
    return False


@dataclass
class TokenTotals:
    """Cumulative token counts for a session, with cost-ready, unambiguous
    semantics: ``input_tokens`` is every token billed at the full input
    rate; ``cached_tokens`` is cache-READ tokens only, billed at the
    discounted cached rate. Concretely:

    - codex: ``input_tokens = provider input_tokens - cached_input_tokens``,
      ``cached_tokens = cached_input_tokens``.
    - claude: ``input_tokens = uncached input_tokens + cache_creation_input_tokens``.
      Anthropic bills cache-creation tokens at ~1.25x the base input rate,
      not the full input rate exactly, but Task 6's cost model approximates
      cache creation at 1x for simplicity — so cache-creation tokens are
      folded into ``input_tokens`` here (not into ``cached_tokens``, which
      is reserved for the cheaper cache-READ rate) to match that
      approximation. ``cached_tokens = cache_read_input_tokens`` only.

    ``output_tokens``/``reasoning_tokens`` are as reported by the provider
    (claude does not surface a separate reasoning-token count, so it is
    always 0 there).
    """

    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0


@dataclass
class Turn:
    """One condensed turn: the tool calls/thinking/messages between two
    token-usage checkpoints (codex) or around one assistant API message
    (claude), plus the output/reasoning token delta charged to it.

    ``started_at``/``ended_at`` (followup-4, ``session_turns``) are the
    transcript timestamps of the first and last raw event folded into this
    turn -- for codex, the closing ``token_count`` event's own timestamp is
    ``ended_at`` (there is no later event that belongs to the turn); for
    claude, ``ended_at`` is the last event appended before the turn is
    flushed (NOT the timestamp of the *next* turn's opening event, which is
    what triggers the flush but isn't part of this turn). Both are ``None``
    only if the turn has no items at all (shouldn't happen in practice --
    a turn is only ever constructed from a non-empty ``items`` list).
    ``is_verdict`` (followup-4, review-boundary detection) is True iff this
    turn's own assistant text matched both verdict regexes (see
    ``_is_verdict_text``) -- only ever set on turns closed by an assistant
    SAY, never on the codex fallback trailing-turn-with-no-SAY case."""

    index: int
    output_tokens: int
    reasoning_tokens: int
    items: List[str] = field(default_factory=list)
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    is_verdict: bool = False


@dataclass
class SessionRecord:
    session_id: Optional[str]
    provider: str
    harness_entry: str
    model: Optional[str]
    effort: Optional[str]
    started_at: Optional[str]
    ended_at: Optional[str]
    prompt: Optional[str]
    tokens: TokenTotals
    peak_context: int
    n_compactions: int
    n_turns: int
    n_tool_calls: int
    turns: List[Turn]
    last_message: Optional[str]
    spawn_path: Optional[str] = None
    spawn_role: Optional[str] = None


def _iter_jsonl(path):
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _text_of(content):
    """Flatten an Anthropic-style content field (str or list-of-blocks) to text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def _call_snippet(arguments):
    """Best-effort extraction of a short command snippet from a codex
    function_call's JSON-encoded arguments."""
    try:
        args = json.loads(arguments or "{}")
    except (TypeError, json.JSONDecodeError):
        return str(arguments)[:_SNIPPET_LEN]
    cmd = args.get("command") if isinstance(args, dict) else None
    if isinstance(cmd, list):
        snippet = " ".join(str(c) for c in cmd)
    elif isinstance(cmd, str):
        snippet = cmd
    else:
        snippet = json.dumps(args)
    return snippet[:_SNIPPET_LEN]


# --------------------------------------------------------------------------
# codex
# --------------------------------------------------------------------------


def extract_codex(path) -> SessionRecord:
    """Parse a codex rollout JSONL file into a SessionRecord.

    **Silent-checkpoint reconciliation (followup-5, design.md D5/D2
    amendment).** A ``token_count`` checkpoint whose window produced no
    condensed timeline items (no intervening ``CALL``/``OUT``/``THINK``/
    ``SAY``) used to simply discard its ``last_token_usage`` delta -- it
    updated the session-level cumulative total (``final_totals``, read
    from ``total_token_usage``) but became no ``Turn`` at all, since a
    ``Turn`` was only ever appended ``if cur_items:``. Over a whole
    session this could drop a large fraction of the true output-token
    mass from the per-turn sum (see ``projects/agents/task-analyzer/
    README.md``'s former "known limitation" section for the empirical
    scale of this before the fix). Fixed here by accumulating every
    silent checkpoint's delta in ``pending_output_tokens``/
    ``pending_reasoning_tokens`` and folding it into the next turn that
    DOES get created -- never creating a new turn or changing any turn's
    index for a silent checkpoint. Three cases, one mechanism:

    - mass accrued before the first visible turn (e.g. history discarded
      by a context compaction) accumulates in `pending_*` from the start
      and is folded into turn 1, the first turn actually created;
    - a silent gap between two visible turns accumulates the same way and
      is folded into the NEXT visible turn (whose closing checkpoint is
      the first non-silent one after the gap);
    - trailing silent mass after the last visible turn (checkpoints that
      fire after all real content, before the transcript ends) has
      nothing left to fold forward into, so it's added to the LAST
      already-appended turn once the main loop ends.

    Post-condition: ``sum(t.output_tokens for t in turns) ==
    final_totals.output_tokens`` for any well-formed transcript with at
    least one turn (verified by ``tests/test_extractors.py``'s
    reconciliation tests, and empirically against the real committed
    corpus). A transcript with ZERO turns at all (only silent checkpoints,
    no content whatsoever) has no turn to fold pending mass into --the
    ``pending_output_tokens`` accumulator is simply discarded in that
    degenerate case, an explicit, documented, and tested exception, not a
    silent leak of a well-formed transcript's real turn data.

    **Delta source: the cumulative counter, not ``last_token_usage``.**
    Each checkpoint's own output/reasoning delta is computed as the
    increase in ``total_token_usage`` (the provider's cumulative counter)
    since the previous checkpoint, not read directly from
    ``last_token_usage`` -- verified monotonically non-decreasing across
    every session in the real corpus, this delta telescopes exactly to
    the session's final cumulative total by construction, closing two
    real gaps ``last_token_usage`` alone left open: (1) a resumed/
    continued (``thread_spawn``) session's file can begin with a large
    nonzero cumulative baseline already present at its very first
    checkpoint, reflecting activity from before this file's own recorded
    events start -- ``last_token_usage`` at that checkpoint only reports
    its own small window, silently losing the inherited baseline (folded
    in here as leading mass, same as any other pre-first-turn gap); (2) a
    small minority of checkpoints (also `thread_spawn`-only in the real
    corpus) report a ``last_token_usage`` delta that doesn't match the
    cumulative counter's own actual step for that checkpoint (a data-
    quality quirk in a handful of thread-spawned sessions' own event
    reporting) -- the cumulative-counter delta is authoritative here, not
    the possibly-inconsistent per-checkpoint delta. Falls back to
    ``last_token_usage`` only when a ``token_count`` event lacks
    ``total_token_usage`` entirely (rare/degenerate).
    """
    session_id = None
    harness_entry = "exec"
    spawn_path = None
    spawn_role = None
    model = None
    effort = None
    started_at = None
    ended_at = None
    prompt = None
    last_message = None
    peak_context = 0
    n_compactions = 0
    n_tool_calls = 0
    final_totals = TokenTotals()
    prev_cumulative_output = 0
    prev_cumulative_reasoning = 0

    turns: List[Turn] = []
    cur_items: List[str] = []
    cur_turn_start: Optional[str] = None
    cur_turn_end: Optional[str] = None
    cur_turn_is_verdict = False
    pending_output_tokens = 0
    pending_reasoning_tokens = 0

    def _note(ts):
        """Record `ts` as covering the in-progress turn: the first call
        since the last flush sets `cur_turn_start`; every call updates
        `cur_turn_end`, so it ends up as the last-noted event's timestamp."""
        nonlocal cur_turn_start, cur_turn_end
        if ts:
            if cur_turn_start is None:
                cur_turn_start = ts
            cur_turn_end = ts

    for e in _iter_jsonl(path):
        ts = e.get("timestamp")
        if ts:
            ended_at = ts
            started_at = started_at or ts

        t = e.get("type")
        p = e.get("payload") or {}

        if t == "session_meta":
            session_id = p.get("id") or session_id
            source = p.get("source")
            if isinstance(source, dict):
                harness_entry = "thread_spawn"
                try:
                    spawn = source["subagent"]["thread_spawn"]
                    spawn_path = spawn.get("agent_path")
                    spawn_role = spawn.get("agent_role")
                except (KeyError, TypeError, AttributeError):
                    pass
            elif source:
                harness_entry = str(source)

        elif t == "turn_context":
            model = p.get("model") or model
            effort = p.get("effort") or effort

        elif t == "event_msg":
            pt = p.get("type")
            if pt == "token_count":
                info = p.get("info") or {}
                total = info.get("total_token_usage") or {}
                last = info.get("last_token_usage") or {}
                if total:
                    total_cached = total.get("cached_input_tokens") or 0
                    final_totals = TokenTotals(
                        input_tokens=(total.get("input_tokens") or 0) - total_cached,
                        cached_tokens=total_cached,
                        output_tokens=total.get("output_tokens") or 0,
                        reasoning_tokens=total.get("reasoning_output_tokens") or 0,
                    )
                ctx = (last.get("input_tokens") or 0) + (last.get("output_tokens") or 0)
                peak_context = max(peak_context, ctx)
                # Delta source: the cumulative counter's own step, not
                # last_token_usage (followup-5 reconciliation) -- see this
                # function's docstring. Falls back to last_token_usage
                # only if this event has no total_token_usage at all.
                delta_output = last.get("output_tokens") or 0
                delta_reasoning = last.get("reasoning_output_tokens") or 0
                if total:
                    cur_cumulative_output = total.get("output_tokens") or 0
                    cur_cumulative_reasoning = total.get("reasoning_output_tokens") or 0
                    reconciled_output = cur_cumulative_output - prev_cumulative_output
                    reconciled_reasoning = cur_cumulative_reasoning - prev_cumulative_reasoning
                    if reconciled_output >= 0:
                        delta_output = reconciled_output
                    if reconciled_reasoning >= 0:
                        delta_reasoning = reconciled_reasoning
                    prev_cumulative_output = cur_cumulative_output
                    prev_cumulative_reasoning = cur_cumulative_reasoning
                if cur_items:
                    # This checkpoint's window has real content -- fold in
                    # any mass silent checkpoints before it accumulated
                    # (followup-5 reconciliation), never discarding it.
                    turns.append(
                        Turn(
                            index=len(turns) + 1,
                            output_tokens=pending_output_tokens + delta_output,
                            reasoning_tokens=pending_reasoning_tokens + delta_reasoning,
                            items=cur_items,
                            started_at=cur_turn_start,
                            ended_at=ts or cur_turn_end,
                            is_verdict=cur_turn_is_verdict,
                        )
                    )
                    cur_items = []
                    cur_turn_start = None
                    cur_turn_end = None
                    cur_turn_is_verdict = False
                    pending_output_tokens = 0
                    pending_reasoning_tokens = 0
                else:
                    # Silent checkpoint: no content, but a real delta --
                    # accumulate it for the next turn that does get
                    # created (or, if none does, the trailing-mass fold
                    # after the main loop below).
                    pending_output_tokens += delta_output
                    pending_reasoning_tokens += delta_reasoning
            elif pt == "user_message":
                msg = p.get("message") or ""
                if "Session initialization only" in msg:
                    continue
                if prompt is None:
                    prompt = msg
                else:
                    cur_items.append(f"USER: {msg[:_SNIPPET_LEN]}")
                    _note(ts)
            elif pt == "agent_message":
                last_message = p.get("message") or last_message
            elif pt in COMPACT_TYPES:
                n_compactions += 1
                cur_items.append("[CONTEXT COMPACTION]")
                _note(ts)

        elif t == "response_item":
            pt = p.get("type")
            if pt == "function_call":
                n_tool_calls += 1
                name = p.get("name")
                snippet = _call_snippet(p.get("arguments"))
                cur_items.append(f"CALL {name}: {snippet}")
                _note(ts)
            elif pt == "function_call_output":
                out = p.get("output")
                if isinstance(out, dict):
                    out = out.get("content") or ""
                cur_items.append(f"OUT: {str(out)[:_SNIPPET_LEN]}")
                _note(ts)
            elif pt == "reasoning":
                txt = "".join(
                    s.get("text", "") for s in (p.get("summary") or []) if isinstance(s, dict)
                )
                if txt:
                    cur_items.append(f"THINK: {txt[:_SNIPPET_LEN]}")
                    _note(ts)
            elif pt == "message" and p.get("role") == "assistant":
                txt = "".join(
                    c.get("text", "") for c in (p.get("content") or []) if isinstance(c, dict)
                )
                if txt:
                    cur_items.append(f"SAY: {txt[:_MESSAGE_LEN]}")
                    _note(ts)
                    if _is_verdict_text(txt):
                        cur_turn_is_verdict = True

        elif t in COMPACT_TYPES:
            n_compactions += 1
            cur_items.append("[CONTEXT COMPACTION]")
            _note(ts)

    if cur_items:
        # A final, dangling turn with no closing token_count checkpoint of
        # its own (no last_token_usage delta to attribute to it) -- but
        # any EARLIER silent-checkpoint mass still accumulated in
        # `pending_*` folds forward into it, per the same "next visible
        # turn" rule as any other gap (followup-5 reconciliation).
        turns.append(
            Turn(
                index=len(turns) + 1, output_tokens=pending_output_tokens,
                reasoning_tokens=pending_reasoning_tokens, items=cur_items,
                started_at=cur_turn_start, ended_at=cur_turn_end or ended_at,
                is_verdict=cur_turn_is_verdict,
            )
        )
        pending_output_tokens = 0
        pending_reasoning_tokens = 0
    elif turns and (pending_output_tokens or pending_reasoning_tokens):
        # Trailing silent mass: checkpoints fired after the last visible
        # turn closed, with no further content before the transcript
        # ends -- nothing to fold FORWARD into, so it folds into the LAST
        # turn instead (followup-5 reconciliation, "trailing" case).
        last_turn = turns[-1]
        turns[-1] = Turn(
            index=last_turn.index,
            output_tokens=last_turn.output_tokens + pending_output_tokens,
            reasoning_tokens=last_turn.reasoning_tokens + pending_reasoning_tokens,
            items=last_turn.items,
            started_at=last_turn.started_at,
            ended_at=last_turn.ended_at,
            is_verdict=last_turn.is_verdict,
        )
        pending_output_tokens = 0
        pending_reasoning_tokens = 0
    # else: turns is empty and pending mass (if any) has nowhere to fold
    # into -- a genuinely turn-less transcript (only silent checkpoints,
    # no content at all). Explicit, documented exception (see this
    # function's docstring), not a silent leak of real turn data.

    return SessionRecord(
        session_id=session_id,
        provider="codex",
        harness_entry=harness_entry,
        model=model,
        effort=effort,
        started_at=started_at,
        ended_at=ended_at,
        prompt=prompt,
        tokens=final_totals,
        peak_context=peak_context,
        n_compactions=n_compactions,
        n_turns=len(turns),
        n_tool_calls=n_tool_calls,
        turns=turns,
        last_message=last_message,
        spawn_path=spawn_path,
        spawn_role=spawn_role,
    )


# --------------------------------------------------------------------------
# claude
# --------------------------------------------------------------------------


def extract_claude(path) -> SessionRecord:
    """Parse a Claude Code project transcript (top-level session or
    subagent) JSONL file into a SessionRecord.

    **Silent-checkpoint reconciliation (followup-5, design.md D5/D2
    amendment).** An assistant message whose content produced no condensed
    timeline items (no ``SAY``/``THINK``/``CALL`` -- e.g. an empty or
    all-whitespace response) used to have its own ``output_tokens`` folded
    into the session-level running total but discarded from every turn,
    since ``flush()`` only ever appended a ``Turn`` ``if cur_items:``.
    Fixed the same way as ``extract_codex``: a `pending_output_tokens`
    accumulator carries a silent message's tokens forward until the next
    turn that DOES get created (leading/gap cases), or, if none does
    before the transcript ends, folds into the last turn already created
    (trailing case) -- never creating a new turn or renumbering any
    existing one. See ``extract_codex``'s docstring for the full
    three-case rationale (identical here, just triggered by an empty
    assistant message instead of a checkpoint with no intervening
    content)."""
    session_id = None
    is_subagent = "/subagents/" in str(path).replace(os.sep, "/")
    model = None
    started_at = None
    ended_at = None
    prompt = None
    last_message = None
    peak_context = 0
    n_compactions = 0
    n_tool_calls = 0
    input_tokens = 0
    cached_tokens = 0
    output_tokens = 0

    turns: List[Turn] = []
    cur_items: List[str] = []
    cur_output_tokens = 0
    cur_turn_start: Optional[str] = None
    cur_turn_end: Optional[str] = None
    cur_turn_is_verdict = False
    pending_output_tokens = 0

    def flush():
        nonlocal cur_items, cur_output_tokens, cur_turn_start, cur_turn_end, cur_turn_is_verdict, pending_output_tokens
        if cur_items:
            # Real content -- fold in any mass a preceding silent message
            # accumulated (followup-5 reconciliation), never discarding it.
            turns.append(
                Turn(
                    index=len(turns) + 1,
                    output_tokens=cur_output_tokens + pending_output_tokens,
                    reasoning_tokens=0,
                    items=cur_items,
                    started_at=cur_turn_start,
                    ended_at=cur_turn_end,
                    is_verdict=cur_turn_is_verdict,
                )
            )
            pending_output_tokens = 0
        else:
            # Silent message (no items) -- accumulate its own tokens for
            # the next turn that does get created (or the trailing-mass
            # fold after the main loop, if none does).
            pending_output_tokens += cur_output_tokens
        cur_items = []
        cur_output_tokens = 0
        cur_turn_start = None
        cur_turn_end = None
        cur_turn_is_verdict = False

    def _note(ts):
        nonlocal cur_turn_start, cur_turn_end
        if ts:
            if cur_turn_start is None:
                cur_turn_start = ts
            cur_turn_end = ts

    for e in _iter_jsonl(path):
        ts = e.get("timestamp")
        if ts:
            ended_at = ts
            started_at = started_at or ts
        if e.get("sessionId") and session_id is None:
            session_id = e.get("sessionId")
        if e.get("agentId") is not None:
            is_subagent = True

        if e.get("isCompactSummary"):
            n_compactions += 1
            cur_items.append("[CONTEXT COMPACTION]")
            _note(ts)

        t = e.get("type")
        if t == "user":
            m = e.get("message") or {}
            txt = _text_of(m.get("content"))
            if txt.strip():
                if e.get("isCompactSummary"):
                    pass
                elif prompt is None:
                    prompt = txt
                else:
                    flush()
                    cur_items.append(f"USER: {txt[:_SNIPPET_LEN]}")
                    _note(ts)
            cont = m.get("content")
            if isinstance(cont, list):
                for x in cont:
                    if isinstance(x, dict) and x.get("type") == "tool_result":
                        s = x.get("content")
                        s = _text_of(s) if not isinstance(s, str) else s
                        cur_items.append(f"OUT: {str(s)[:_SNIPPET_LEN]}")
                        _note(ts)

        elif t == "assistant":
            flush()
            m = e.get("message") or {}
            model = m.get("model") or model
            u = m.get("usage") or {}
            inp = u.get("input_tokens") or 0
            cr = u.get("cache_read_input_tokens") or 0
            cc = u.get("cache_creation_input_tokens") or 0
            out = u.get("output_tokens") or 0
            input_tokens += inp + cc
            cached_tokens += cr
            output_tokens += out
            cur_output_tokens = out
            peak_context = max(peak_context, inp + cr + cc + out)
            for x in m.get("content") or []:
                if not isinstance(x, dict):
                    continue
                xt = x.get("type")
                if xt == "text" and x.get("text", "").strip():
                    last_message = x["text"]
                    cur_items.append(f"SAY: {x['text'][:_MESSAGE_LEN]}")
                    _note(ts)
                    if _is_verdict_text(x["text"]):
                        cur_turn_is_verdict = True
                elif xt == "thinking" and x.get("thinking", "").strip():
                    cur_items.append(f"THINK: {x['thinking'][:_SNIPPET_LEN]}")
                    _note(ts)
                elif xt == "tool_use":
                    n_tool_calls += 1
                    name = x.get("name")
                    args = x.get("input") or {}
                    snippet = (
                        args.get("command")
                        or args.get("file_path")
                        or args.get("pattern")
                        or json.dumps(args)
                    )
                    cur_items.append(f"CALL {name}: {str(snippet)[:_SNIPPET_LEN]}")
                    _note(ts)

    flush()
    if turns and pending_output_tokens:
        # Trailing silent mass: one or more silent assistant messages
        # after the last visible turn closed, with no further real
        # content before the transcript ends -- nothing to fold FORWARD
        # into, so it folds into the LAST turn instead (followup-5
        # reconciliation, "trailing" case).
        last_turn = turns[-1]
        turns[-1] = Turn(
            index=last_turn.index,
            output_tokens=last_turn.output_tokens + pending_output_tokens,
            reasoning_tokens=last_turn.reasoning_tokens,
            items=last_turn.items,
            started_at=last_turn.started_at,
            ended_at=last_turn.ended_at,
            is_verdict=last_turn.is_verdict,
        )
        pending_output_tokens = 0
    # else: turns is empty and pending mass (if any) has nowhere to fold
    # into -- a genuinely turn-less transcript. Explicit, documented
    # exception (see this function's docstring), not a silent leak.

    if is_subagent or session_id is None:
        base = os.path.basename(str(path))
        if base.endswith(".jsonl"):
            base = base[: -len(".jsonl")]
        session_id = base

    return SessionRecord(
        session_id=session_id,
        provider="claude",
        harness_entry="subagent" if is_subagent else "main",
        model=model,
        effort=None,
        started_at=started_at,
        ended_at=ended_at,
        prompt=prompt,
        tokens=TokenTotals(
            input_tokens=input_tokens,
            cached_tokens=cached_tokens,
            output_tokens=output_tokens,
            reasoning_tokens=0,
        ),
        peak_context=peak_context,
        n_compactions=n_compactions,
        n_turns=len(turns),
        n_tool_calls=n_tool_calls,
        turns=turns,
        last_message=last_message,
    )


# --------------------------------------------------------------------------
# timeline rendering
# --------------------------------------------------------------------------


def render_timeline(rec: SessionRecord) -> str:
    """Render a SessionRecord as the condensed markdown timeline used for
    LLM-driven phase labeling: one ``## Turn N`` section per turn, with a
    bulleted line per condensed item."""
    lines = [
        f"# {rec.provider} session {rec.session_id}",
        f"model: {rec.model}/{rec.effort}  harness_entry: {rec.harness_entry}",
        "",
        "## Prompt (truncated)",
        (rec.prompt or "")[:2500],
        "",
    ]
    for turn in rec.turns:
        lines.append(
            f"## Turn {turn.index}  (output_tokens={turn.output_tokens}, "
            f"reasoning_tokens={turn.reasoning_tokens})"
        )
        for item in turn.items:
            if item.startswith("OUT:"):
                lines.append(f"  {item}")
            else:
                lines.append(f"- {item}")
        lines.append("")
    return "\n".join(lines)
