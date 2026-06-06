# Conductor Docs

## Current State

The Conductor project is scaffolded as a Node TypeScript package under
`projects/conductor/`. It exports foundational path helpers and service registry
types used by later slices.

The service entry point (`src/main.ts`) reads `config/services.json` and exits
with a clear message that the HTTP server is not implemented yet.

## Package Layout

```text
projects/conductor/
  src/
    index.ts              package exports
    main.ts               service entry point (stub)
    paths.ts              repository path resolution
    service_definition.ts ServiceDefinition type
    service_registry.ts   load services.json
  tests/
    scaffold.test.ts      scaffold and registry tests
```

## Foundational APIs

### `createRepoPaths()`

Resolves repository-root-relative paths:

- `repoRoot`
- `servicesJsonPath` → `config/services.json`
- `sharedCssPath` → `projects/web/src/sheaf.css`
- `serviceLogRoot(name)` → `logs/<name>/`

### `ServiceDefinition`

Matches the structure-level service registry schema:

- `name`, `host`, `port`, `command`
- optional `home_path`

### `loadServiceRegistry(path)`

Reads and parses `config/services.json` as a `ServiceDefinition[]`.

## Service Registration

Conductor is registered in `config/services.json` on `0.0.0.0:9001` with
`home_path` set to `/`. Start command:

```text
npm --prefix projects/conductor start
```
