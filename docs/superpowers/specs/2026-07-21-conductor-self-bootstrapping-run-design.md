# Conductor Self-Bootstrapping Run Design

## Goal

Make the registered `make conductor-run` command work on a fresh macOS
checkout after Node.js and npm are available, without introducing a second
installation mechanism or globally installing project dependencies.

## Design

Keep Conductor's existing project-local npm deployment model. The
`projects/conductor/Makefile` `run` target will depend on its existing
`install` and `build` targets before invoking `start_conductor.sh`. This makes
the service-registry command perform the same documented `npm install` and
TypeScript build steps that users currently run manually.

`ws`, TypeScript, and their types remain declared in `package.json` and
`package-lock.json` and remain installed under
`projects/conductor/node_modules`. No global npm package and no new bootstrap
script or root-level installation framework is added.

## Error Handling

Normal npm or TypeScript failures stop `make conductor-run` before the service
starts and preserve their native diagnostics. `start_conductor.sh` retains its
explicit missing-Node diagnostic and remains responsible only for launching
the compiled service and routing logs.

## Tests and Documentation

Add a repository-level static workflow test that parses the Conductor
Makefile and proves `run` depends on `install` and `build`. Update Conductor's
README and operations documentation so `make conductor-run` is the canonical
self-bootstrapping command while the explicit npm commands remain documented
as equivalent lower-level steps.

Verification consists of the new regression test failing before the Makefile
change and passing afterward, the full Conductor test suite, a fresh
`make conductor-run` startup with project-local dependencies absent, and the
pending Dictator Launchpad Mini smoke test through the running Conductor.
