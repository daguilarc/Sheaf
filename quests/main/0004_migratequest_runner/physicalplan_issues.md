# Issues

## Issue QP-0001

- status: open
- owner_role: physical_plan_reviewer
- created_at: 2026-06-06T00:00:00Z
- updated_at: 2026-06-06T00:00:00Z
- title: Test-migration ownership and slice-0001 validation gate conflict
- details: |
  Slice 0001 ("Scaffold Inventory And Source Import") lists "Quest-runner tests
  under /Users/joyo/conductor/tests/: all tests except service-manager-only
  coverage" as source to migrate in this slice, and its Validation section makes
  `make -C projects/quest-runner test` a gate. However, slices 0002, 0003, 0004,
  and 0005 each also claim to migrate specific test modules
  (e.g. slice 0004 "REST/dashboard tests migrated from test_dashboard_api.py,
  test_dashboard_shell.py, test_quest_service.py", slice 0003 "Tests migrated
  from test_quest_runner.py ..."). This creates two problems:

  1. Double ownership: it is ambiguous which slice actually migrates and adapts
     each test file. The implementer cannot tell from slice 0001 whether to copy
     all tests now or defer per-slice.
  2. Broken validation gate: api.py is explicitly not migrated in slice 0001
     ("api.create_app should be replaced by a quest-runner-only REST app in
     slice 4"), and ServiceManager/db are never migrated. Tests such as
     test_dashboard_api.py, test_dashboard_shell.py, and test_quest_service.py
     depend on api.create_app(manager, quest_service) and on
     ServiceManager/db. If they are copied in slice 0001, `make test` will fail
     at import/collection time, so the slice-0001 validation gate cannot pass as
     written. The "tests that pass before path-model rewrites" hedge does not
     resolve which files are in scope for slice 0001.
- resolution_notes: |
  To close: the plan must make test-migration ownership explicit and consistent.
  Either (a) restrict slice 0001 to copying only source modules plus the subset
  of tests that are runnable without api/service code (filesystem, state machine,
  commit metadata, harness/thread, normalized state), and assign each remaining
  test module to the slice that introduces its dependency; or (b) keep all tests
  copied in slice 0001 but define a concrete, non-failing validation gate for
  slice 0001 (e.g. a named focused test subset) and explicitly mark the
  api/service/dashboard tests as collected-but-skipped until their owning slice.
  The slice plans must not both assign the same test file to slice 0001 and to a
  later slice without stating the adaptation hand-off.

## Issue QP-0002

- status: open
- owner_role: physical_plan_reviewer
- created_at: 2026-06-06T00:00:00Z
- updated_at: 2026-06-06T00:00:00Z
- title: Runtime quest-schema docs (quest_docs_dir) have no concrete project-local home and conflict with slice-0006 docs rewrite
- details: |
  The runner injects the quest documentation directory (currently
  /Users/joyo/conductor/docs/quest, containing schemas.md and workflow rules)
  into role prompts at runtime as the "stable reference for quest schemas, file
  formats, and workflow rules". Slice 0003 passes a `quest_docs_dir` into the v2
  runner, and slice 0001 lists docs/quest/** as migration source "for
  project-local documentation AND runtime quest schema prompts", so the dual use
  is acknowledged. However:

  1. No slice defines the concrete project-local location where the
     runtime-injected quest schema docs live (the value `quest_docs_dir`
     resolves to). Slice 0001 relocates roles concretely
     (Path(__file__).resolve().parent / "roles") and bundles the default
     execution config, but gives no equivalent concrete home for the quest
     schema docs. Slice 0003 references `quest_docs_dir` without saying where it
     points.
  2. Slice 0006 plans to rewrite docs/quest/** into Sheaf doc-structure format
     (docs/reference/*, docs/explanation/*, docs/how-to/*). If the same files
     serve as the runtime prompt-injected schemas, rewriting them to Sheaf
     human-doc format would silently change the schema text that agents depend on
     and could break runtime behavior. The plan does not separate "runtime
     prompt schema docs (frozen content, bundled with the package)" from
     "human-facing project docs (rewritten to Sheaf format)".
- resolution_notes: |
  To close: the plan must (a) specify a concrete, deterministic project-local
  path that `quest_docs_dir` resolves to (analogous to the bundled roles dir and
  default execution config), so the migrated runner has no runtime dependency on
  /Users/joyo/conductor; and (b) explicitly distinguish the runtime-injected
  quest schema docs from the human-facing docs rewritten in slice 0006, so the
  slice-0006 rewrite cannot alter the prompt-injected schema content the runner
  relies on. State which slice bundles the runtime schema docs and confirm
  slice 0006's doc rewrite targets only the human docs tree.
