# task-analyzer-cost-model

## ADDED Requirements

### Requirement: Retrainable per-category Bayesian cost estimator
The system SHALL provide a training script that fits, per cost category and
per (model, effort) arm, a conjugate Bayesian regression from complexity
features to log dollar cost, with partial pooling across arms via a shared
prior; the training arm for every category of a task — including review and
followup_fix — SHALL be the task's canonical implementer arm from
`task_arms`, never a reviewer or fixer model; training SHALL read only the
SQLite dataset, and the resulting
posterior parameters SHALL be persisted as a new row set in
`estimators`/`estimator_params` (prior estimators retained). Retraining after
new ingestion MUST require no inputs other than the database.

#### Scenario: Retrain from database alone
- **WHEN** new tasks have been ingested and the training script runs
- **THEN** a new estimator row is created from the database contents alone, and previous estimator rows remain queryable

#### Scenario: Estimator persistence is self-sufficient
- **WHEN** an estimator row and its params are read by a fresh process with no other context
- **THEN** `config_json` supplies everything needed to reproduce queries exactly: feature names and order, target transform and epsilon, prior hyperparameters and pooling scheme, training filters (rubric/taxonomy/price versions, min rows), category and arm lists, and the quantile algorithm identifier; Thompson sampling requires a caller-supplied seed and no sampling state is persisted

#### Scenario: Calibration metrics are persisted
- **WHEN** training completes
- **THEN** `metrics_json` records per-category held-out calibration (e.g. observed coverage of p50/p80 on held-out rows for arms with sufficient data) and the training row counts per arm

#### Scenario: Sparse arm yields wide posterior
- **WHEN** an arm has fewer than 5 training tasks
- **THEN** its posterior predictive interval is wider than that of well-sampled arms and reflects the pooled prior rather than collapsing to the sparse sample mean

### Requirement: Quantile and uncertainty queries for explore/exploit
The estimator SHALL answer, for any (category, complexity vector, model,
effort): the predictive cost at an arbitrary quantile (e.g. p50, p80) and the
posterior parameters sufficient for Thompson-style sampling; total task cost
MUST be reported as the sum of per-category estimates (implementation phases +
review + followup_fix), not a directly regressed total.

#### Scenario: p80 query
- **WHEN** the estimator is queried for a task with a given complexity vector, model arm, and quantile 0.8
- **THEN** it returns per-category p80 costs and their sum, computed from the stored posterior

### Requirement: Decomposition estimator CLI
The system SHALL provide `estimate.py` taking a proposed decomposition
(annotation-format YAML with complexity vectors), a database path (defaulting
to the main-branch database), and a quantile; it SHALL output, per task, the
cost quantiles for every arm, the selected arm minimizing expected total cost
subject to the quantile guard, an `explore` flag where the leading arms'
posteriors overlap substantially, and decomposition-level totals — as machine-
readable JSON and a human-readable table.

#### Scenario: Scoring a candidate decomposition
- **WHEN** `estimate.py` runs on a candidate YAML with three tasks
- **THEN** it emits per-task arm rankings with quantile costs, a selected model+effort per task, explore flags, and the summed totals for the decomposition

#### Scenario: Deterministic given a fixed estimator
- **WHEN** `estimate.py` runs twice with the same inputs and estimator id (quantile mode, no sampling seed)
- **THEN** outputs are byte-identical

#### Scenario: Supplied composites are not trusted
- **WHEN** a decomposition file supplies a `composite` that differs from the mean of its C1–C6
- **THEN** `estimate.py` recomputes the composite from C1–C6 and uses the recomputed value

#### Scenario: Sanity report against known findings
- **WHEN** `estimate.py --sanity` runs against a trained database
- **THEN** it emits a deterministic report comparing arms at fixed reference complexity vectors (composites 2, 3, 4), sufficient to eyeball known findings (relative arm ordering, explore flags on sparse arms)
