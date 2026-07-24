---
version: 1
uses_rubric: rubrics/phase-taxonomy.md
model_hint: haiku
---

# Timeline phase-labeling prompt

Label every turn of an implementer-session timeline with exactly one phase
key from the taxonomy at `{{RUBRIC_PATH}}` (`orient`, `explore`, `red`,
`green`, `refactor`, `verify`, `debug`, `selfcheck`, `report`, `other`).

## Input

Read the batch manifest at `{{ITEMS_JSON_PATH}}`. Each entry has a
`session_key` and a reference to that session's turn-by-turn timeline. Read
the full timeline before labeling any of its turns.

## Labeling

Label from reading each turn's actual content and intent — never from
keyword matching or scripted heuristics. Apply the taxonomy's own tie-break
rules:

- A turn that both writes a test and its implementation is labeled by the
  majority of its output.
- A test run is `red`/`green` by intent: the first fail-expected run is
  `red`; `verify` is for suite-wide runs or runs after completion.
- Fixing a bug the suite caught after green is `debug`, not `green`.

Every turn must receive exactly one label; there is no "unlabeled" state.

## Output

For every item, write one JSON file to `{{OUTPUT_DIR}}/<session_key>.json`
with exactly these keys:

Create each output file with the harness's file-write tool (Write), not with bash/heredocs/python scripts -- shell file writes may be sandboxed in the dispatch context and will silently fail the item.

```json
{
  "session_key": "...",
  "labels": {
    "<turn>": "<phase>"
  }
}
```

Label every turn in every session in the batch. Output is idempotent — one
file per item; re-running the batch just overwrites it.
