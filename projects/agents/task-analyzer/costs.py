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
from typing import Any, Dict, Optional, Tuple

import db
import discovery

# The 10 TDD phase categories (rubrics/phase-taxonomy.md) plus the two legal
# non-phase round-0 outcomes are not enumerated here as a closed set --
# `phase_tokens.phase` values are trusted verbatim as category names, and
# `unlabeled` is added only when a round-0 session has no phase rows at all.


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
    crash": that's still true, but it must not be a *silent* one."""

    def __new__(cls, rows_written: int, unpriced_models):
        obj = int.__new__(cls, rows_written)
        obj.unpriced_models = frozenset(unpriced_models)
        return obj


def _task_ids_with_sessions(conn):
    return [
        r[0]
        for r in conn.execute(
            "SELECT DISTINCT task_id FROM sessions WHERE task_id IS NOT NULL"
        ).fetchall()
    ]


def rebuild(
    conn,
    *,
    as_of: Optional[str] = None,
    taxonomy_version: Optional[str] = None,
    computed_at: Optional[str] = None,
) -> int:
    """Recompute ``task_costs`` and ``task_arms`` from scratch, from
    ``sessions``/``phase_tokens``/``model_prices``. Touches no other table.

    ``as_of`` defaults to today (real wall-clock date, ISO ``YYYY-MM-DD``)
    -- the "today" of design D5's "newest model_prices row <= today".
    ``taxonomy_version`` defaults to the current (numerically greatest)
    version present in ``phase_tokens``. Both are overridable for
    determinism in callers/tests that need a fixed clock.

    Returns a ``RebuildResult`` (an ``int`` subclass -- compares/serializes
    identically to the plain row-count this function always returned) whose
    ``.unpriced_models`` attribute lists any session model that funded no
    cost category for lack of a matching (post-alias) ``model_prices`` row;
    one ``WARN`` line per such model is also printed to stderr.
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

        for task_id in _task_ids_with_sessions(conn):
            sessions = conn.execute(
                "SELECT * FROM sessions WHERE task_id = ?", (task_id,)
            ).fetchall()

            model, effort, basis = discovery.canonical_arm([dict(s) for s in sessions])
            conn.execute(
                "INSERT INTO task_arms(task_id, model, effort, basis_json) VALUES (?, ?, ?, ?)",
                (task_id, model, effort, json.dumps(basis, sort_keys=True)),
            )
            rows_written += 1

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
                    phases = conn.execute(
                        "SELECT phase, output_tokens FROM phase_tokens "
                        "WHERE session_id = ? AND taxonomy_version = ?",
                        (s["session_id"], taxonomy_version),
                    ).fetchall()
                    if not phases or output_tokens <= 0:
                        _accumulate(buckets, "unlabeled", output_tokens, usd, price_version)
                    else:
                        # Apportion against the session's own output_tokens
                        # -- NOT the sum of its phase-label rows. A session
                        # can be only partially phase-labeled (turns that no
                        # phase-labeling pass covered); dividing by the sum
                        # of labeled phase tokens would smear the session's
                        # *entire* dollar cost across just the labeled
                        # phases, over-allocating them. Whatever share of
                        # output_tokens isn't covered by any phase label
                        # instead fund `unlabeled`, so the category totals
                        # for this session always sum back to its full
                        # session usd.
                        labeled_tokens = 0
                        for p in phases:
                            phase_tokens = p["output_tokens"] or 0
                            labeled_tokens += phase_tokens
                            share = phase_tokens / output_tokens
                            _accumulate(buckets, p["phase"], phase_tokens, usd * share, price_version)
                        residual_tokens = output_tokens - labeled_tokens
                        if residual_tokens > 0:
                            residual_share = residual_tokens / output_tokens
                            _accumulate(buckets, "unlabeled", residual_tokens, usd * residual_share, price_version)
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
        return RebuildResult(rows_written, unpriced_models)
    except Exception:
        conn.rollback()
        raise
