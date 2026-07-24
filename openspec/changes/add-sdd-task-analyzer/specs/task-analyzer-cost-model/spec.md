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
new ingestion MUST require no inputs other than the database. Each
category's pooled fit (across every arm's rows in that category) SHALL also
be persisted, as a dedicated sentinel row that cannot collide with any real
(model, effort) arm, for use as a fallback when a specific (category, arm)
cell has no posterior of its own.

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
- **THEN** its posterior predictive interval is wider than that of well-sampled arms and reflects the pooled prior rather than collapsing to the sparse sample mean (or, if the arm has no posterior of its own for a category at all, the category's pooled fallback posterior — itself wide for the same reason — is used instead of excluding the arm)

### Requirement: Quantile and uncertainty queries for explore/exploit
The estimator SHALL answer, for any (category, complexity vector, model,
effort): the predictive cost at an arbitrary quantile (e.g. p50, p80) and the
posterior parameters sufficient for Thompson-style sampling. Per-category
quantiles are exact (closed-form Student-t). A task's TOTAL cost per arm,
however, is the sum of independent per-category predictives, and quantiles
do not commute with sums — summing each category's own p80 overstates the
total's true p80, and summing each category's own p20 understates the
total's true p20 — so total-cost quantiles MUST be computed as the empirical
quantiles of a seeded Monte Carlo sample of the summed per-category draws
(not as a sum of each category's own quantile), deterministic given a fixed
random seed and draw count.

#### Scenario: p80 query
- **WHEN** the estimator is queried for a single category, a given complexity vector, and a model arm, at quantile 0.8
- **THEN** it returns that category's exact p80 cost, computed in closed form from the stored posterior

#### Scenario: Total cost is a Monte Carlo quantile of the sum, not a sum of quantiles
- **WHEN** a task's total cost is computed for an arm spanning two or more categories, at a fixed seed and draw count
- **THEN** the reported total p80 is less than or equal to the sum of each category's own analytic p80 (within Monte Carlo tolerance), and the reported total p20 is greater than or equal to the sum of each category's own analytic p20

### Requirement: Decomposition estimator CLI
The system SHALL provide `estimate.py` taking a proposed decomposition
(annotation-format YAML with complexity vectors), a database path (defaulting
to the main-branch database), a Monte Carlo seed and draw count, and a guard
factor; it SHALL output, per task, each arm's total-cost quantiles (p20,
p50, p80, computed per the Monte Carlo requirement above), the arm selected
by minimizing p20 among arms passing the p80 guard (excluding any arm whose
p80 total exceeds the guard factor times the minimum p80 total among
scorable arms), and decomposition-level totals — as machine-readable JSON
and a human-readable table. An alternate Thompson-sampling selection mode
MUST be available (one Thompson draw per arm, summed across categories,
argmin among guard-passing arms), reported as the run's selection mode.
Output MUST be byte-deterministic given a fixed estimator id, seed, and
draw count — there is no other source of randomness or non-determinism.

#### Scenario: Scoring a candidate decomposition
- **WHEN** `estimate.py` runs on a candidate YAML with three tasks
- **THEN** it emits per-task arm rankings sorted by total p20, a selected model+effort per task, and the summed totals for the decomposition

#### Scenario: Deterministic given a fixed estimator, seed, and draw count
- **WHEN** `estimate.py` runs twice with the same inputs, estimator id, seed, and draw count
- **THEN** outputs are byte-identical

#### Scenario: Different seed changes the Monte Carlo draws
- **WHEN** `estimate.py` runs twice with the same inputs and estimator id but a different seed
- **THEN** the reported total-cost quantiles differ

#### Scenario: p20 selection is not p50/median selection
- **WHEN** one arm has a lower total p50 (median) than another but a higher total p20 (its width pulls its own low quantile down less than the other arm's)
- **THEN** the arm with the lower p20 is selected, not the arm with the lower p50

#### Scenario: Thompson mode selects and reports differently
- **WHEN** `estimate.py --thompson` runs on a candidate decomposition
- **THEN** each arm's report includes a Thompson total, the selected arm is the guard-passing arm with the lowest Thompson total, and the report's selection mode reads `thompson` instead of `p20`

#### Scenario: Supplied composites are not trusted
- **WHEN** a decomposition file supplies a `composite` that differs from the mean of its C1–C6
- **THEN** `estimate.py` recomputes the composite from C1–C6 and uses the recomputed value

#### Scenario: Sanity report against known findings
- **WHEN** `estimate.py --sanity` runs against a trained database
- **THEN** it emits a deterministic report comparing arms at fixed reference complexity vectors (composites 2, 3, 4), sufficient to eyeball known findings (relative arm ordering, which arms used pooled fallback)
