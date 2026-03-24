# Main Quest

- Main Quest: `memory_model`
- Path: `../../main_quests/memory_model/`
- Reason Split Out: Isolate a small, focused refinement to state-context file
  presentation without reopening the larger memory-model implementation.
- Source Issue: `State context currently presents file contents as generic
  "read" content and does not surface operation-aware wording (`read`, `write`,
  `patch`) or explicit deferred-content notes when content injection is delayed.`
