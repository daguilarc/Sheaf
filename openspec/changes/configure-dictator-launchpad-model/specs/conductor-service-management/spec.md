## ADDED Requirements

### Requirement: svc-25 — Startup: Registered run command bootstraps local dependencies
WHEN the registered `make conductor-run` command is invoked from the repository root, THE Conductor project SHALL run its existing project-local npm install and TypeScript build targets before launching `dist/src/main.js` through `start_conductor.sh`; it SHALL NOT require globally installed project packages or a separate bootstrap mechanism.

#### Scenario: Fresh Mac has no local dependencies
- **WHEN** Node.js and npm are available but `projects/conductor/node_modules` is absent
- **THEN** `make conductor-run` installs the locked project dependencies locally, builds Conductor, and starts the service

#### Scenario: Existing installation is reusable
- **WHEN** local dependencies and compiled output already exist
- **THEN** `make conductor-run` executes the same idempotent install/build workflow and starts the service

#### Scenario: Bootstrap step fails
- **WHEN** npm installation or the TypeScript build fails
- **THEN** the run command exits non-zero with that tool's diagnostic and does not launch Conductor
