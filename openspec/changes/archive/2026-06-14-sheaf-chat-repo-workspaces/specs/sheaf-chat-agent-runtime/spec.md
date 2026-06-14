## ADDED Requirements

### Requirement: ar-18 — Workspace identity: runtime keys

THE service SHALL key agent runtimes by `{repoId, workspaceId, chatId}` and SHALL not use pile names as part of runtime identity.

#### Scenario: Runtime created

- **WHEN** a chat runtime is created for a workspace chat
- **THEN** its lifecycle key contains `repoId`, `workspaceId`, and `chatId`

### Requirement: ar-19 — Workspace root: Pi session construction

WHEN creating or resuming a workspace chat runtime, THE service SHALL use the chat manifest root when present and the provisional workspace root otherwise, and SHALL pass the workspace root as the Pi session working directory and scoped-tools root.

#### Scenario: Manifest present on resume

- **WHEN** a workspace chat has a manifest
- **THEN** the service uses the manifest root as authoritative for Pi session construction

#### Scenario: Provisional chat

- **WHEN** a workspace chat has no manifest yet
- **THEN** the service uses the provisional workspace root for Pi session construction

## MODIFIED Requirements

### Requirement: ar-4 — Lifecycle: cold-resume bootstrap

WHEN cold-resuming, THE service SHALL bootstrap from the chat manifest when present, otherwise from the provisional workspace chat record; IF the Pi session file is missing, THEN attachment SHALL fail (`chat file not found for <chatId>`). The manifest's `rootDirectory` and `model` are authoritative on resume.

#### Scenario: Manifest present on cold resume

- **WHEN** cold-resuming a chat and the manifest is present
- **THEN** the service bootstraps from the manifest, using its `rootDirectory` and `model` as authoritative values

#### Scenario: No manifest on cold resume

- **WHEN** cold-resuming a chat and no manifest is present
- **THEN** the service bootstraps from the provisional workspace chat record

#### Scenario: Pi session file missing

- **WHEN** cold-resuming a chat and the Pi session file is missing
- **THEN** attachment fails with `chat file not found for <chatId>`

### Requirement: ar-11 — Deferred manifest: initial write

WHEN the first user message of a workspace chat is accepted, THE service SHALL start generating a summary from its text; WHEN the first assistant message completes (Pi `message_end` with role `assistant`), THE service SHALL write the initial chat manifest exactly once with the summary as `chatName` and `description` and emit a manifest-updated event (broadcast as `session.updated`).

#### Scenario: First user message accepted

- **WHEN** the first user message of a workspace chat is accepted
- **THEN** the service starts generating a summary from its text

#### Scenario: First assistant message completes

- **WHEN** the first assistant message completes (Pi `message_end` with role `assistant`)
- **THEN** the service writes the initial chat manifest exactly once with the summary as `chatName` and `description`, and emits a manifest-updated event broadcast as `session.updated`
