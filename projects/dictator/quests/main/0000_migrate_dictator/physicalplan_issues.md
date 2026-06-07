# Issues

## Issue QP-0001

- status: completed
- owner_role: physical_plan_reviewer
- created_at: 2026-06-07T00:00:00Z
- updated_at: 2026-06-07T16:00:00Z
- title: No plan to gitignore Swift/Xcode build artifacts; conflicts with clean-tree runner requirement
- details: |
    None of the six slice plans add or update `.gitignore` to exclude the
    Swift/Xcode generated build outputs that implementation will produce. I
    verified the repo-root `.gitignore`: it ignores `node_modules/`, `dist/`,
    `data/**`, `logs/**`, `config/api_keys.json`, and specific project paths,
    but it does NOT ignore `.build/`, `.swiftpm-module-cache/`, Xcode
    DerivedData (slice 5 proposes `.build/xcode`), or the iOS `build/`,
    `*.swiftmodule`, `*.xctest`, etc.

    Meanwhile the Validation sections of slices 1-5 all run `swift build`,
    `swift test`, and `xcodebuild`, which generate these artifacts under
    `projects/dictator/`.

    Why this is a problem:
    - Per the quest schema (Execution Config rules), the runner refuses to
      invoke a harness when the working tree is not fully clean, including
      untracked files, and after each turn reverts changes outside the role's
      allowed paths.
    - The `implementer` profile's `modify_block` is only
      `$currentProject/quests/**`, so a generated `.build/` tree is
      untracked-but-allowed. It would either leave the working tree dirty and
      block the next step, or get committed as part of slice work, which the
      spec's "Cleanup Requirements" and "Non-Goals" explicitly forbid
      (`.build/`, `.swiftpm-module-cache/`, `build/` must not be carried into
      Sheaf).
    - Slice 6's cleanup plan only *removes* generated files at the end of the
      quest; it does not prevent dirty-tree blockage or accidental commits
      during slices 1-5. This is a hidden risk likely to cause implementation
      churn or hard stops.
- resolution_notes: |
    To resolve: at least one slice plan (most naturally slice 1 for the Swift
    package, with the iOS DerivedData path handled in slice 5) must explicitly
    plan to add `.gitignore` coverage for the generated Swift/Xcode build
    artifacts the spec lists as non-migratable — at minimum `.build/`,
    `.swiftpm-module-cache/`, the chosen Xcode DerivedData path (e.g.
    `.build/xcode`), and iOS `build/` / `*.xctest` / `*.swiftmodule` outputs —
    either at repo root or as `projects/dictator/.gitignore`, so that running
    `swift build`, `swift test`, and `xcodebuild` leaves the working tree
    clean. The issue stays open until a plan keeps these outputs out of source
    control *during* implementation, not only removed at the end.

    Resolved 2026-06-07: Verified against the revised plans. Slice 1
    Implementation Notes now create `projects/dictator/.gitignore` before any
    SwiftPM/Xcode validation, with patterns covering `.build/`,
    `.swiftpm-module-cache/`, `.swiftpm/`, `DerivedData/`, `build/`, `*.app`,
    `*.appex`, `*.xctest`, `*.swiftmodule/.swiftdoc/.swiftsourceinfo/.abi.json`,
    object/dependency files, `*.hmap`, and `XCBuildData`. Slice 5 lists the
    project-local `.gitignore` as a file to update and requires verifying/
    extending Xcode-output coverage before `xcodebuild`. Slice 6 documents that
    this ignore coverage (created in slice 1, extended in slice 5) prevents
    artifacts from dirtying the worktree during validation, separate from
    end-of-quest cleanup. All three slices add `git check-ignore` and
    `git status --short projects/dictator` validation, and the
    generated-artifact static checks now use `git ls-files` so locally present
    but ignored build outputs are not falsely treated as migrated source. This
    fully addresses the clean-tree/accidental-commit risk during slices 1-5.
