# SDD Task Analyzer & Decomposer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `projects/agents/task-analyzer`: idempotent SQLite ingestion of landed SDD changes, a retrainable Bayesian cost estimator with quantile output, and a decomposition subagent protocol — per OpenSpec change `add-sdd-task-analyzer`.

**Architecture:** Three layers over one SQLite DB (`data/agents/task-analyzer.sqlite`): raw facts (changes/tasks/sessions), cache-keyed agentic judgments (complexity/grades/phase_tokens keyed by rubric_version + input_sha256), and deterministic derived data (task_costs, estimators). Agentic scoring goes through xagent to cheap models with prompts/rubrics as versioned assets. The estimator is closed-form Normal-Inverse-Gamma regression on log-cost per (category, arm) with a pooled prior.

**Tech Stack:** Python 3.11+ stdlib (`sqlite3`, `hashlib`, `argparse`, `json`) + `numpy` (only for train/estimate). Node only to invoke `projects/xagent/dist/src/main.js`. No new package dependencies.

## Global Constraints

- All new code lives under `projects/agents/task-analyzer/`; the DB at `data/agents/task-analyzer.sqlite`; nothing else in the repo is modified except `data/agents/` and this plan's sibling artifacts.
- Python: stdlib + numpy only. No pip installs. Scripts run with `python3`.
- Tests: written as `unittest.TestCase` subclasses so the stdlib runner genuinely collects them; the canonical command at every commit is `python3 -m unittest discover -s projects/agents/task-analyzer/tests -v` (pytest also runs them if available, but must not be required — system Python is PEP 668-managed with no pip installs).
- SQLite: WAL mode, foreign_keys ON, single writer. Every write path goes through `db.py`.
- External transcript sources (`~/.codex/sessions`, `~/.claude/projects`, `~/.codex/worktrees`) are READ-ONLY.
- Agentic judgment rows MUST carry `rubric_version` (or `taxonomy_version`), `input_sha256`, `scored_by`. Deterministic derived rows MUST be recomputable via `rebuild-derived`.
- Rubric/prompt assets are standalone md files with YAML frontmatter `version: 1`.
- Do not dispatch any xagent/LLM calls from unit tests; all agentic paths must be injectable/fake-able.
- OpenSpec artifacts for requirements: `openspec/changes/add-sdd-task-analyzer/` (design.md D1–D9 govern; schema in D2 is normative).
- Reference (read-only) prior art: `analysis/sdd-model-analysis/scripts/*.py` and `analysis/sdd-model-analysis/rubrics.md` — port, don't import.

---

### Task 1: Project skeleton, rubric and prompt assets

**Files:**
- Create: `projects/agents/task-analyzer/README.md` (stub; completed in Task 11)
- Create: `projects/agents/task-analyzer/rubrics/complexity.md`
- Create: `projects/agents/task-analyzer/rubrics/grading.md`
- Create: `projects/agents/task-analyzer/rubrics/phase-taxonomy.md`
- Create: `projects/agents/task-analyzer/prompts/complexity.md`
- Create: `projects/agents/task-analyzer/prompts/grading.md`
- Create: `projects/agents/task-analyzer/prompts/phase-labeling.md`
- Create: `projects/agents/task-analyzer/.gitignore` (containing `staging/`)
- Create: `projects/agents/task-analyzer/tests/test_assets.py`

**Interfaces:**
- Produces: rubric files whose frontmatter is exactly `---\nversion: 1\nkind: <complexity|grading|phase-taxonomy>\n---`; prompt files with frontmatter `---\nversion: 1\nuses_rubric: rubrics/<name>.md\nmodel_hint: <sonnet|haiku>\n---`. Later tasks parse `version` via `assets.py` (Task 5 defines `read_asset_version(path) -> str`).

- [ ] **Step 1: Write failing asset-integrity test**

```python
# projects/agents/task-analyzer/tests/test_assets.py
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def frontmatter(p: Path) -> dict:
    text = p.read_text()
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    assert m, f"{p} missing frontmatter"
    out = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        out[k.strip()] = v.strip()
    return out

def test_rubrics_present_and_versioned():
    for name, marker in [
        ("complexity.md", "C7"),           # has all seven dims
        ("grading.md", "rounds"),          # mentions rounds-to-accept
        ("phase-taxonomy.md", "selfcheck") # includes the selfcheck phase
    ]:
        p = ROOT / "rubrics" / name
        fm = frontmatter(p)
        assert fm["version"] == "1"
        assert marker in p.read_text()

def test_prompts_reference_rubrics():
    for name in ["complexity.md", "grading.md", "phase-labeling.md"]:
        fm = frontmatter(ROOT / "prompts" / name)
        assert fm["version"] == "1"
        assert (ROOT / fm["uses_rubric"]).exists()
```

- [ ] **Step 2: Run test, verify it fails** — `python3 -m pytest projects/agents/task-analyzer/tests/test_assets.py -q` → FAIL (files missing).

- [ ] **Step 3: Port the rubrics.** Source: `analysis/sdd-model-analysis/rubrics.md`. Split its three sections into the three rubric files verbatim (section 1 → phase-taxonomy.md, section 2 → complexity.md, section 3 → grading.md), each with the frontmatter above. Do not edit anchor wording — these are version-1 rubrics and must match the migrated data's semantics.

- [ ] **Step 4: Write the three prompts.** Port from the analysis session's dispatch prompts, parameterized with `{{RUBRIC_PATH}}`, `{{ITEMS_JSON_PATH}}` (a staging file listing inputs), and `{{OUTPUT_DIR}}`:
  - `complexity.md` (model_hint sonnet): score C1–C7 per rubric anchors from a brief text; composite = mean(C1..C6) to one decimal; output one JSON per item `{"task_key","C1".."C7","composite","rationale":{...}}` into `{{OUTPUT_DIR}}`.
  - `grading.md` (model_hint sonnet): grade from review texts only; severity counts, verdict sequence, rounds_to_accept, G1–G5, final letter (letter definition wins); exclude clearly mis-joined reviews into `excluded_reviews`; output `{"task_key","G1".."G5","n_critical","n_important","n_minor","verdict_sequence","rounds_to_accept","final_grade","evidence","reviewer_models","excluded_reviews"}`.
  - `phase-labeling.md` (model_hint haiku): label every timeline turn with exactly one of the 10 phase keys; label from reading, not keyword scripts; output `{"session_key","labels":{"<turn>":"<phase>"}}`.

- [ ] **Step 5: Run tests, verify pass; commit** — `git add projects/agents/task-analyzer && git commit -m "feat(task-analyzer): skeleton + v1 rubric and prompt assets"`.

---

### Task 2: Database module and schema

**Files:**
- Create: `projects/agents/task-analyzer/schema.sql`
- Create: `projects/agents/task-analyzer/db.py`
- Create: `projects/agents/task-analyzer/tests/test_db.py`

**Interfaces:**
- Produces (used by all later tasks):
  - `db.connect(path: str | Path, create: bool = True) -> sqlite3.Connection` — WAL, `foreign_keys=ON`, `row_factory=sqlite3.Row`; applies `schema.sql` idempotently (schema statements are `CREATE TABLE IF NOT EXISTS`).
  - `db.dump_jsonl(conn, out_path: str | Path) -> None` — every table, rows ordered by primary key, one JSON object per line `{"table": ..., "row": {...}}`, keys sorted; byte-stable across runs.
  - `db.upsert(conn, table: str, row: dict, key_cols: list[str]) -> None` — INSERT ... ON CONFLICT(key_cols) DO UPDATE.
  - `db.sha256_file(path) -> str` and `db.sha256_text(text) -> str`.

- [ ] **Step 1: Write `schema.sql`** — copy the DDL from `openspec/changes/add-sdd-task-analyzer/design.md` D2 **verbatim** (it includes `task_arms` and `meta`; note the composite primary keys on complexity/grades/phase_tokens — they retain version history), changing each `CREATE TABLE` to `CREATE TABLE IF NOT EXISTS` and adding:

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_change ON tasks(change_id);
```

- [ ] **Step 2: Write failing tests**

```python
# projects/agents/task-analyzer/tests/test_db.py
import json, sqlite3
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import db

def test_connect_creates_schema(tmp_path):
    conn = db.connect(tmp_path / "t.sqlite")
    tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"changes","tasks","sessions","complexity","grades","phase_tokens",
            "model_prices","task_costs","estimators","estimator_params",
            "ingest_log","meta"} <= tables
    assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"

def test_upsert_and_stable_dump(tmp_path):
    conn = db.connect(tmp_path / "t.sqlite")
    db.upsert(conn, "changes", {"change_id": 1, "name": "x", "ingested_at": "t0"}, ["change_id"])
    db.upsert(conn, "changes", {"change_id": 1, "name": "x2", "ingested_at": "t0"}, ["change_id"])
    assert conn.execute("SELECT name FROM changes").fetchone()[0] == "x2"
    db.dump_jsonl(conn, tmp_path / "a.jsonl"); db.dump_jsonl(conn, tmp_path / "b.jsonl")
    assert (tmp_path/"a.jsonl").read_bytes() == (tmp_path/"b.jsonl").read_bytes()
    row = json.loads((tmp_path/"a.jsonl").read_text().splitlines()[0])
    assert set(row) == {"table", "row"}
```

- [ ] **Step 3: Run tests, verify FAIL; implement `db.py`; run tests, verify PASS.**

- [ ] **Step 4: Seed prices.** Add to `schema.sql` idempotent seed INSERTs (`INSERT OR IGNORE`) for `model_prices` with `effective_date='2026-07-01'` for the observed arms — gpt-5.5, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.4, gpt-5.4-mini, gpt-5-codex, gpt-5, claude-sonnet-5, claude-opus-4-8, claude-haiku-4-5 — using the current published per-M-token prices (implementer: look them up in `analysis/sdd-model-analysis/` notes if present, else use provider list prices; exact values are data, wire the mechanism and leave a `-- TODO(price-audit)` comment listing sources). Add test: every distinct model named above has ≥1 price row.

- [ ] **Step 5: Commit** — `git commit -m "feat(task-analyzer): sqlite schema + db module"`.

---

### Task 3: Transcript extraction library

**Files:**
- Create: `projects/agents/task-analyzer/extractors.py`
- Create: `projects/agents/task-analyzer/tests/test_extractors.py`
- Create: `projects/agents/task-analyzer/tests/fixtures/codex_exec.jsonl`, `codex_spawn.jsonl`, `claude_session.jsonl`, `claude_subagent.jsonl` (hand-built miniature transcripts)

**Interfaces:**
- Produces:
  - `extractors.extract_codex(path) -> SessionRecord`
  - `extractors.extract_claude(path) -> SessionRecord`
  - `SessionRecord` (dataclass): `session_id, provider, harness_entry, model, effort, started_at, ended_at, prompt, tokens: TokenTotals, peak_context, n_compactions, n_turns, n_tool_calls, turns: list[Turn], last_message`
  - `Turn`: `index, output_tokens, reasoning_tokens, items: list[str]` (condensed lines: `CALL <name>: <snippet>`, `THINK: …`, `SAY: …`, `OUT: …`, `USER: …`, `[CONTEXT COMPACTION]`)
  - `extractors.render_timeline(rec: SessionRecord) -> str` — the markdown timeline format used for phase labeling (`## Turn N  (output_tokens=…)` headers).
- Porting source (behavioral reference, do not import): `analysis/sdd-model-analysis/scripts/extract_codex.py` and `extract_claude.py`. Key semantics to preserve: codex turns split on `token_count` events with `last_token_usage` deltas; codex `session_meta.source` distinguishes `exec` vs `thread_spawn` (capture `spawn_path`/`spawn_role`); claude turns split per assistant API message with that message's usage as the delta; claude subagent files (`*/subagents/agent-*.jsonl`) use file basename as session id; compaction markers (`compacted|compaction|context_compacted` payloads; claude `isCompactSummary`) increment `n_compactions`.

- [ ] **Step 1: Build the four fixture files** — 15–30 lines each, hand-written, covering: an exec session with init handshake + 2 turns + token_counts; a thread_spawn session with `spawn_path` `/root/task_3_x`; a claude top-level session with 3 assistant messages (with usage) + tool_result; a claude subagent file. Include one compaction event in one codex fixture and `isCompactSummary` in one claude fixture.

- [ ] **Step 2: Write failing tests asserting, for each fixture:** session_id, model/effort, harness_entry, token totals summed correctly, turn count, per-turn output_tokens, n_compactions, and that `render_timeline` output contains `## Turn 1` and a `CALL` line.

- [ ] **Step 3: Implement `extractors.py` (port + refactor); tests PASS.**

- [ ] **Step 4: Add a smoke test against one real transcript** (skipped when the path is absent):

```python
import os, pytest
REAL = os.path.expanduser("~/.codex/sessions")
@pytest.mark.skipif(not os.path.isdir(REAL), reason="no codex sessions on this machine")
def test_real_corpus_parses_one():
    import glob
    files = sorted(glob.glob(REAL + "/**/rollout-*.jsonl", recursive=True))[:3]
    for f in files:
        rec = __import__("extractors").extract_codex(f)
        assert rec.session_id
```

- [ ] **Step 5: Commit** — `git commit -m "feat(task-analyzer): transcript extractors with fixtures"`.

---

### Task 4: Discovery, joining, and role/round classification

**Files:**
- Create: `projects/agents/task-analyzer/discovery.py`
- Create: `projects/agents/task-analyzer/tests/test_discovery.py`

**Interfaces:**
- Consumes: `extractors.SessionRecord`.
- Produces:
  - `discovery.landed_changes(repo_root, archive_ref="refs/heads/main") -> (list[LandedChange], ref_sha)` — via `git ls-tree <ref> openspec/changes/archive/` (never the working tree); `LandedChange = (name, archive_path, plan_path|None)`; the resolved ref + SHA is returned for `ingest_log`.
  - `discovery.classify_role(prompt: str, spawn_path: str|None) -> str` — `implementer|reviewer|fixer|auditor|other`, porting the final regex set from `analysis/sdd-model-analysis/scripts/extract_codex.py::classify` (reviewer patterns take precedence over brief-reference patterns — that ordering bug is documented there; keep the fixed order).
  - `discovery.task_keys(prompt, cwd) -> dict` — change/task/worktree extraction (port `task_keys` + `task_of` incl. `Plan N Task M` → `pN-task-M`, `task group N` → `taskgroup-N`, backtick/stopword fixes).
  - `discovery.assign_review_rounds(sessions) -> dict[str,int]` — per design D5's event rules: review boundaries are reviewer-session **end** times; implementer/fixer sessions starting before the first boundary get round 0; after n boundaries, round n; reviewer sessions themselves get the round they open. Aborted/zero-output sessions are numbered like any other.
  - `discovery.canonical_arm(sessions) -> (model, effort, basis: dict)` — round-0 implementer session with greatest output_tokens; alternates listed in basis.
  - `discovery.Quarantine` — record of ambiguous joins `(session_id, reason, candidates)`; ambiguous = task key matches >1 task or brief hash conflicts. Quarantined sessions get `task_id NULL`, never a guessed join.
- [ ] **Step 1: Write failing tests** covering: classify_role on 8 canned prompts (implementer brief-file, "READ-ONLY task reviewer", RE-REVIEW, fixer, spawn_path task_4 fallback); task_keys on 6 canned prompts (brief path with change dir, openspec backtick name, `Plan 2 Task 5`, `/private/tmp/sheaf-x` fallback, `.claude/worktrees` non-greedy capture); assign_review_rounds on a synthetic task with implementer@t0, reviewer(end t1), implementer@t2, reviewer(end t3), reviewer(end t4, no intervening fix) → impl0 round 0, impl2 round 1 (followup), third reviewer contributes review only; canonical_arm picks the larger round-0 implementer when two exist; quarantine when two tasks match one key.
- [ ] **Step 2: Implement; tests PASS.**
- [ ] **Step 3: Commit** — `git commit -m "feat(task-analyzer): discovery, joining, review-round mechanics"`.

---

### Task 5: Idempotent ingest driver (mechanical path)

**Files:**
- Create: `projects/agents/task-analyzer/ingest.py` (CLI entry: `python3 ingest.py [--db PATH] [--repo PATH] [--dry-run] [--no-agents] [--rescore TABLE] [--change NAME]`)
- Create: `projects/agents/task-analyzer/assets.py` (`read_asset_version(path) -> str`; `load_prompt(name) -> (text, version, model_hint)`)
- Create: `projects/agents/task-analyzer/tests/test_ingest.py`

**Interfaces:**
- Consumes: `db`, `extractors`, `discovery`, `assets`.
- Produces:
  - `ingest.plan_work(conn, repo_root) -> WorkPlan` — pure function; lists new changes, new tasks, new sessions, and agentic gaps (`missing_complexity/missing_grades/missing_phase_labels`, each with its cache-key reason).
  - `ingest.run(conn, repo_root, *, dry_run, no_agents, rescore, agent_runner) -> RunReport` — `agent_runner` is the injectable callable (Task 7 provides the real one); per-task transactions; archives `brief_text` and graded tasks' review texts into the DB; appends `ingest_log` row; writes JSONL dump on success.
  - Staging contract (normative): `staging/<kind>/<entity_key>__v<version>__<sha256[:12]>.json`, written atomically (tmp + rename); invalid files renamed `.err` and re-dispatched; `plan_work` reports staging-satisfied vs to-dispatch gaps separately.
- [ ] **Step 1: Write failing tests** using a fake repo tree in tmp_path (archive dir with one change, briefs, two fixture transcripts) and a `fake_agent_runner` that records invocations and writes canned staged JSON:
  - fresh DB + run → rows appear in changes/tasks/sessions; agentic tables filled from fake runner; second `run` → RunReport shows zero writes and `fake_agent_runner` not invoked (idempotency).
  - `--dry-run` → DB byte-identical before/after, WorkPlan non-empty.
  - `--no-agents` → mechanical rows written, agentic gaps reported not dispatched.
  - crash simulation: make the fake runner raise after staging one file; re-run → completes using staged file without re-invoking for that key.
  - rescore: bump rubric version string via monkeypatched `assets.read_asset_version` → without `--rescore` rows untouched + reported stale; with `--rescore complexity` re-dispatched.
- [ ] **Step 2: Implement; tests PASS.**
- [ ] **Step 3: Commit** — `git commit -m "feat(task-analyzer): idempotent ingest driver"`.

---

### Task 6: Derived costs (`rebuild-derived`)

**Files:**
- Create: `projects/agents/task-analyzer/costs.py`
- Modify: `projects/agents/task-analyzer/ingest.py` (add `rebuild-derived` subcommand)
- Create: `projects/agents/task-analyzer/tests/test_costs.py`

**Interfaces:**
- Produces: `costs.rebuild(conn) -> int` (rows written). Per design D5:
  - session dollar cost = uncached_input×p_in + cached×p_cached + output×p_out, prices from newest `model_prices` row ≤ today for that model (`price_version` = that effective_date).
  - implementer sessions with review_round 0: cost apportioned over the 10 phases by `phase_tokens.output_tokens` share at the configured taxonomy version (sessions with no phase labels → category `unlabeled`).
  - all reviewer/auditor sessions → `review`; fixer sessions and implementer sessions with review_round ≥ 1 → `followup_fix` (no phase apportionment); quarantined sessions fund nothing.
  - `costs.rebuild` also (re)writes `task_arms` via `discovery.canonical_arm`.
- [ ] **Step 1: Failing tests:** synthetic task with one implementer session (phases red 60 / green 40 output tokens, known token totals), one reviewer, one round-2 implementer → assert exact usd per category (hand-computed against seeded price rows); price-update test: insert newer price row, `rebuild`, assert usd changed and `price_version` updated, agentic tables untouched (compare row counts + a hash of `complexity` table before/after).
- [ ] **Step 2: Implement; tests PASS; commit** — `git commit -m "feat(task-analyzer): derived cost rebuild"`.

---

### Task 7: xagent dispatch wrappers (real agent_runner)

**Files:**
- Create: `projects/agents/task-analyzer/agents.py`
- Create: `projects/agents/task-analyzer/tests/test_agents.py`

**Interfaces:**
- Consumes: `assets.load_prompt`, staging dir contract from Task 5.
- Produces: `agents.xagent_runner(kind: str, items: list[dict], staging_dir: Path, *, harness="claude_code", model=None) -> list[Path]`:
  - kind ∈ {complexity, grading, phase_labeling}; model defaults from the prompt's `model_hint` (sonnet/sonnet/haiku).
  - Writes `items.json` into staging, renders the prompt with `{{…}}` substitutions, invokes `node projects/xagent/dist/src/main.js run --harness claude_code --model <m> --subagent "<short pointer prompt>" < /dev/null > log`, batches ≤12 items per invocation, validates each produced JSON against a per-kind required-key set, retries invalid items once, returns produced paths.
  - MUST close stdin (`< /dev/null`) and redirect stdout to a file (xagent hangs on open stdin; SIGPIPE kills runs — documented in the repo memory).
- [ ] **Step 1: Failing tests** with `subprocess.run` monkeypatched: batching math (25 items → 3 invocations), prompt rendering includes rubric path and staging paths, validation rejects a malformed staged JSON and retries once, model_hint honored and overridable.
- [ ] **Step 2: Implement; tests PASS (no real dispatches in tests).**
- [ ] **Step 3: One real smoke run** (manual, cheap): `python3 -c` snippet dispatching a single phase-labeling item against a real timeline rendered from a fixture; verify a valid staged JSON appears. Record the command and result in the task report.
- [ ] **Step 4: Commit** — `git commit -m "feat(task-analyzer): xagent dispatch wrappers"`.

---

### Task 8: Migration of the 2026-07-19 dataset

**Files:**
- Create: `projects/agents/task-analyzer/migrate_v0.py` (CLI: `python3 migrate_v0.py --db PATH --source analysis/sdd-model-analysis/data`)
- Create: `projects/agents/task-analyzer/tests/test_migrate.py`

**Interfaces:**
- Consumes: `db`, `discovery.assign_review_rounds`, `costs.rebuild`.
- Source files (formats are exactly what the analysis scripts wrote): `codex_sessions.json`, `claude_sessions.json`, `tasks.json`, `complexity/*.json`, `grades/*.json`, `phase_labels/*.json`, `timelines/*.md` (turn headers carry per-turn output/reasoning tokens).
- Mapping: sessions → `sessions` (role from `kind`; `harness_entry` from `entry`); tasks.json rows → `changes` + `tasks` (brief_text from disk if the file survives, else the implementer prompt); complexity/grades → rubric_version `'1'`, `scored_by` `'migrated_v0'`, `input_sha256` of whatever text was used; phase labels × timeline turn headers → `phase_tokens` rows (output_tokens summed per phase per session), taxonomy_version `'1'`. Then run round assignment + `costs.rebuild`. Zero agent dispatches. Idempotent: keyed upserts; second run is a no-op.
- [ ] **Step 1: Failing tests** on a miniature copied source tree (2 tasks, 3 sessions, 1 grade, 1 complexity, 1 label+timeline pair): row counts, rubric_version=='1' everywhere, second-run no-op (dump bytes equal), `task_costs` non-empty after rebuild.
- [ ] **Step 2: Implement; tests PASS.**
- [ ] **Step 3: Real migration run:** `python3 projects/agents/task-analyzer/migrate_v0.py --db data/agents/task-analyzer.sqlite --source analysis/sdd-model-analysis/data` then `python3 projects/agents/task-analyzer/ingest.py --db data/agents/task-analyzer.sqlite rebuild-derived`. Reconcile and print: implementer+fixer sessions ≈ 203, complexity rows = 143, grades rows = 117, phase-labeled sessions = 200. Investigate any count off by >2 before committing.
- [ ] **Step 4: Commit DB + dump** — `git add data/agents/ projects/agents/task-analyzer && git commit -m "feat(task-analyzer): migrate 2026-07-19 dataset"`.

---

### Task 9: Bayesian cost model (train + posterior queries)

**Files:**
- Create: `projects/agents/task-analyzer/model.py`
- Create: `projects/agents/task-analyzer/train.py` (CLI: `python3 train.py --db PATH [--config JSON]`)
- Create: `projects/agents/task-analyzer/tests/test_model.py`

**Interfaces:**
- Produces:
  - `model.NIG` dataclass: `mu (np.ndarray k), Lambda (k×k), a (float), b (float)` with:
    - `NIG.update(X: np.ndarray, y: np.ndarray) -> NIG` — standard conjugate Bayesian linear regression update: `Λn = Λ0 + XᵀX`, `μn = Λn⁻¹(Λ0 μ0 + Xᵀ y)`, `an = a0 + n/2`, `bn = b0 + ½(yᵀy + μ0ᵀΛ0μ0 − μnᵀΛnμn)`.
    - `NIG.predictive(x: np.ndarray) -> (mean, scale, df)` — Student-t: `mean = xᵀμn`, `df = 2an`, `scale² = (bn/an)(1 + xᵀΛn⁻¹x)`.
    - `NIG.quantile(x, q) -> float` and `NIG.thompson(x, rng) -> float` (draw σ² from InvGamma(a,b), β from N(μ, σ²Λ⁻¹), return xᵀβ).
    - `NIG.to_json() / NIG.from_json` — exact roundtrip.
  - `model.features(complexity_row, config) -> np.ndarray` — default `[1, composite, C3, C4, C5]`.
  - Targets: `y = log(usd + 1e-4)` per (task, category); quantile answers exponentiate back.
  - `train.main`: joins `task_costs × complexity(current version) × task_arms` — the arm is ALWAYS the task's canonical implementer arm, for review/followup categories too. For each category × arm with ≥1 row: pooled prior = NIG fitted on all arms with weak hyperparameters (`μ0=0, Λ0=I·1e-2, a0=1, b0=1`) then per-arm posterior = pooled-posterior-as-prior updated on the arm's rows (partial pooling); persist per design D2 into `estimators` and `estimator_params` (`posterior_json = NIG.to_json()`). `config_json` is normative and MUST contain: feature names+order, transform+epsilon, prior hyperparameters, pooling scheme, training filters (rubric_version, taxonomy_version, price_version, min rows), category list, arm list, quantile algorithm id, output formatting rule. `metrics_json` MUST contain per-category held-out p50/p80 coverage (LOO on arms with ≥8 rows) and per-arm train row counts.
- Student-t quantile without scipy: implement inverse-CDF via `numpy` bisection on the regularized incomplete beta series, or simpler: `mean + scale * t_ppf(q, df)` with `t_ppf` computed by bisection over the t-CDF built from `math.lgamma`-based incomplete beta continued fraction (put it in `model.py`, test against known values: `t_ppf(0.8, 5) ≈ 0.9195`, `t_ppf(0.5, 7) == 0.0`, `t_ppf(0.8, 1e6) ≈ 0.8416`).
- [ ] **Step 1: Failing math tests:** NIG update on synthetic data recovers known coefficients (generate y = 2 + 3x + noise, n=200, assert |μn − [2,3]| < 0.2); predictive interval calibration on synthetic data (≈80% of held-out points below their p80); t_ppf values above; to_json roundtrip exact; sparse-arm test: arm with 2 rows has p80−p50 gap strictly wider than an arm with 50 rows from the same generator.
- [ ] **Step 2: Implement `model.py`; tests PASS.**
- [ ] **Step 3: Failing train-integration test** on a tmp DB seeded with ~60 synthetic task_costs/complexity/sessions rows across 3 arms → `train.main` writes 1 estimators row + params for every (category, arm) with data; re-running creates a second estimators row (old kept).
- [ ] **Step 4: Implement `train.py`; tests PASS; commit** — `git commit -m "feat(task-analyzer): NIG cost model + training"`.

---

### Task 10: Estimator CLI + annotation format

**Files:**
- Create: `projects/agents/task-analyzer/estimate.py` (CLI: `python3 estimate.py --decomposition FILE [--db PATH] [--quantile 0.8] [--estimator-id N] [--json]`)
- Create: `projects/agents/task-analyzer/annotations.py` (writer + validator)
- Create: `projects/agents/task-analyzer/tests/test_estimate.py`, `tests/test_annotations.py`

**Interfaces:**
- Consumes: `model.NIG.from_json`, `estimator_params` rows; annotation YAML per design D1 (parse with a ~40-line built-in YAML-subset parser or JSON alternative `--decomposition file.json` — no new deps; support both, JSON canonical).
- Produces:
  - `annotations.validate(doc, plan_tasks: list[str], known_arms: list[(model,effort)]) -> list[str]` (error strings; empty = valid) and `annotations.write(doc, path)`.
  - `estimate.py` output: per task, all arms ranked by expected total (sum over categories of predictive mean, in usd), selected arm = min expected total subject to p_q(total) guard; `explore: true` when runner-up's p20 < winner's p80 (posterior overlap proxy); totals per decomposition; supplied `composite` values are ignored and recomputed from C1–C6; `--json` machine output + default human table; `--sanity` emits the deterministic reference report at composites {2,3,4} across all arms; deterministic for fixed `--estimator-id` in quantile mode (assert byte-equal in test).
- [ ] **Step 1: Failing tests:** validator catches unknown task key, C out of range, unknown arm, composite disagreeing with mean(C1..C6); estimate on a tmp DB with a hand-built estimator (two arms with known posteriors — one clearly cheaper, one sparse/wide) → cheaper arm selected, sparse arm flagged explore, byte-determinism across two runs.
- [ ] **Step 2: Implement; tests PASS.**
- [ ] **Step 3: Real run sanity check** against the migrated+trained DB: craft a 3-task decomposition JSON at composites {2.0, 3.0, 4.0} and verify outputs are finite, ordered, and directionally consistent with findings (report the table in the task report; do not hard-assert findings in tests).
- [ ] **Step 4: Commit** — `git commit -m "feat(task-analyzer): estimator CLI + annotation format"`.

---

### Task 11: Decomposer prompt, real train, README

**Files:**
- Create: `projects/agents/task-analyzer/prompts/decomposer.md`
- Modify: `projects/agents/task-analyzer/README.md` (complete it)
- Create: `docs/superpowers/plans/2026-07-21-add-sdd-task-analyzer.assignments.yaml` (dogfood example, written by hand via the validator)

**Interfaces:**
- Consumes: everything prior.
- `prompts/decomposer.md` MUST specify: inputs (proposal/design/specs paths, main-branch DB path, quantile); the 5-step search protocol from design D7 (3–5 candidates varying granularity + grouping axis; in-context C1–C7 scoring per rubric; `estimate.py` per candidate; guardrails — split composite >3.5, prefer C7 ≤ 2, dependency order; emit chosen annotation YAML + comparison table + rationale); the rule that the DB path is caller-supplied main-branch, never a worktree copy; and the no-side-effects contract (writes only the annotation + report).
- [ ] **Step 1: Train on real data:** `python3 projects/agents/task-analyzer/train.py --db data/agents/task-analyzer.sqlite`. Sanity-check in the task report: expected-total(5.5/high) < expected-total(sol/high) at composite 3; terra/medium cheapest arm at composite ≤3 among arms with n≥5; sparse arms (luna, 5.4) flagged wide. Commit DB.
- [ ] **Step 2: Write `prompts/decomposer.md`** per the interface above.
- [ ] **Step 3: Dry-run the decomposer once** (haiku or sonnet subagent, manual dispatch) against archived change `add-note-system-message-mappings` with the trained DB; verify it produces ≥3 scored candidates and a selection; capture its output under `projects/agents/task-analyzer/examples/`; refine the prompt once if the protocol was misunderstood.
- [ ] **Step 4: Complete README.md:** run cadence (offline, occasional), command reference (ingest / rebuild-derived / migrate_v0 / train / estimate), the recompute matrix (rubric bump → `--rescore`; price change → rebuild-derived; taxonomy bump → phase relabel; estimator retrain cadence), staging/crash-recovery semantics, and the explicit note that workflow integration is a future change.
- [ ] **Step 5: Commit** — `git commit -m "feat(task-analyzer): decomposer prompt, trained estimator, docs"`.

---

## Self-review notes

- Spec coverage: annotations spec → Tasks 10, 11; data-gathering spec → Tasks 1–8 (rubric assets T1, schema+dump T2, idempotency/atomicity/dry-run/no-agents T5, xagent scoring T7, derived costs T6, migration T8, landed-only T4/T5); cost-model spec → Tasks 9, 10 (retrain-from-DB, sparse-arm width, quantile queries, CLI determinism); decomposition-agent spec → Task 11 (+ estimate.py from T10).
- Types cross-checked: `agent_runner` signature (T5 ↔ T7), `SessionRecord/Turn` (T3 ↔ T4/T5/T8), `NIG.to_json` (T9 ↔ T10), staging contract (T5 ↔ T7 ↔ T8's no-agents guarantee).
- Deliberate delegations (documented, not omissions): exact price values (T2, data not code), t_ppf implementation strategy options (T9), YAML-subset vs JSON parsing split (T10).
