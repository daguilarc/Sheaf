# Physical Plan: Project Scaffold And Registry

## Objective

Create the `projects/conductor/` and `projects/web/` project boundaries, establish the Conductor TypeScript package foundation, add the Conductor service registry entry, and add the initial shared web asset surface that later UI work will consume.

Expected outcome:

- `projects/conductor/` and `projects/web/` exist with the required `README.md`, `quests/`, `src/`, `tests/`, and `docs/` layout.
- `projects/web/quests/` has no active quest records; keep it empty except for a placeholder only if needed for git tracking.
- `projects/conductor/` is a buildable Node TypeScript package with source and test folders ready for later slices.
- `config/services.json` contains the `conductor` service entry bound to `0.0.0.0:9001` with a repo-root-relative start command and UI `home_path`.
- `projects/web/src/` contains shared CSS/static assets that later Conductor UI files can reference without putting generic styling in `projects/conductor/`.

## Key Files And Systems

- Add `projects/conductor/package.json`.
- Add `projects/conductor/tsconfig.json`.
- Add `projects/conductor/src/index.ts` for package exports.
- Add `projects/conductor/src/main.ts` as the eventual service entry point; for this slice it may only parse config and print a clear "server not implemented yet" error, because the runnable server lands in slice 0002.
- Add `projects/conductor/src/paths.ts` or equivalent helper for resolving repo-root paths from the project-local package.
- Add `projects/conductor/tests/` with an initial package/config scaffold test.
- Add `projects/conductor/README.md` and `projects/conductor/docs/README.md` as concise current-state docs for the scaffold.
- Add `projects/web/README.md`.
- Add `projects/web/src/` shared CSS, for example `projects/web/src/sheaf.css`, plus any minimal static asset folders needed by the CSS.
- Add `projects/web/tests/.gitkeep` so the required tests directory exists. Do not create a separate web package or web test runner in this quest; shared CSS use is validated through Conductor UI tests in slice 0005.
- Add `projects/web/docs/README.md` describing the current shared CSS surface.
- Update `config/services.json` from `[]` to include the Conductor entry:
  - `name`: `conductor`
  - `host`: `0.0.0.0`
  - `port`: `9001`
  - `home_path`: `/`
  - `command`: `npm --prefix projects/conductor start`
- Update `.gitignore` if needed for `projects/conductor/node_modules/` and `projects/conductor/dist/`.

## Existing APIs To Reuse As-Is

- Reuse the structure-level project layout from `structure/repo-layout.md` and `structure/project-rules.md`.
- Reuse the structure-level service registry shape from `structure/services.md`; do not introduce a second registry or project-local service list.
- Reuse `config/services.json` as the only committed registry source.
- Reuse the existing TypeScript/Node conventions from `apps/realtime-agent`: ESM package, `tsconfig` with `module`/`moduleResolution` set to `NodeNext`, strict TypeScript, `npm run build`, and Node's built-in `node --test`.
- Reuse `ws` as the WebSocket dependency in slice 0004, matching the existing dependency already used by `apps/realtime-agent`. Do not add it in this scaffold slice before it is used.

## APIs To Define Or Extend

Define only foundational contracts needed by later slices:

- `RepoPaths` helper or functions for:
  - repository root
  - `config/services.json`
  - `logs/<service_name>/`
  - shared CSS path under `projects/web/src/`
- `ServiceDefinition` type matching `config/services.json` entries:
  - `name: string`
  - `host: string`
  - `port: number`
  - `command: string`
  - optional `home_path: string`
- A package entry point that exports the registry and path types once they exist.

Do not define supervisor, persistent storage, heartbeat, lifecycle, or log streaming APIs in this slice beyond the minimum types needed to support tests and later implementation.

## Enabling Refactor

No refactor of existing top-level code or `apps/` code is needed. The only enabling work is creating the two project boundaries and adding ignore rules for the new project-local build output.

## Validation

- `npm install` succeeds in `projects/conductor` and creates or updates only project-local package metadata/lock files.
- `npm run build` succeeds in `projects/conductor`.
- `npm test` succeeds in `projects/conductor` for the scaffold/config tests.
- `config/services.json` remains valid JSON and contains exactly one `conductor` entry unless other service entries are present by the time this slice runs.
- Verify `projects/conductor/` and `projects/web/` contain the required layout directories.
- Verify `projects/web/quests/` contains no active quest files; use `.gitkeep` only if needed to keep the empty directory tracked.

## Sequencing Notes

This slice must be completed first. Later slices should extend the Conductor package created here rather than introducing a parallel service implementation or moving existing top-level code into `projects/`.
