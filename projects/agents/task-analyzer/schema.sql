-- SQLite schema for the SDD task-analyzer pipeline.
-- Source of truth: openspec/changes/add-sdd-task-analyzer/design.md, section D2.
-- Copied verbatim except: CREATE TABLE -> CREATE TABLE IF NOT EXISTS (idempotent
-- application), the two indexes below, and the model_prices seed data.

-- raw layer (facts about the world; never recomputed, only appended)
CREATE TABLE IF NOT EXISTS changes(
  change_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,            -- openspec change name
  archive_path TEXT,                    -- openspec/changes/archive/<...>
  plan_path TEXT,                       -- docs/superpowers/plans/<...>.md
  merged_at TEXT, ingested_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS tasks(
  task_id INTEGER PRIMARY KEY,
  change_id INTEGER NOT NULL REFERENCES changes,
  task_key TEXT NOT NULL,               -- e.g. task-3, p2-task-4
  brief_path TEXT, brief_sha256 TEXT, brief_bytes INTEGER,
  brief_text TEXT,                      -- archived verbatim (survives worktree cleanup)
  UNIQUE(change_id, task_key));

CREATE TABLE IF NOT EXISTS sessions(
  session_id TEXT PRIMARY KEY,          -- provider:native-id
  task_id INTEGER REFERENCES tasks,     -- null until joined
  provider TEXT NOT NULL,               -- codex | claude
  harness_entry TEXT,                   -- exec | thread_spawn | subagent | main
  role TEXT NOT NULL,                   -- implementer | reviewer | fixer | auditor
  model TEXT, effort TEXT,
  started_at TEXT, ended_at TEXT,
  transcript_path TEXT,
  input_tokens INTEGER, cached_tokens INTEGER, output_tokens INTEGER,
  reasoning_tokens INTEGER, peak_context INTEGER,
  n_compactions INTEGER, n_turns INTEGER, n_tool_calls INTEGER,
  review_round INTEGER);                -- 1..n for reviewer/fixer sessions

-- agentic layer (cache-keyed judgments; re-run when rubric_version changes)
CREATE TABLE IF NOT EXISTS complexity(
  task_id INTEGER REFERENCES tasks,
  c1 INT, c2 INT, c3 INT, c4 INT, c5 INT, c6 INT, c7 INT, composite REAL,
  rationale_json TEXT,
  rubric_version TEXT NOT NULL, input_sha256 TEXT NOT NULL, scored_by TEXT,
  PRIMARY KEY(task_id, rubric_version));

CREATE TABLE IF NOT EXISTS grades(
  task_id INTEGER REFERENCES tasks,
  g1 INT, g2 INT, g3 INT, g4 INT, g5 INT,
  n_critical INT, n_important INT, n_minor INT,
  rounds_to_accept INT, verdict_sequence_json TEXT, final_grade TEXT,
  evidence_json TEXT, excluded_reviews_json TEXT,
  review_text TEXT,                     -- archived verbatim (design.md D9 open
                                         -- question, resolved yes: grades'
                                         -- provenance survives worktree/session
                                         -- cleanup; added by Task 5/ingest.py)
  rubric_version TEXT NOT NULL, input_sha256 TEXT NOT NULL, scored_by TEXT,
  PRIMARY KEY(task_id, rubric_version));

CREATE TABLE IF NOT EXISTS phase_tokens(
  session_id TEXT REFERENCES sessions, phase TEXT,  -- 10-phase taxonomy
  output_tokens INTEGER, turns INTEGER,
  taxonomy_version TEXT NOT NULL, input_sha256 TEXT NOT NULL, scored_by TEXT,
  PRIMARY KEY(session_id, phase, taxonomy_version));

-- reference + derived layer (deterministic; `rebuild-derived` recomputes)
CREATE TABLE IF NOT EXISTS model_prices(
  model TEXT, effective_date TEXT,
  usd_per_m_input REAL, usd_per_m_cached REAL, usd_per_m_output REAL,
  PRIMARY KEY(model, effective_date));

CREATE TABLE IF NOT EXISTS task_costs(                -- one row per task per cost category
  task_id INTEGER REFERENCES tasks, category TEXT,
  -- categories: the 10 phases (round-0 implementer sessions, phase-weighted),
  -- 'unlabeled' (round-0 implementer sessions lacking phase labels),
  -- 'review' (all reviewer/auditor sessions), and
  -- 'followup_fix' (fixer + implementer sessions with review_round >= 1)
  weighted_tokens REAL, usd REAL,
  computed_at TEXT, price_version TEXT,
  PRIMARY KEY(task_id, category));

CREATE TABLE IF NOT EXISTS task_arms(                 -- canonical implementer arm per task
  task_id INTEGER PRIMARY KEY REFERENCES tasks,
  model TEXT, effort TEXT,
  basis_json TEXT);                     -- how chosen + other round-0 sessions

CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
-- meta rows include ('schema_version','2'); schema is applied idempotently
-- (CREATE TABLE IF NOT EXISTS); future schema changes bump schema_version.
-- v2 (Task 5/ingest.py): added grades.review_text (see comment there).

-- estimator layer
CREATE TABLE IF NOT EXISTS estimators(
  estimator_id INTEGER PRIMARY KEY,
  trained_at TEXT, code_version TEXT, train_task_count INTEGER,
  config_json TEXT, metrics_json TEXT);
CREATE TABLE IF NOT EXISTS estimator_params(          -- one row per (category, arm)
  estimator_id INTEGER REFERENCES estimators,
  category TEXT, model TEXT, effort TEXT,
  posterior_json TEXT,                  -- NIG params: mu vector, Lambda, a, b
  PRIMARY KEY(estimator_id, category, model, effort));

CREATE TABLE IF NOT EXISTS ingest_log(
  run_id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT,
  git_sha TEXT, actions_json TEXT);

CREATE INDEX IF NOT EXISTS idx_sessions_task ON sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_change ON tasks(change_id);

-- meta seed: schema version marker (idempotent; see meta comment above).
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '2');

-- model_prices seed: current published USD-per-million-token list prices for
-- the implementer/reviewer arms observed in the 2026-07-19 analysis
-- (analysis/sdd-model-analysis/). effective_date is the date this seed was
-- authored, per the task brief.
--
-- Confirmed against the claude-api skill's cached pricing table
-- (cached: 2026-06-24) for the three Anthropic models. As of the
-- effective_date below (2026-07-01), Claude Sonnet 5 is within its
-- introductory pricing window (through 2026-08-31: $2/$10 per MTok) --
-- that is the price actually in effect, so it is what's seeded here.
-- usd_per_m_cached is derived from the documented cache-read discount
-- (~0.1x base input price; shared/prompt-caching.md), not an independent
-- published number.
--
-- -- TODO(price-audit): the eight gpt-5.x rows below (gpt-5, gpt-5-codex,
-- gpt-5.4, gpt-5.4-mini, gpt-5.5, gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna)
-- are PLACEHOLDERS ONLY. No OpenAI pricing reference was available in this
-- repo or in the tool-provided skill context to confirm them, and some of
-- these model names (gpt-5.6-sol/terra/luna in particular) are not
-- verifiable against any source accessible during this task. All eight use
-- an identical, obviously-synthetic placeholder value (usd_per_m_input=1,
-- usd_per_m_cached=1, usd_per_m_output=1) so the mechanism (join, cost
-- derivation) is exercisable end-to-end, but every downstream dollar
-- figure computed from these eight rows is not meaningful until a human
-- confirms real OpenAI list prices for each named model/date and updates
-- these rows (or supersedes them with a later effective_date row, since
-- model_prices retains history by (model, effective_date)).
--
-- -- TODO(price-audit): claude-sonnet-4-6 and claude-fable-5 (below) are
-- PLACEHOLDERS ONLY, same convention as the gpt-5.x rows above --
-- observed in ingested sessions (final review pass, 2026-07-21) with no
-- verifiable published pricing available in this repo or the
-- tool-provided skill context at authoring time. A third observed
-- unpriced name, claude-haiku-4-5-20251001, is deliberately NOT a row
-- here -- it is a dated provider variant of the already-priced
-- claude-haiku-4-5 above, normalized onto that row at cost-derivation
-- join time by db.MODEL_ALIASES instead of duplicated as its own price
-- entry.
INSERT OR IGNORE INTO model_prices(model, effective_date, usd_per_m_input, usd_per_m_cached, usd_per_m_output) VALUES
  ('claude-sonnet-5',   '2026-07-01', 2.0, 0.2, 10.0),
  ('claude-opus-4-8',   '2026-07-01', 5.0, 0.5, 25.0),
  ('claude-haiku-4-5',  '2026-07-01', 1.0, 0.1, 5.0),
  ('claude-sonnet-4-6', '2026-07-01', 1.0, 1.0, 1.0),
  ('claude-fable-5',    '2026-07-01', 1.0, 1.0, 1.0),
  ('gpt-5',             '2026-07-01', 1.0, 1.0, 1.0),
  ('gpt-5-codex',       '2026-07-01', 1.0, 1.0, 1.0),
  ('gpt-5.4',           '2026-07-01', 1.0, 1.0, 1.0),
  ('gpt-5.4-mini',      '2026-07-01', 1.0, 1.0, 1.0),
  ('gpt-5.5',           '2026-07-01', 1.0, 1.0, 1.0),
  ('gpt-5.6-sol',       '2026-07-01', 1.0, 1.0, 1.0),
  ('gpt-5.6-terra',     '2026-07-01', 1.0, 1.0, 1.0),
  ('gpt-5.6-luna',      '2026-07-01', 1.0, 1.0, 1.0);
