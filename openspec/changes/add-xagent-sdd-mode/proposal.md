## Why

Superpowers SDD currently makes each controller combine prompt rendering, raw
xagent MCP calls, session reuse, and report handling by hand. That leaves the
most important workflow contracts easy to shorten or skip and provides no
queryable record of which brief, agent assignment, follow-up, and report drove
each task decision.

## What Changes

- Add an opinionated, MCP-only xagent SDD API for starting implementers and
  reviewers, sending fix and re-review follow-ups to the same sessions, awaiting
  results, and closing sessions.
- Accept structured arguments analogous to `dispatch-prompt`, then render the
  complete role prompt automatically while preserving explicit brief-file and
  report contracts.
- Add a SQLite SDD ledger that records every initial dispatch and follow-up,
  including plan, task, agent/model, harness, effort, role, xagent run ID,
  copied brief, durable event cursors, and the sanitized report before that
  report is returned to the lead controller.
- Treat xagent supervision sequence numbers as the supported durable cursor;
  do not claim or synthesize a provider JSONL byte or line position.
- **BREAKING** Change the OpenSpec Superpowers workflow guidance from mixed
  native/raw-xagent transport to the xagent SDD MCP API for all Superpowers SDD
  implementation, review, fix, and re-review dispatches.
- Update the xagent plugin skill to require the SDD API for Superpowers SDD
  while retaining the generic xagent MCP API for non-SDD delegation.

## Capabilities

### New Capabilities

- `xagent-sdd-workflow`: Opinionated SDD MCP dispatch, prompt rendering,
  persistent-session follow-ups, report-before-return semantics, and the SQLite
  dispatch ledger.

### Modified Capabilities

- `xagent-service`: Extend the discoverable service MCP surface with the
  xagent SDD tools while retaining the generic supervision tools.
- `agents-skill-distribution`: Require the OpenSpec Superpowers workflow and
  plugin-provided xagent skill to route Superpowers SDD through the opinionated
  MCP API.

## Impact

- Affects `projects/xagent/src/service/`, xagent service tests and documentation,
  the packaged xagent plugin skill, and its packaging/install checks.
- Adds `better-sqlite3` as an xagent runtime dependency while retaining the
  existing Node 20 engine floor.
- Reuses the prompt-rendering behavior at
  `projects/agents/utils/dispatch-prompt` and adds integration coverage that
  detects drift from installed Superpowers role templates.
- Makes Python 3, the trusted renderer in the xagent service checkout, and the
  installed Superpowers template tree explicit SDD-service prerequisites.
- Updates the canonical
  `projects/agents/global/skills/openspec-superpowers-workflow/` source and
  agents installer tests; generated skill copies remain installer outputs.
- Adds a local SQLite database under the xagent service's configured log root.
  No network service or provider transcript scraping is introduced.
