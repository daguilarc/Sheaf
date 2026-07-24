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

# Verdict-turn detection (followup-4, design.md D5 amendment): a reviewer
# turn whose assistant text contains BOTH a "SPEC: PASS/FAIL" line and a
# "QUALITY: ..." line is a genuine review verdict, not incidental prose that
# happens to mention "spec" or "quality" separately. The QUALITY alternation
# is deliberately permissive -- real transcripts (grepped from
# analysis/sdd-model-analysis/data/*.json and ~/.codex/sessions) use
# APPROVE(D), NEEDS-FIXES, PASS, FAIL, and REVISE across different rubric
# iterations, not one fixed vocabulary. Checked against the FULL (untruncated)
# assistant text at extraction time, never the condensed/truncated `SAY:`
# timeline snippet (_MESSAGE_LEN=600) a long review response's verdict lines
# -- conventionally at the very END, per every reviewer prompt's "End with
# EXACTLY: ..." instruction -- would frequently fall outside of.
_SPEC_VERDICT_RE = re.compile(r"\bSPEC:\s*(PASS|FAIL)\b", re.I)
_QUALITY_VERDICT_RE = re.compile(r"\bQUALITY:\s*(APPROVE[D]?|NEEDS[- ]FIXES|PASS|FAIL|REVISE)\b", re.I)


def _is_verdict_text(text: str) -> bool:
    """True iff ``text`` (an assistant turn's full, untruncated text)
    contains both a SPEC and a QUALITY verdict line -- see the module-level
    regex comments for why both are required and why the alternation is
    this permissive."""
    if not text:
        return False
    return bool(_SPEC_VERDICT_RE.search(text) and _QUALITY_VERDICT_RE.search(text))


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
    """Parse a codex rollout JSONL file into a SessionRecord."""
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

    turns: List[Turn] = []
    cur_items: List[str] = []
    cur_turn_start: Optional[str] = None
    cur_turn_end: Optional[str] = None
    cur_turn_is_verdict = False

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
                if cur_items:
                    turns.append(
                        Turn(
                            index=len(turns) + 1,
                            output_tokens=last.get("output_tokens") or 0,
                            reasoning_tokens=last.get("reasoning_output_tokens") or 0,
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
        turns.append(
            Turn(
                index=len(turns) + 1, output_tokens=0, reasoning_tokens=0, items=cur_items,
                started_at=cur_turn_start, ended_at=cur_turn_end or ended_at,
                is_verdict=cur_turn_is_verdict,
            )
        )

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
    subagent) JSONL file into a SessionRecord."""
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

    def flush():
        nonlocal cur_items, cur_output_tokens, cur_turn_start, cur_turn_end, cur_turn_is_verdict
        if cur_items:
            turns.append(
                Turn(
                    index=len(turns) + 1,
                    output_tokens=cur_output_tokens,
                    reasoning_tokens=0,
                    items=cur_items,
                    started_at=cur_turn_start,
                    ended_at=cur_turn_end,
                    is_verdict=cur_turn_is_verdict,
                )
            )
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
