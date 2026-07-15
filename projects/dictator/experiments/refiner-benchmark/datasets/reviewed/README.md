# Human-reviewed cases

This directory contains only cases whose desired output has been explicitly
approved by the user. A model judge, an awkwardness ranking, inclusion in a
review report, or an output the user merely lived with does not make a case
golden.

The July 13 awkward-dictation examples remain review candidates, so this set
is intentionally empty. Promote a candidate with `review_cases.py` only after
recording the user's judgment and provenance.

The promotion command requires an exact expected output plus reviewer,
timestamp, and source provenance, and rejects conflicting reuse of a case ID:

```sh
python3 projects/dictator/experiments/refiner-benchmark/review_cases.py \
  --id awkward-001 \
  --raw 'I I need the deploy script.' \
  --expected 'I need the deploy script.' \
  --approved-by joyo \
  --approved-at 2026-07-15T16:00:00Z \
  --source 'projects/dictator/docs/experiments/2026-07-13-awkward-dictation-review.md#1'
```
