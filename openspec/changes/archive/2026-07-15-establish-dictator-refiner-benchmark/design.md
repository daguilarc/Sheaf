## Context

The July 13 refiner study used 756 historical Whisper interactions, a 45-case synthetic suite, repeated marker trials, two model judges, and manual review. The reusable harness, prompts, and reports currently live in untracked project directories; roughly 17 MB of source extracts, responses, judge traces, and rankings live under ignored `data/dictator-refiner-benchmark/` in a managed worktree that may be deleted.

The historical corpus is valuable as a distribution sample, but its existing refined outputs are merely outputs the user lived with. They are not approved targets. The study selected Luna-low plus a conservative prompt family, while production remains GPT-4.1-mini because `OpenAIRefinementEngine` cannot express reasoning effort.

The data includes personal dictation and complete third-party API responses. Durability must therefore be separated from Git tracking: a tracked experiment definition should identify private local artifacts without committing the full corpus or traces.

## Goals / Non-Goals

**Goals:**

- Make the completed exploration understandable and reproducible without rerunning it.
- Give future studies a stable layout, manifest format, naming scheme, and comparison gates.
- Preserve raw personal artifacts in a persistent ignored data location while tracking the harness, prompt versions, synthetic cases, selected reviewed cases, aggregate summaries, and reports.
- Allow Dictator to send an explicit optional OpenAI reasoning effort and thereby reproduce Luna-low.
- Describe a reversible rollout from the current configuration to Luna-low and the chosen prompt set.

**Non-Goals:**

- Treat historical refined outputs or model-judge preferences as ground truth.
- Rerun existing model calls, regenerate reports, or rewrite the completed study.
- Commit the full personal transcript corpus or raw response/judge traces.
- Switch the production model or prompts in the reasoning-plumbing implementation step.
- Make Blark and Borg deterministic in this change; that remains follow-up architecture work.

## Decisions

### 1. Use a tracked definition/private evidence split

Tracked files live under:

```text
projects/dictator/experiments/refiner-benchmark/
  README.md
  benchmark.py
  rank_awkwardness.py
  datasets/
    synthetic.jsonl
    reviewed/
  prompts/
  studies/
    2026-07-13-refiner-study/
      manifest.json
      summary.json
```

Human-readable reports remain under `projects/dictator/docs/experiments/`. A selected personal example is tracked only when deliberately promoted into a reviewed dataset or report; the uncurated corpus stays private.

Raw local evidence lives under the canonical operator checkout's ignored data directory:

```text
data/dictator/experiments/refiner-benchmark/
  2026-07-13-refiner-study/
    inputs/
    runs/
    judgments/
    analyses/
```

This is preferred over committing every trace, which would expose personal dictation and grow the repository, and over leaving the data in the current managed worktree, which is not durable.

### 2. Treat studies and outputs as immutable

Each study gets a date-and-name identifier. Existing result files are copied without rewriting their contents. A rerun creates a new run ID or study rather than overwriting evidence. Temporary files and `__pycache__` are ignored.

### 3. Use a manifest as the reproducibility boundary

The tracked manifest records:

- schema version and study ID;
- source partition names, record counts, content hashes, and private relative paths;
- harness and prompt paths plus content hashes;
- run ID, requested/returned model, reasoning effort, timestamp, result count, errors, latency/token aggregates, and raw-result hash;
- evaluator model, reasoning effort, candidate label randomization, judgment count, and judgment hash;
- links to aggregate summary and human-readable reports;
- an explicit dataset status such as `distribution-sample`, `synthetic-contract`, or `human-reviewed`.

The manifest does not contain secrets or bulk transcript content. Hashes detect missing or mutated local evidence without pretending it is portable through Git.

### 4. Evaluate three different kinds of evidence separately

- Historical distribution samples measure edit distance, latency, model-judge preferences, and suspicious semantic changes. They do not have target-output accuracy.
- Synthetic contract cases have explicit expected behavior for fidelity, undo handling, ASR-like errors, and marker syntax; repeated trials expose stochastic failures.
- Human-reviewed disagreements are small golden cases created only after the user explicitly judges a transformation.

Comparisons change one of model, reasoning effort, or prompt set at a time where practical. Safety review prioritizes invented identifiers, commands, paths, numbers, negation/polarity changes, and confident rewrites of ambiguous speech.

### 5. Make reasoning effort optional and typed

Add `reasoning_effort` as an optional runtime config value represented by a closed Swift enum containing the efforts exercised by the benchmark (`none`, `low`, `medium`, `high`, `xhigh`, and `max`). Missing configuration remains `nil` and omits the entire `reasoning` member from the OpenAI request, preserving compatibility with GPT-4.1-mini.

When configured, `LLMRuntimeConfiguration` carries the value to every OpenAI engine construction path, and the Responses API body includes:

```json
"reasoning": { "effort": "low" }
```

The application validates the vocabulary but does not hard-code a model-to-effort compatibility table because that external capability changes independently. An unsupported model/effort combination remains an explicit OpenAI request error rather than being silently altered.

### 6. Roll out Luna-low as a separate reversible configuration step

After reasoning plumbing is verified:

1. Copy the selected conservative, Blark, and Borg prompt files into the production prompt catalog without changing the historical experiment versions.
2. Set `cloud_model` to `gpt-5.6-luna`, `reasoning_effort` to `low`, and the production prompt paths to the selected prompt set.
3. Record model, reasoning effort, and prompt hashes with each interaction so a production regression can be traced.
4. Smoke-test ordinary fidelity, self-correction, ASR repair, malformed markers, valid Blark, and semantic Borg cases.
5. Roll back by restoring the previous model/prompt configuration; the optional reasoning field can be removed or left unset for GPT-4.1-mini.

The prompt version chosen for production must match the final human decision. The study initially recommended conservative v3 and later evaluated a Claude-informed v4; the rollout task must resolve that naming/selection explicitly rather than inferring from filenames.

## Risks / Trade-offs

- **Private evidence is not cloned with Git** → Keep it in the persistent canonical checkout, record hashes/counts in Git, and document backup expectations in the benchmark README.
- **A model judge can reward polished rewrites** → Keep judge scores secondary to fidelity controls, semantic-landmine review, and explicit human-reviewed disagreements.
- **Historical outputs can be mistaken for labels** → Store dataset status in manifests and forbid accuracy claims for the distribution sample.
- **Optional reasoning can be configured for an unsupported model** → Validate the effort vocabulary and surface the provider error without silently dropping the request field.
- **Prompt filenames can obscure the selected version** → Preserve immutable experiment prompt versions and use explicit production filenames plus hashes in the rollout manifest.
- **Tracking selected passages exposes some personal text** → Promote examples deliberately; keep all unselected transcripts and traces ignored.

## Migration Plan

1. Add and test the optional reasoning-effort configuration path while leaving the live model and prompts unchanged.
2. Copy the existing ignored study artifacts into the persistent canonical data hierarchy; verify counts and SHA-256 hashes before deleting no source copies.
3. Add the README, tracked study manifest, aggregate summary, prompt versions, synthetic suite, reviewed cases, and existing reports.
4. Resolve the final production base-prompt version, install the selected prompt set, and switch configuration to Luna-low in one reviewable change.
5. Run a focused local smoke test and retain the old configuration as the immediate rollback.

## Open Questions

- Whether the production base prompt should use conservative v3 or the Claude-informed v4 after the semantic-landmine review.
- Whether OpenAI requests should also set `store: false`; this affects external retention rather than benchmark quality.
- Which private-data backup mechanism should protect the canonical ignored study directory from local disk loss.
- Whether Blark/Borg parsing should become a separate deterministic preprocessing capability before reconsidering Luna with reasoning disabled.
