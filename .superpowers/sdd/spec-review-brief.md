# Spec review: add-sdd-task-analyzer

You are a READ-ONLY specification reviewer. Do NOT modify files, do NOT run
tests or builds. Read files only.

Review the OpenSpec change `add-sdd-task-analyzer` in this repository as an
architecture/specification gate before implementation.

Read, in order:
- openspec/changes/add-sdd-task-analyzer/proposal.md
- openspec/changes/add-sdd-task-analyzer/design.md
- openspec/changes/add-sdd-task-analyzer/specs/task-analyzer-sdd-annotations/spec.md
- openspec/changes/add-sdd-task-analyzer/specs/task-analyzer-data-gathering/spec.md
- openspec/changes/add-sdd-task-analyzer/specs/task-analyzer-cost-model/spec.md
- openspec/changes/add-sdd-task-analyzer/specs/task-analyzer-decomposition-agent/spec.md
- openspec/changes/add-sdd-task-analyzer/tasks.md

Background context (skim as needed): the design operationalizes a prior
analysis living in analysis/sdd-model-analysis/ (rubrics.md, findings.md,
scripts/). The xagent dispatch tool is projects/xagent. Transcript sources are
~/.codex/sessions and ~/.claude/projects (outside the repo; take the design's
word for their formats).

Focus areas:
1. Schema soundness (design D2): keys, nullability, whether the cache-key
   scheme (rubric_version + input_sha256) actually supports rescoring and
   idempotency as claimed; anything underspecified that would bite during
   implementation.
2. Idempotency/atomicity story (D3): holes in the staging/resume design;
   discovery diff correctness; landed-only semantics.
3. Cost attribution (D5): is the review-round/followup_fix mechanical rule
   well-defined for edge cases (multiple implementers, aborted sessions,
   re-reviews without fixes)?
4. Estimator (D6): is NIG-on-log-cost with pooled prior coherent as specced?
   Is what's persisted sufficient to reproduce quantiles and Thompson
   sampling deterministically?
5. Spec/requirement quality: contradictions between spec files, scenarios
   that are untestable as written, missing requirements the tasks.md implies.
6. Task list: ordering/dependency errors, missing verification steps.

Report format:
- Numbered findings, each: severity (Critical / Important / Minor), file,
  what's wrong, concrete suggested fix.
- End with exactly one line: `VERDICT: APPROVE` or `VERDICT: REVISE` (REVISE
  only if there is at least one Critical or Important finding).
