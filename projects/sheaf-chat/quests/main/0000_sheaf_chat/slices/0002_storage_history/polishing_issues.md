# Issues

## Issue PL-0001

- status: open
- owner_role: polisher_reviewer
- created_at: 2026-06-08T21:25:30Z
- updated_at: 2026-06-08T21:25:30Z
- title: WithSessionLock cleanup is dead code; x_sequenceLocks grows unbounded
- details: ## Problem

`WithSessionLock` in `src/storage/sessionLog.ts` (lines ~37-66) contains a
cleanup branch that can never execute, causing `x_sequenceLocks` to grow without
bound for the lifetime of the process.

The relevant code:

```ts
const previous = x_sequenceLocks.get(key) ?? Promise.resolve();
let release!: () => void;
const current = new Promise<void>((resolve) => { release = resolve; });
x_sequenceLocks.set(key, previous.then(() => current));   // stores a chained promise
await previous;
try { return await operation(); }
finally {
  release();
  if (x_sequenceLocks.get(key) === current) {   // <-- never true
    x_sequenceLocks.delete(key);
  }
}
```

The value stored under `key` is `previous.then(() => current)`, a NEW promise
returned by `.then(...)`. `x_sequenceLocks.get(key)` therefore returns that
chained promise, which is never reference-equal to the raw `current` promise. As
a result the `delete(key)` branch is dead code and the map entry for every
distinct `(pile, sessionId)` that has ever been appended to is retained forever.

## Why it is a problem

- Unbounded memory growth in a long-running server: one retained (resolved)
  promise per session key for the whole process lifetime. The backend is
  explicitly a long-lived service keyed by `(pile, sessionId)` (see Agent
  Lifecycle in the spec), so the set of keys grows with every session ever
  touched and is never released.
- The dead-code cleanup also signals incorrect intent: a future maintainer will
  assume the map self-prunes when idle, when it does not.

Serialization itself is correct — each call awaits `previous` and chains the new
tail — so sequence monotonicity is unaffected. The defect is purely the leak /
dead cleanup branch.

## What must be true to close

- The lock map must not retain entries indefinitely for idle sessions; once no
  operation is queued for a key, its entry should be removable (i.e. the cleanup
  condition must actually be reachable for the tail of the chain).
- A correct fix typically compares against the exact promise stored as the tail,
  e.g. `const chained = previous.then(() => current); set(key, chained); ...;
  if (get(key) === chained) delete(key);`, or an equivalent tail-tracking
  approach. The reviewer will verify the cleanup branch is now reachable and that
  serialization / monotonic sequencing remains intact.
- Existing sequence/append tests must still pass and continue to demonstrate
  monotonic allocation under serialized appends.
- resolution_notes: none
