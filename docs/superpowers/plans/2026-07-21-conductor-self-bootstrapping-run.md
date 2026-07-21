# Conductor Self-Bootstrapping Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the registered `make conductor-run` command install Conductor's declared local npm dependencies, build its TypeScript output, and start successfully on a fresh Mac.

**Architecture:** Reuse the existing `install`, `build`, and `run` Makefile targets by expressing their ordering as Make dependencies. Pin the behavior with a static test in Conductor's existing Node test suite, then update the active OpenSpec capability and operational documentation.

**Tech Stack:** GNU Make, npm, Node.js >= 20, TypeScript, Node's built-in test runner, OpenSpec.

## Global Constraints

- Use project-local `npm install`; do not globally install `ws` or other manifest dependencies.
- Do not add a new bootstrap script or root-level installation framework.
- Preserve `start_conductor.sh` as the launcher and log router.
- A failed install or build must prevent Conductor from launching and retain the native diagnostic.

---

### Task 1: Pin and implement self-bootstrapping run ordering

**Files:**
- Modify: `projects/conductor/tests/scaffold.test.ts`
- Modify: `projects/conductor/Makefile`

**Interfaces:**
- Consumes: existing Make targets `install`, `build`, and `run`
- Produces: `run: install build`, used by root target `make conductor-run`

- [ ] **Step 1: Bootstrap the test toolchain through the existing installer**

Run: `make -C projects/conductor install`

Expected: npm creates `projects/conductor/node_modules` from `package-lock.json`, including `ws`, and exits 0.

- [ ] **Step 2: Write the failing Makefile workflow test**

Add to `projects/conductor/tests/scaffold.test.ts`:

```typescript
test("registered run target bootstraps local dependencies and build", async () =>
{
  const makefileUrl = new URL("../../Makefile", import.meta.url);
  const makefile = await readFile(makefileUrl, "utf8");
  const runDeclaration = makefile
    .split("\n")
    .find((line) => line.startsWith("run:"));

  assert.equal(runDeclaration, "run: install build");
});
```

- [ ] **Step 3: Run the focused test to verify RED**

Run: `npm --prefix projects/conductor test -- --test-name-pattern="registered run target"`

Expected: FAIL because the actual declaration is `run:`.

- [ ] **Step 4: Implement the minimal Makefile dependency change**

Change `projects/conductor/Makefile` from:

```make
run:
	bash start_conductor.sh
```

to:

```make
run: install build
	bash start_conductor.sh
```

- [ ] **Step 5: Run the focused test to verify GREEN**

Run: `npm --prefix projects/conductor test -- --test-name-pattern="registered run target"`

Expected: PASS.

- [ ] **Step 6: Run the full Conductor suite**

Run: `npm --prefix projects/conductor test`

Expected: all Conductor tests pass.

### Task 2: Synchronize documentation and capability contract

**Files:**
- Modify: `projects/conductor/README.md`
- Modify: `projects/conductor/docs/operations.md`
- Modify: `openspec/changes/configure-dictator-launchpad-model/proposal.md`
- Modify: `openspec/changes/configure-dictator-launchpad-model/design.md`
- Modify: `openspec/changes/configure-dictator-launchpad-model/tasks.md`
- Create: `openspec/changes/configure-dictator-launchpad-model/specs/conductor-service-management/spec.md`
- Modify: `openspec/specs/conductor-service-management/spec.md`

**Interfaces:**
- Consumes: `run: install build` behavior from Task 1
- Produces: requirement `svc-25` and fresh-Mac operator instructions

- [ ] **Step 1: Update operational documentation**

Make `make conductor-run` the primary quick-start command. State that it runs project-local `npm install`, `npm run build`, and `start_conductor.sh`; keep the explicit npm commands documented as equivalent diagnostic steps.

- [ ] **Step 2: Add and sync OpenSpec requirement `svc-25`**

Specify that the registered command installs locally, builds, and launches; cover absent dependencies, reusable existing installation, and install/build failure scenarios. Merge the same requirement into `openspec/specs/conductor-service-management/spec.md` without changing existing requirement IDs.

- [ ] **Step 3: Validate documentation and OpenSpec**

Run:

```bash
openspec validate configure-dictator-launchpad-model --strict
python3 -m unittest tests/openspec_requirement_ids_test.py
git diff --check
```

Expected: strict validation and diff check pass. The requirement-ID test may retain only the documented unrelated baseline duplicate `spm-80` in `synth-parameter-modulation`.

### Task 3: Verify fresh-Mac startup and finish Dictator hardware smoke test

**Files:**
- Modify: `openspec/changes/configure-dictator-launchpad-model/tasks.md` checkboxes only after evidence is collected

**Interfaces:**
- Consumes: production Conductor on port 9001 and Dictator worktree smoke restart API
- Produces: completed OpenSpec tasks 5.4 and 6.4

- [ ] **Step 1: Verify Conductor startup from absent local dependencies**

Move the worktree's generated `projects/conductor/node_modules` to a temporary directory, run `make conductor-run`, wait for `GET http://127.0.0.1:9001/health`, then restore or discard the temporary dependency directory only after the run-created local installation is verified. Expected: npm installs locally, TypeScript builds, and health returns `{"healthy":true,...}`.

- [ ] **Step 2: Start production Conductor through the existing main-checkout workflow**

Run the existing local installer/build in `/Users/joyo/Sheaf`, then `make conductor-run`. Expected: Conductor listens on port 9001.

- [ ] **Step 3: Smoke-restart Dictator from the feature worktree**

POST `{"smoke_test":true,"worktree":"/private/tmp/sheaf-configure-dictator-launchpad-model"}` to `/api/services/dictator/restart`, poll its Conductor health endpoint, and confirm logs are written under the worktree.

- [ ] **Step 4: Verify Mini Mk3 behavior and mismatch isolation**

With `launchpad_model: mini_mk3`, confirm the log reports the Mini connection and physically verify programmer mode/RGB, pad press/release, idle sleep, and wake. Then use a temporary ignored live config selecting `pro_mk3`, restart, confirm the connected Mini is not accepted, restore the prior live config, and restart with Mini selected.

- [ ] **Step 5: Mark tasks complete and rerun final gates**

Mark OpenSpec tasks 5.4 and 6.1–6.4 complete only after their evidence exists. Run the full Dictator and Conductor suites plus strict OpenSpec validation and `git diff --check` before reporting completion.
