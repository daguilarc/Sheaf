# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T23:27:06Z
- updated_at: 2026-06-08T23:27:06Z
- title: Stop-node canonicalization is inconsistent (alias vs node_map produce different stored node_name)
- details: ## Problem

`validate_stop_condition` in `experiments.py` does not produce a single canonical
node identifier. It accepts three input forms for the slice-completion node but
stores two different values:

- `--stop-node slice_completed` -> short-circuits via `_STOP_NODE_ALIASES`
  (`{"slice_completed": "slice_completed"}`) and stores `node_name = "slice_completed"`.
- `--stop-node Completed` -> matches the slice `node_map` key and stores
  `node_name = "Completed"`.
- `--stop-node SliceCompletedNode` -> matches the node class name and stores
  `node_name = "Completed"`.

So three inputs that all designate the same workflow node are persisted into
`experiment.json` as two distinct `stop_condition.node_name` values
(`"slice_completed"` vs `"Completed"`).

## Why this is a problem

1. It deviates from the slice physical plan, which states the alias
   `slice_completed` should be "mapped to `SliceCompletedNode`" and that the
   function must "Return the canonical node name stored in metadata." The current
   code returns the raw alias string, which is neither a `node_map` key nor a node
   class name, so there is no single canonical form.
2. The spec requires `stop_condition` to "identify a node in the workflow graph
   deterministically." Persisting two different strings for one node weakens that
   guarantee and pushes an unnecessary normalization burden onto the
   experiment-execution slice (slice 3), which must compare the configured stop
   node against the live runtime node. A matcher that checks `node_map` keys/class
   names will not match `"slice_completed"` without re-applying the alias, and a
   matcher built around `"slice_completed"` will not match experiments created via
   `--stop-node Completed`. This is a latent stop-condition-matching hazard.

Note the tension to resolve: the spec's example `experiment.json` literally shows
`"node_name": "slice_completed"`, while the physical plan asks for the canonical
node class. Either choice is defensible, but the implementation must pick ONE
canonical representation and apply it to all equivalent inputs.

## Test gap

`ExperimentStopConditionTests` only covers the `slice_completed` alias and an
unknown-node rejection. There is no test asserting what `--stop-node Completed` or
`--stop-node SliceCompletedNode` resolves to, so the divergence above is not pinned
down by tests.

## What must be true to close

- `validate_stop_condition` returns a single canonical `node_name` for all input
  forms that designate the same node (e.g. `slice_completed`, `Completed`, and
  `SliceCompletedNode` all yield the same stored value), OR the chosen
  non-canonical storage (`slice_completed`) is explicitly documented as the
  canonical persisted form with the alias map updated so node_map/class inputs for
  that node normalize to it too.
- A test asserts the resolved `node_name` for at least the non-alias input form(s)
  of the slice-completion node, locking in the canonicalization decision.
- resolution_notes: none
