# Issues

## Issue PR-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-06T20:20:00Z
- updated_at: 2026-06-06T20:20:00Z
- title: Registry test asserts exact service count, will break when more services register
- details: >
    `tests/scaffold.test.ts` (test "loadServiceRegistry reads the conductor
    service entry") includes `assert.equal(services.length, 1)`. The entire
    purpose of the Conductor project is to manage multiple registered services,
    and `config/services.json` is the single shared registry that later quests
    and projects will add entries to. As soon as any second service is registered
    (which is the expected, intended evolution of this repo), `npm test` in
    `projects/conductor` will fail on this assertion even though the conductor
    entry and the registry loader are still correct. This turns a normal,
    unrelated config change into a spurious test failure / latent regression trap.
    The meaningful assertion in this test — that the conductor entry exists with
    the exact expected shape — is already fully covered by
    `findServiceByName(...)` plus the `assert.deepEqual(conductor, expected)`
    check, so the exact-length assertion adds brittleness without adding coverage.
- resolution_notes: none

  To mark completed: the test must no longer fail when additional, unrelated
  service entries exist in `config/services.json`. Acceptable fixes include
  removing the `services.length === 1` assertion (relying on the existing
  `findServiceByName` + `deepEqual` checks), or replacing it with an assertion
  that does not break on added entries (e.g. asserting `services.length >= 1`, or
  asserting exactly one entry named `conductor`). The conductor-entry shape check
  must remain.
