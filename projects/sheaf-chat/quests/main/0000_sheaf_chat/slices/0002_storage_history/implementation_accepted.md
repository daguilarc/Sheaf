# Slice 0002 Implementation Accepted

## Summary

The persistent storage layer (piles, session manifests, sequenced chat
envelopes, and paged history) is implemented correctly and completely against the
slice spec and physical plan. All polishing issues are resolved.

## Verification

- **Paths & validation** — pile names and session IDs validated as safe single
  path segments with traversal, reserved-name, slash/backslash, and Unicode NFC
  rejection. Symlink-aware containment enforced via `realpath` in
  `AssertPathWithinRoot`. Storage layout matches the spec
  (`data/sheaf-chat/sessions/piles/<pile>/`).
- **Manifests** — initial manifest creation is deferred (verified by test and
  by `AppendEnvelope` tolerating `manifest_not_found`); schema matches the spec;
  `rootDirectory` resolved to absolute; newest-first listing; identity checked on
  read.
- **Session log & sequencing** — single allocator (`AppendEnvelope`) with
  per-session serialization and monotonic-sequence enforcement; Sheaf Chat
  envelopes stored in a companion `.sheaf-history.jsonl` file (permitted by the
  plan) keeping Pi JSONL isolated for slice 5.
- **History** — non-blocking streaming reads with `before` / `after` / latest
  semantics; the read-while-appending test confirms appenders are not blocked.
- **Tests** — coverage maps to every item in the plan's validation list.

## Resolved Issues

- **PL-0001** (completed) — `WithSessionLock` cleanup was dead code, leaking
  `x_sequenceLocks` entries unbounded. Fixed by capturing the chained tail promise
  and comparing against it before deleting the idle session key. Verified the
  cleanup branch is now reachable and that append serialization and monotonic
  sequence allocation are preserved (confirmed via the A→B concurrency reasoning
  and unchanged sequence/history tests).

No open issues remain.
