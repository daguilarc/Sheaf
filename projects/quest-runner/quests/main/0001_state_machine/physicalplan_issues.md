# Issues

## Issue QP-0001

- status: open
- owner_role: physical_plan_reviewer
- created_at: 2026-06-09T21:23:36Z
- updated_at: 2026-06-09T21:23:36Z
- title: Unified collection scaffold must pin exact byte content and file set to preserve slice-init compatibility
- details: WHAT IS WRONG

Slices 0001 and 0006 unify slice scaffolding into a single workflow collection `scaffold` action list (per spec 07 lines 199-217: SliceSetup and slices-init share the same actions). But the plans do not pin the exact byte content of the scaffolded files, and they disagree with spec 05/07 on the file set. The current runner already has TWO divergent scaffold paths, so the unified list must deliberately choose one and match committed bytes.

Concrete current behavior (verified in source and real history):
1. slices-init CLI (quest_service.py:1868-1899) creates: physicalplan/ (mkdir), state.md, state_history.md, polishing_issues.md. state_history.md content = "# State Transition History\n\n" (TWO trailing newlines). It does NOT create notes/. created_files payload = [physicalplan, state.md, state_history.md, polishing_issues.md].
2. scaffold_slice_dir() / SliceSetup (quest_runner.py:976-989) defensively creates (only-if-missing) state.md, state_history.md, polishing_issues.md, and notes/. state_history.md content = "# State Transition History\n" (ONE trailing newline). It does NOT create physicalplan/.
3. Real committed history confirms the slice-init form: quests/main/0000_experiments/slices/0001_experiment_foundation/state_history.md = "# State Transition History\n\n".

PROBLEMS

A) state_history.md byte content. Spec 05's collection-scaffold example and the slice 0001 plan reference "# State Transition History\n" (one newline). If the default collection scaffold ships that, new slices-init-committed state_history.md will differ by one byte from current real history (\n\n). The compatibility contract (spec 07 line 23: 'state_history.md created exactly as today') and the slice 0008 verification matrix ('state_history.md creation behavior') will fail a byte/golden comparison. The plan must pin the scaffold content to "# State Transition History\n\n".

B) physicalplan/ in scaffold. Slice 0001 (line 40) and slice 0006 (lines 110-115) include physicalplan/ in the collection scaffold and created_files. Spec 05 and spec 07 collection-scaffold lists OMIT physicalplan/. Because the unified scaffold is used by BOTH slices-init and SliceSetup, this is contradictory: including it makes SliceSetup newly create physicalplan/ (current SliceSetup does not); omitting it makes slices-init stop creating physicalplan/ and changes the created_files payload. The plan must explicitly resolve whether physicalplan/ is a scaffold action and state the intended created_files payload.

C) notes/ addition. The unified scaffold adds notes/ to slices-init (current slices-init does not create it). This changes the created_files payload from [physicalplan, state.md, state_history.md, polishing_issues.md] to include notes/. This may be acceptable (notes/ is empty/untracked), but the plan should state it as an intentional, tested payload change so slice 0006 test expectations are unambiguous.

WHY IT MATTERS

The scaffold list is workflow data driving both the CLI and the in-machine repair. Ambiguous/contradictory byte content and file set will cause implementation churn and will fail the compatibility/golden tests that slice 0008 mandates.

WHAT MUST BE TRUE TO CLOSE

- Slice 0001 (and 0006) pin the exact byte content of each scaffolded file, with state_history.md = "# State Transition History\n\n" to byte-match current committed history (or explicitly justify a different value as an accepted change).
- The plans resolve physicalplan/ inclusion in the collection scaffold consistently with spec 05/07, and state the resulting slices-init created_files payload.
- The plans state explicitly that adding notes/ (and any physicalplan/ change) to slices-init is an intended payload change, so slice 0006 tests assert the agreed set.
- resolution_notes: none
