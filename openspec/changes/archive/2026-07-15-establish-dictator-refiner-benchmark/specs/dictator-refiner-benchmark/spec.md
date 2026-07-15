## ADDED Requirements

### Requirement: rb-1 — Dataset classes: Explicit evidence status
WHEN a dataset is registered in the refiner benchmark, THE benchmark SHALL classify it as a historical distribution sample, synthetic contract suite, or human-reviewed golden set and SHALL NOT score a historical distribution sample as though its prior refined outputs were approved targets.

#### Scenario: Historical interactions are imported
- **WHEN** lived-with Dictator interactions are registered for evaluation
- **THEN** the manifest identifies them as a historical distribution sample and target-output accuracy is not reported

#### Scenario: Human approves a transformation
- **WHEN** the user explicitly judges the desired output for a case
- **THEN** that case may be promoted into the human-reviewed golden set with its review provenance

### Requirement: rb-2 — Storage: Tracked and private artifact boundary
WHEN benchmark artifacts are retained, THE benchmark SHALL track reusable code, prompt versions, synthetic and deliberately reviewed cases, study manifests, aggregate summaries, and reports in Git while keeping the uncurated personal corpus and raw model or judge traces under ignored `data/dictator/experiments/refiner-benchmark/<study-id>/` storage.

#### Scenario: Raw historical run is retained
- **WHEN** a complete model run over personal historical transcripts is retained
- **THEN** its raw input and output rows remain in ignored study storage and its manifest and aggregate summary may be tracked

#### Scenario: Synthetic suite is retained
- **WHEN** a synthetic contract suite contains no private source material
- **THEN** the suite is tracked with the benchmark harness

### Requirement: rb-3 — Study identity: Immutable run evidence
WHEN a benchmark run completes, THE benchmark SHALL assign it a study and run identity and SHALL preserve the recorded output immutably; a later rerun SHALL create a new identity rather than overwrite the earlier evidence.

#### Scenario: Configuration is rerun
- **WHEN** the same model, reasoning effort, and prompt set are evaluated again
- **THEN** the new output is written under a distinct run identity and the earlier output remains hash-verifiable

### Requirement: rb-4 — Reproducibility: Manifested configuration and hashes
WHEN a study is published, THE benchmark SHALL provide a tracked manifest that records dataset status, private relative artifact paths, record counts, content hashes, harness and prompt hashes, requested configuration, response metadata, evaluator configuration, errors, and links to summaries and reports without embedding secrets or the uncurated transcript corpus.

#### Scenario: Future reviewer inspects a study
- **WHEN** a reviewer opens the tracked study manifest
- **THEN** the reviewer can identify the exact dataset partition, prompt files, model, reasoning effort, evaluator, counts, and hashes used for each reported comparison

#### Scenario: Private artifact changes
- **WHEN** a retained private result no longer matches its manifest hash or count
- **THEN** verification reports the evidence mismatch instead of silently using it

### Requirement: rb-5 — Evaluation: Separate fidelity, correction, marker, and semantic safety signals
WHEN candidate configurations are compared, THE benchmark SHALL report unchanged-prose fidelity, undo/self-correction handling, context-supported transcription repair, Blark/Borg contract behavior, semantic-landmine review, latency, token usage, and errors separately rather than collapsing them into only one aggregate judge score.

#### Scenario: Polished candidate wins a model-judge score
- **WHEN** a candidate has a higher judge score but worsens unchanged-prose fidelity or semantic safety
- **THEN** the regression remains visible and prevents the judge score from being treated as sufficient evidence to adopt the candidate

#### Scenario: Stochastic marker behavior is evaluated
- **WHEN** Blark or Borg behavior is part of a candidate comparison
- **THEN** the contract cases are run repeatedly and valid marker leakage and missed transformations are reported

### Requirement: rb-6 — Comparison discipline: Identify changed variables
WHEN a study compares candidates, THE benchmark SHALL record which of model, reasoning effort, base prompt, Blark prompt, Borg prompt, dataset, and evaluator changed and SHALL prefer one-variable comparisons for causal conclusions.

#### Scenario: Multiple variables differ
- **WHEN** two candidates differ in more than one recorded dimension
- **THEN** the report labels the result as a configuration comparison and does not attribute the difference to one component without additional evidence
