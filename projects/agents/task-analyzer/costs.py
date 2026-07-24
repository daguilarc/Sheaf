"""Deterministic derived-cost rebuild for the SDD task-analyzer pipeline
(design.md D5; ``openspec/changes/add-sdd-task-analyzer/design.md``).

``rebuild(conn)`` is the entire public surface: a full, idempotent recompute
of the two *derived* tables (``task_costs``, ``task_arms``) from the *raw*
and *agentic* tables (``sessions``, ``phase_tokens``, ``model_prices``) --
never the reverse. It touches no other table; in particular it never writes
``complexity``/``grades``/``phase_tokens``/``sessions`` (those are the
agentic/raw layers Tasks 3-5 own).

Token/cost semantics (design.md D5):

- A session's dollar cost is ``input_tokens*p_in + cached_tokens*p_cached +
  output_tokens*p_out`` (prices per the ``model_prices`` schema, which are
  USD per *million* tokens), using the newest ``model_prices`` row for that
  session's ``model`` whose ``effective_date`` is on or before "today";
  that row's ``effective_date`` is the session's price version. A session
  whose model has no matching price row at all contributes to no category
  (it cannot be costed) -- this is a data-completeness gap, not a crash.
- Round-0 (``review_round == 0``) ``implementer`` sessions have their dollar
  cost apportioned across the 10 TDD phases by each phase's share of that
  session's own ``output_tokens`` (at the *current* taxonomy version -- the
  numerically greatest ``taxonomy_version`` present in ``phase_tokens``,
  unless ``taxonomy_version=`` overrides it) -- **not** the sum of the
  session's phase-label rows, since a session can be only partially
  labeled. Whatever share of the session's output isn't covered by any
  phase label instead funds ``unlabeled``, so a session's category totals
  always sum back to its full session usd. A round-0 implementer session
  with no phase-label rows at all funds ``unlabeled`` entirely.

  **Spanning-session split (design.md D5 amendment, followup-4).** The
  workflow now deliberately keeps a round-0 implementer session open across
  fix/re-review rounds, so a "round-0" session can still contain turns
  performed strictly *after* the task's first review verdict -- those turns
  are fix work, not implementation, and must fund ``followup_fix``, not the
  phase categories, even though the session's own ``review_round`` column
  stays 0 (design D5: round is a session-*start*-time property, unchanged).
  For a round-0 session WITH ``session_turns`` rows, its turns are
  partitioned at the task's first review boundary (the union of every
  reviewer session's detected verdict-turn timestamps, or their ``ended_at``
  fallback -- ``discovery.review_boundaries``): turns starting strictly
  after it form the *fix partition*, funding ``followup_fix`` at
  ``output_tokens`` (weighted_tokens) and a proportional
  ``session_usd * fix_output_tokens / total_turn_output_tokens`` (the same
  "apportion by output_tokens share of session usd" convention the phase
  split already uses -- turn_phases/turn text has no separate input/cached
  token breakdown to cost more precisely than that). The remaining
  pre-boundary turns fund the phase categories: if ``turn_phases`` rows
  exist for this session at the current taxonomy version, phase shares are
  computed directly from just the pre-boundary turns' own labels (residual
  pre-boundary output not covered by any label funds ``unlabeled``, same
  residual rule as always); otherwise (a backfilled session whose per-turn
  labels didn't survive, only the aggregated ``phase_tokens`` did) each
  existing ``phase_tokens`` share is *scaled* by
  ``pre_boundary_output_tokens / total_turn_output_tokens`` -- less precise
  (it assumes phase proportions are uniform across the session's turns,
  which the fix partition may violate) but still exact on the sum-preserving
  invariant, since the scale factor is defined so pre-boundary + fix-
  partition shares add back to exactly the full session usd. A round-0
  session WITHOUT ``session_turns`` rows (not yet backfilled, or
  unrecoverable -- ``ingest.py backfill-turns``) uses the original,
  session-level apportionment unchanged, with no fix-partition split at
  all -- this is a real, documented approximation for such sessions, not a
  bug: the split can only ever be as good as the per-turn data available.

  **Turn coverage and category-attribution accuracy (fix-round-2 review).**
  The split above always allocates the session's FULL usd -- ``fix_share``
  and ``pre_share`` are defined so they sum to exactly 1, by construction,
  regardless of how much of the session's real activity ``session_turns``
  actually captures. This is exact ONLY when ``total_turn_output_tokens``
  (the sum of this session's ``session_turns.output_tokens``) equals the
  session's own ``output_tokens`` -- 100% *turn coverage*. When it's less
  (a real, documented gap in ``extractors.py``'s turn-splitting -- see
  ``projects/agents/task-analyzer/README.md``'s "known limitation" section;
  as of the 2026-07 real dataset, ALL 11 sessions that actually span a
  review boundary have coverage below 100%, some well below), the *missing*
  turn-delta mass is implicitly distributed pro-rata across BOTH the fix
  and phase partitions in whatever ratio the OBSERVED (covered) turns
  happen to reflect -- e.g. at 60% coverage, a fix/phase split computed
  from the visible 60% of turns is assumed representative of the missing
  40%, which may not hold. Fix-round-1's report characterized this as
  "diagnostic only" (affecting only the ``weighted_tokens`` sanity-check
  column) -- that was **incorrect** for spanning sessions specifically: the
  missing mass changes the actual USD split between ``followup_fix`` and
  the phase categories, not just the reported token count. What remains
  true: the TOTAL usd across all of a task's categories is still exactly
  preserved (nothing is lost or double-counted at the task level -- only
  redistributed, in proportion to coverage, between followup_fix and the
  phase categories for split sessions specifically). ``rebuild()`` computes
  each split session's coverage ratio and surfaces it two ways: on the
  returned ``RebuildResult.spanning_session_coverage`` (session_id ->
  ratio, every actually-split session, not just low ones), and as a
  stderr ``WARN`` for any session below ``coverage_warn_threshold``
  (default ``DEFAULT_COVERAGE_WARN_THRESHOLD = 0.9``) -- no attribution
  redesign, purely observability: callers/analysts can see exactly which
  sessions' fix/phase split is trustworthy and which isn't.
- ``reviewer``/``auditor`` sessions (any round) fund ``review``.
- ``fixer`` sessions (any round) and ``implementer`` sessions with
  ``review_round >= 1`` fund ``followup_fix`` -- no phase apportionment.
- Sessions with any other role (``other``, or anything not in the four
  above) are not part of D5's cost model and fund nothing; this only
  matters for the rare session that joined a task but classified as
  ``other`` (see discovery.classify_role).
- Sessions with ``task_id IS NULL`` (quarantined) are never visited here at
  all: the driving query is keyed off ``sessions.task_id``, so a
  quarantined session funds nothing by construction.

``task_costs.weighted_tokens`` records the actual output-token count backing
each category (per phase, exactly that phase's ``phase_tokens.output_tokens``;
for ``unlabeled``/``review``/``followup_fix``, the summed ``output_tokens``
of the contributing sessions) -- so it doubles as a sanity-check figure
independent of price. ``task_costs.price_version`` is the *newest* of the
effective_dates that funded that category's total (a category can span
sessions on different models/arms, hence different price rows; recording
the newest keeps the field meaningful as "at least this fresh").

``task_arms`` (one row per task with any sessions) is (re)written via
``discovery.canonical_arm`` over the task's joined sessions, reusing the
already-persisted ``sessions.review_round`` (set once, deterministically, by
``ingest.py`` at join time) rather than re-deriving rounds from timestamps
here -- the two must agree by construction since both ultimately come from
the same ``assign_review_rounds`` mechanics, but re-reading the stored
column avoids a second, redundant derivation.

Stdlib only.
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import db
import discovery

# The 10 TDD phase categories (rubrics/phase-taxonomy.md) plus the two legal
# non-phase round-0 outcomes are not enumerated here as a closed set --
# `phase_tokens.phase` values are trusted verbatim as category names, and
# `unlabeled` is added only when a round-0 session has no phase rows at all.

# fix-round-2 review: a spanning-session split's fix/phase category
# attribution is only as trustworthy as its turn coverage (see the module
# docstring's "Turn coverage and category-attribution accuracy" section).
# Below this ratio, rebuild() prints a loud WARN naming the session so the
# gap isn't silently invisible to anyone who doesn't inspect
# RebuildResult.spanning_session_coverage directly.
DEFAULT_COVERAGE_WARN_THRESHOLD = 0.9


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _version_int(v) -> int:
    """Same convention as ingest.py's ``_version_int``: versions are integer
    strings compared numerically (design.md: "the row with the numerically
    greatest version" is current), never lexicographically. Duplicated here
    (rather than imported from ingest.py) to avoid a circular import --
    ingest.py imports this module to wire up the ``rebuild-derived``
    subcommand."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return -1


def _current_taxonomy_version(conn) -> Optional[str]:
    """The numerically greatest ``taxonomy_version`` present in
    ``phase_tokens``, or None if the table is empty (in which case every
    round-0 session simply falls back to ``unlabeled`` -- the ``= ?``
    comparison against a None parameter matches no phase_tokens rows)."""
    rows = conn.execute("SELECT DISTINCT taxonomy_version FROM phase_tokens").fetchall()
    if not rows:
        return None
    return max((r[0] for r in rows), key=_version_int)


def _price_row(conn, model: str, as_of: str):
    return conn.execute(
        "SELECT effective_date, usd_per_m_input, usd_per_m_cached, usd_per_m_output "
        "FROM model_prices WHERE model = ? AND effective_date <= ? "
        "ORDER BY effective_date DESC LIMIT 1",
        (model, as_of),
    ).fetchone()


def _session_usd(conn, session, as_of: str, price_cache: Dict[str, Any]) -> Tuple[Optional[float], Optional[str]]:
    """(usd, price_version) for one session's full token bill, or (None,
    None) if its model has no price row on or before ``as_of``.

    Looks up ``model_prices`` under the session's *canonical* model name
    (``db.canonical_model`` -- e.g. a dated provider variant like
    ``claude-haiku-4-5-20251001`` normalized to the priced row
    ``claude-haiku-4-5``), not the raw ``sessions.model`` string, so a
    provider reporting a new dated/suffixed variant of an already-priced
    model doesn't silently drop every session using it."""
    model = db.canonical_model(session["model"])
    if model not in price_cache:
        price_cache[model] = _price_row(conn, model, as_of)
    price = price_cache[model]
    if price is None:
        return None, None
    input_tokens = session["input_tokens"] or 0
    cached_tokens = session["cached_tokens"] or 0
    output_tokens = session["output_tokens"] or 0
    usd = (
        input_tokens * price["usd_per_m_input"]
        + cached_tokens * price["usd_per_m_cached"]
        + output_tokens * price["usd_per_m_output"]
    ) / 1_000_000.0
    return usd, price["effective_date"]


def _accumulate(buckets: Dict[str, Dict[str, Any]], category: str, tokens: float, usd: float, price_version: Optional[str]) -> None:
    bucket = buckets.setdefault(category, {"weighted_tokens": 0.0, "usd": 0.0, "price_versions": set()})
    bucket["weighted_tokens"] += tokens
    bucket["usd"] += usd
    if price_version is not None:
        bucket["price_versions"].add(price_version)


class RebuildResult(int):
    """``rebuild()``'s return value: behaves exactly like the plain
    row-count ``int`` it always returned (every existing caller/test uses
    or compares it as one -- ``json.dumps``, ``==``, arithmetic all work
    unchanged), but also carries ``unpriced_models``: the set of raw
    ``sessions.model`` values that funded *no* cost category this rebuild
    because no ``model_prices`` row (after alias normalization) matched
    them as of the run's ``as_of`` date, restricted to sessions that
    actually had nonzero token counts (a zero-token session contributes
    $0 regardless of pricing, so an unresolved model on one isn't a real
    "dollars silently dropped" gap worth flagging).

    ``rebuild()`` also prints one ``WARN`` line per unpriced model to
    stderr, so the common CLI path (``ingest.py rebuild-derived``)
    surfaces the gap even when nothing inspects the return value -- see
    the module docstring's "this is a data-completeness gap, not a
    crash": that's still true, but it must not be a *silent* one.

    ``spanning_session_coverage`` (fix-round-2 review) is ``{session_id:
    ratio}`` for every round-0 implementer session this rebuild actually
    split at a review boundary (design.md D5 amendment's spanning-session
    split) -- ``ratio = sum(session_turns.output_tokens) /
    sessions.output_tokens`` for that session, i.e. how much of its real
    activity the turn-level split's fix/phase allocation is actually based
    on. 1.0 means the split is exact; anything less means the missing
    delta mass was implicitly distributed pro-rata across both partitions
    (see the module docstring). A session below
    ``coverage_warn_threshold`` also gets one ``WARN`` line on stderr,
    naming it and its ratio."""

    def __new__(cls, rows_written: int, unpriced_models, spanning_session_coverage=None):
        obj = int.__new__(cls, rows_written)
        obj.unpriced_models = frozenset(unpriced_models)
        obj.spanning_session_coverage = dict(spanning_session_coverage or {})
        return obj


def _task_ids_with_sessions(conn):
    return [
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT task_id FROM sessions WHERE task_id IS NOT NULL"
        ).fetchall()
    ]


def _session_dicts_with_verdict_boundaries(sessions) -> List[dict]:
    """Plain dicts for `sessions` (``sqlite3.Row`` objects) with
    ``verdict_boundaries_json`` parsed into a ``verdict_boundaries`` list --
    the shape ``discovery.py``'s ``SessionLike`` protocol expects
    (design.md D5 amendment, followup-4). Used for both
    ``discovery.canonical_arm`` (which internally re-derives rounds via
    ``assign_review_rounds``) and ``discovery.review_boundaries`` (this
    module's own use, for the spanning-session split below)."""
    out = []
    for s in sessions:
        d = dict(s)
        vb_json = d.get("verdict_boundaries_json")
        d["verdict_boundaries"] = json.loads(vb_json) if vb_json else []
        out.append(d)
    return out


def _session_turns(conn, session_id: str):
    return conn.execute(
        "SELECT turn_idx, started_at, output_tokens FROM session_turns "
        "WHERE session_id = ? ORDER BY turn_idx",
        (session_id,),
    ).fetchall()


def _phase_shares(conn, session_id: str, output_tokens: float, usd: float, taxonomy_version) -> Dict[str, Tuple[float, float]]:
    """``{category: (tokens, category_usd)}`` for one round-0 session's
    full, unsplit phase apportionment against its OWN ``phase_tokens`` rows
    -- the original (pre-followup-4) per-session apportionment logic,
    factored out so both the unsplit path and the followup-4 scaled-
    fallback split path (``_apportion_round0_session``) share one
    implementation. The returned shares always sum to exactly
    ``(output_tokens, usd)`` -- the sum-preserving invariant this module's
    docstring describes."""
    phases = conn.execute(
        "SELECT phase, output_tokens FROM phase_tokens WHERE session_id = ? AND taxonomy_version = ?",
        (session_id, taxonomy_version),
    ).fetchall()
    shares: Dict[str, Tuple[float, float]] = {}
    if not phases or output_tokens <= 0:
        shares["unlabeled"] = (output_tokens, usd)
        return shares
    labeled_tokens = 0
    for p in phases:
        phase_tokens = p["output_tokens"] or 0
        labeled_tokens += phase_tokens
        share = phase_tokens / output_tokens
        shares[p["phase"]] = (phase_tokens, usd * share)
    residual_tokens = output_tokens - labeled_tokens
    if residual_tokens > 0:
        residual_share = residual_tokens / output_tokens
        shares["unlabeled"] = (residual_tokens, usd * residual_share)
    return shares


def _apportion_phases(conn, buckets, session_id: str, output_tokens: float, usd: float, price_version, taxonomy_version) -> None:
    """The original (pre-followup-4) round-0 implementer apportionment:
    dollar cost divided across this session's own ``phase_tokens`` rows by
    output-token share, residual funding ``unlabeled``. Used directly for
    sessions with no ``session_turns`` rows, or no task review boundary
    yet -- the spanning-session split (below) has nothing to split against
    in either case, so this stays the whole story for them."""
    for category, (tokens, cat_usd) in _phase_shares(conn, session_id, output_tokens, usd, taxonomy_version).items():
        _accumulate(buckets, category, tokens, cat_usd, price_version)


def _apportion_round0_session(
    conn, buckets, session_id: str, output_tokens: float, usd: float, price_version, taxonomy_version, first_boundary: str,
    coverage_report: Optional[Dict[str, float]] = None,
) -> None:
    """Round-0 implementer apportionment WITH the task's first review
    boundary known (design.md D5 amendment, followup-4): partitions this
    session's ``session_turns`` at ``first_boundary`` and funds
    ``followup_fix`` from the post-boundary (fix) partition, phases from
    the pre-boundary partition. Falls back to the unsplit
    ``_apportion_phases`` if this session has no ``session_turns`` rows at
    all, or if every turn is pre-boundary (nothing to split off).

    When an actual split happens (a fix partition exists), and
    ``coverage_report`` is given, records this session's *turn coverage*
    (``total_turn_output_tokens / output_tokens`` -- see the module
    docstring's "Turn coverage and category-attribution accuracy",
    fix-round-2 review) under ``coverage_report[session_id]``. Not
    recorded when no split occurs (nothing to be inexact about)."""
    turns = _session_turns(conn, session_id)
    if not turns:
        _apportion_phases(conn, buckets, session_id, output_tokens, usd, price_version, taxonomy_version)
        return

    # Parsed-datetime comparison, never raw string comparison (fix-round-1
    # review, finding 3) -- see discovery.parse_timestamp's docstring for
    # why string comparison of ISO timestamps is unsafe across providers/
    # fractional-second precision.
    first_boundary_dt = discovery.parse_timestamp(first_boundary)
    total_turn_output_tokens = sum(t["output_tokens"] or 0 for t in turns)
    fix_turn_idx = {
        t["turn_idx"] for t in turns
        if t["started_at"] and discovery.parse_timestamp(t["started_at"]) > first_boundary_dt
    }
    fix_output_tokens = sum((t["output_tokens"] or 0) for t in turns if t["turn_idx"] in fix_turn_idx)

    if fix_output_tokens <= 0 or total_turn_output_tokens <= 0:
        _apportion_phases(conn, buckets, session_id, output_tokens, usd, price_version, taxonomy_version)
        return

    if coverage_report is not None and output_tokens > 0:
        coverage_report[session_id] = total_turn_output_tokens / output_tokens

    fix_share = fix_output_tokens / total_turn_output_tokens
    _accumulate(buckets, "followup_fix", fix_output_tokens, usd * fix_share, price_version)

    pre_output_tokens = total_turn_output_tokens - fix_output_tokens
    pre_share = pre_output_tokens / total_turn_output_tokens
    pre_usd = usd * pre_share
    if pre_output_tokens <= 0:
        return  # every turn was in the fix partition -- nothing pre-boundary to apportion

    turn_phase_rows = _turn_phases_for_session(conn, session_id, taxonomy_version)
    if turn_phase_rows:
        # Direct: phase shares computed from just the pre-boundary turns'
        # own labels (per-turn data survived for this session).
        turn_output = {t["turn_idx"]: (t["output_tokens"] or 0) for t in turns}
        phase_by_idx = {r["turn_idx"]: r["phase"] for r in turn_phase_rows}

        labeled_pre_tokens = 0
        phase_pre_tokens: Dict[str, int] = {}
        for turn_idx in turn_output:
            if turn_idx in fix_turn_idx:
                continue
            phase = phase_by_idx.get(turn_idx)
            if phase is None:
                continue
            tok = turn_output[turn_idx]
            phase_pre_tokens[phase] = phase_pre_tokens.get(phase, 0) + tok
            labeled_pre_tokens += tok

        for phase, tok in phase_pre_tokens.items():
            share = tok / pre_output_tokens
            _accumulate(buckets, phase, tok, pre_usd * share, price_version)
        residual = pre_output_tokens - labeled_pre_tokens
        if residual > 0:
            residual_share = residual / pre_output_tokens
            _accumulate(buckets, "unlabeled", residual, pre_usd * residual_share, price_version)
    else:
        # Fallback (design.md D5 amendment, followup-4, documented
        # explicitly): no per-turn labels survived for this session (a
        # backfilled session whose analysis-dataset/staged JSON didn't have
        # them) -- scale this session's ORIGINAL, full-session phase shares
        # by the pre-boundary share of its total turn output. Less precise
        # than the direct branch (assumes phase proportions are uniform
        # across the session's turns, which the fix partition may violate),
        # but still exact on the sum-preserving invariant: fix_share +
        # pre_share == 1 by construction, so this plus the already-
        # accumulated fix partition still sums to exactly `usd`.
        for category, (tokens, cat_usd) in _phase_shares(conn, session_id, output_tokens, usd, taxonomy_version).items():
            _accumulate(buckets, category, tokens * pre_share, cat_usd * pre_share, price_version)


def _turn_phases_for_session(conn, session_id: str, taxonomy_version):
    return conn.execute(
        "SELECT turn_idx, phase FROM turn_phases WHERE session_id = ? AND taxonomy_version = ?",
        (session_id, taxonomy_version),
    ).fetchall()


# --------------------------------------------------------------------------
# turn_phases/phase_tokens aggregation invariant (design.md D2; fix-round-1
# review, finding 1) -- read-only, reusable by both ingest.py's
# backfill-turns (verify BEFORE writing, all-or-nothing per session) and a
# standalone audit of whatever is already committed (``verify-turn-phases``
# CLI subcommand, and this module's own tests).
# --------------------------------------------------------------------------


def phase_tokens_for_session(conn, session_id: str, taxonomy_version: str) -> Dict[str, int]:
    """``{phase: output_tokens}`` for one session's already-persisted
    ``phase_tokens`` rows at exactly ``taxonomy_version`` -- the versioned
    agentic record this module treats as ground truth. Never regenerated
    from re-extracted turns (ingest.py's backfill must not do that either
    -- see design.md D5 amendment's backfill section): this is what any
    ``turn_phases`` aggregation for the same session/version MUST equal
    exactly for the invariant to hold."""
    rows = conn.execute(
        "SELECT phase, output_tokens FROM phase_tokens WHERE session_id = ? AND taxonomy_version = ?",
        (session_id, taxonomy_version),
    ).fetchall()
    return {r["phase"]: r["output_tokens"] or 0 for r in rows}


def turn_phases_aggregation_for_session(conn, session_id: str, taxonomy_version: str) -> Dict[str, int]:
    """``{phase: output_tokens}`` implied by this session's *committed*
    ``turn_phases`` rows joined against ``session_turns.output_tokens``, at
    exactly ``taxonomy_version`` -- what MUST equal
    ``phase_tokens_for_session``'s result for the aggregation invariant to
    hold. (Read-only audit of what's already in the database -- contrast
    with ingest.py's pre-write candidate check, which computes the same
    shape of aggregation from turns-about-to-be-written, before anything
    is committed.)"""
    rows = conn.execute(
        "SELECT tp.phase, SUM(st.output_tokens) as tok FROM turn_phases tp "
        "JOIN session_turns st ON st.session_id = tp.session_id AND st.turn_idx = tp.turn_idx "
        "WHERE tp.session_id = ? AND tp.taxonomy_version = ? GROUP BY tp.phase",
        (session_id, taxonomy_version),
    ).fetchall()
    return {r["phase"]: r["tok"] or 0 for r in rows}


def turn_phases_integrity_violations(conn, session_id: str) -> Dict[str, Dict[str, Dict[str, int]]]:
    """``{taxonomy_version: {phase: {"stored": x, "aggregated": y}}}`` for
    every ``taxonomy_version`` this session has ``turn_phases`` rows at
    whose aggregation doesn't exactly equal ``phase_tokens`` -- empty if
    the invariant holds for every version this session has ``turn_phases``
    at (including trivially, if it has none at all)."""
    out: Dict[str, Dict[str, Dict[str, int]]] = {}
    versions = [
        r[0] for r in conn.execute(
            "SELECT DISTINCT taxonomy_version FROM turn_phases WHERE session_id = ?", (session_id,)
        ).fetchall()
    ]
    for version in versions:
        agg = turn_phases_aggregation_for_session(conn, session_id, version)
        stored = phase_tokens_for_session(conn, session_id, version)
        if agg != stored:
            mismatch: Dict[str, Dict[str, int]] = {}
            for phase in set(agg) | set(stored):
                a, s = agg.get(phase, 0), stored.get(phase, 0)
                if a != s:
                    mismatch[phase] = {"stored": s, "aggregated": a}
            out[version] = mismatch
    return out


def verify_turn_phases_integrity(conn) -> List[Dict[str, Any]]:
    """Full-database scan of the ``turn_phases``/``phase_tokens``
    aggregation invariant (design.md D2): every session with any
    ``turn_phases`` rows must have ``turn_phases`` joined against
    ``session_turns.output_tokens`` aggregate to EXACTLY its
    ``phase_tokens`` rows, for every ``taxonomy_version`` it has
    ``turn_phases`` at -- ``costs.py``'s spanning-session split takes the
    per-turn "direct" branch whenever ANY ``turn_phases`` rows exist for a
    session, so a silently-wrong aggregation would silently corrupt cost
    attribution (fix-round-1 review, finding 1: exactly this went
    undetected in the original followup-4 backfill).

    Returns a list of violation records -- empty iff the whole database
    satisfies the invariant -- each ``{"session_id", "taxonomy_version",
    "phases"}`` where ``phases`` maps a mismatching phase name to
    ``{"stored": ..., "aggregated": ...}``. Read-only; safe to run against
    a live/committed database at any time. ``ingest.py``'s
    ``verify-turn-phases`` CLI subcommand and this module's own tests both
    call this directly rather than duplicating the query."""
    out: List[Dict[str, Any]] = []
    session_ids = [
        r[0] for r in conn.execute("SELECT DISTINCT session_id FROM turn_phases").fetchall()
    ]
    for session_id in session_ids:
        for version, phases in turn_phases_integrity_violations(conn, session_id).items():
            out.append({"session_id": session_id, "taxonomy_version": version, "phases": phases})
    return out


def rebuild(
    conn,
    *,
    as_of: Optional[str] = None,
    taxonomy_version: Optional[str] = None,
    computed_at: Optional[str] = None,
    coverage_warn_threshold: float = DEFAULT_COVERAGE_WARN_THRESHOLD,
) -> int:
    """Recompute ``task_costs`` and ``task_arms`` from scratch, from
    ``sessions``/``phase_tokens``/``model_prices``. Touches no other table.

    ``as_of`` defaults to today (real wall-clock date, ISO ``YYYY-MM-DD``)
    -- the "today" of design D5's "newest model_prices row <= today".
    ``taxonomy_version`` defaults to the current (numerically greatest)
    version present in ``phase_tokens``. Both are overridable for
    determinism in callers/tests that need a fixed clock. ``coverage_warn_
    threshold`` (fix-round-2 review) gates the per-session stderr WARN for
    low turn coverage on a spanning-session split (see
    ``RebuildResult.spanning_session_coverage``'s docstring) -- every
    split session's ratio is always recorded on the return value
    regardless of this threshold, which only controls the stderr noise.

    Returns a ``RebuildResult`` (an ``int`` subclass -- compares/serializes
    identically to the plain row-count this function always returned) whose
    ``.unpriced_models`` attribute lists any session model that funded no
    cost category for lack of a matching (post-alias) ``model_prices`` row;
    one ``WARN`` line per such model is also printed to stderr. Its
    ``.spanning_session_coverage`` attribute similarly lists every actually-
    split session's turn-coverage ratio, with one stderr ``WARN`` per
    session below ``coverage_warn_threshold``.
    """
    as_of = as_of if as_of is not None else date.today().isoformat()
    computed_at = computed_at if computed_at is not None else _now_iso()
    if taxonomy_version is None:
        taxonomy_version = _current_taxonomy_version(conn)

    try:
        conn.execute("DELETE FROM task_costs")
        conn.execute("DELETE FROM task_arms")

        rows_written = 0
        price_cache: Dict[str, Any] = {}
        unpriced_models: set = set()
        spanning_session_coverage: Dict[str, float] = {}

        for task_id in _task_ids_with_sessions(conn):
            sessions = conn.execute(
                "SELECT * FROM sessions WHERE task_id = ?", (task_id,)
            ).fetchall()
            session_dicts = _session_dicts_with_verdict_boundaries(sessions)

            model, effort, basis = discovery.canonical_arm(session_dicts)
            conn.execute(
                "INSERT INTO task_arms(task_id, model, effort, basis_json) VALUES (?, ?, ?, ?)",
                (task_id, model, effort, json.dumps(basis, sort_keys=True)),
            )
            rows_written += 1

            # The task's review boundaries (design.md D5 amendment,
            # followup-4) -- the union of every reviewer session's detected
            # verdict-turn timestamps, or their `ended_at` fallback. Only
            # the FIRST one matters for the spanning-session split: turns
            # after it fund followup_fix regardless of how many later
            # boundaries exist (a round-0 session resumed across several
            # re-review rounds still has just one "was this a fix" cutoff).
            boundaries = discovery.review_boundaries(session_dicts)
            first_boundary = boundaries[0] if boundaries else None

            buckets: Dict[str, Dict[str, Any]] = {}
            for s in sessions:
                role = s["role"]
                review_round = s["review_round"] or 0
                usd, price_version = _session_usd(conn, s, as_of, price_cache)
                if usd is None:
                    # model has no price row on or before as_of -- not
                    # costable. Only flag it as an "unpriced model" gap if
                    # the session actually had tokens to cost (a zero-token
                    # session drops $0 either way, so it's not a real
                    # silently-dropped-dollars gap).
                    if (s["input_tokens"] or 0) or (s["cached_tokens"] or 0) or (s["output_tokens"] or 0):
                        unpriced_models.add(s["model"])
                    continue

                output_tokens = s["output_tokens"] or 0

                if role in ("reviewer", "auditor"):
                    _accumulate(buckets, "review", output_tokens, usd, price_version)
                elif role == "fixer" or (role == "implementer" and review_round >= 1):
                    _accumulate(buckets, "followup_fix", output_tokens, usd, price_version)
                elif role == "implementer":  # review_round == 0
                    if first_boundary is not None:
                        _apportion_round0_session(
                            conn, buckets, s["session_id"], output_tokens, usd, price_version,
                            taxonomy_version, first_boundary,
                            coverage_report=spanning_session_coverage,
                        )
                    else:
                        _apportion_phases(conn, buckets, s["session_id"], output_tokens, usd, price_version, taxonomy_version)
                else:
                    continue  # role == "other" (or unrecognized): not part of D5's cost model

            for category, agg in buckets.items():
                price_version = max(agg["price_versions"]) if agg["price_versions"] else None
                conn.execute(
                    "INSERT INTO task_costs"
                    "(task_id, category, weighted_tokens, usd, computed_at, price_version) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (task_id, category, agg["weighted_tokens"], agg["usd"], computed_at, price_version),
                )
                rows_written += 1

        conn.commit()
        for m in sorted(unpriced_models, key=lambda x: (x is None, x)):
            print(
                f"WARN: costs.rebuild: no model_prices row for model={m!r} "
                f"(as_of={as_of}); sessions with this model were excluded from all cost categories",
                file=sys.stderr,
            )
        # fix-round-2 review: a spanning-session split whose turn coverage
        # is low means its followup_fix/phase attribution (not just
        # weighted_tokens) is correspondingly approximate -- see the
        # module docstring. Loudest sessions first (lowest coverage), so
        # the worst case is never scrolled past.
        low_coverage = sorted(
            (
                (sid, ratio)
                for sid, ratio in spanning_session_coverage.items()
                if ratio < coverage_warn_threshold
            ),
            key=lambda pair: pair[1],
        )
        for session_id, ratio in low_coverage:
            print(
                f"WARN: costs.rebuild: spanning-session turn coverage {ratio:.3f} for "
                f"session_id={session_id!r} is below coverage_warn_threshold="
                f"{coverage_warn_threshold} -- its followup_fix/phase category split "
                f"is approximate in proportion to the missing coverage (see costs.py's "
                f"module docstring, 'Turn coverage and category-attribution accuracy')",
                file=sys.stderr,
            )
        return RebuildResult(rows_written, unpriced_models, spanning_session_coverage)
    except Exception:
        conn.rollback()
        raise
