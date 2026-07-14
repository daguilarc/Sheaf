# Quest Runner Registry Endpoint Design

## Goal

Make `config/services.json` the authoritative default bind endpoint for the
Quest Runner service, matching the repository service contract. Remove the
unassigned port `9000` from the generic service documentation without changing
the Agent VM forwarding range.

## Scope

- Resolve Quest Runner's default bind host and port from the `quest-runner`
  registry entry.
- Fail startup when the registry file or entry cannot provide a valid endpoint.
- Preserve explicit `--host` and `--port` overrides on a per-field basis.
- Remove the launcher's hard-coded `--port 9002` argument.
- Update the service structure documentation, Quest Runner operations
  documentation, and OpenSpec lifecycle contract.
- Leave Agent VM port forwarding and intentional client fallback endpoints
  unchanged.

## Endpoint Resolution

The service entry point derives the source repository root as it does today and
loads `<repo>/config/services.json`. The file must be valid JSON containing an
array with exactly one object whose `name` is `quest-runner`:

- `host` is a non-empty string.
- `port` is an integer from 1 through 65535. Boolean values are not integers for
  this contract.

Startup fails with a specific error when the file is unreadable, malformed, not
an array, lacks the named entry, contains duplicate named entries, or contains
an invalid endpoint. Unrelated entries do not need endpoint validation in this
resolver. The service does not fall back to `0.0.0.0:9002`.

Command-line values override the corresponding registry fields independently.
For example, `--host 127.0.0.1` uses the registry port, and `--port 9100` uses
the registry host. The final host must remain non-empty and the final port must
remain in the valid range. Registry loading and validation still occur even
when both overrides are supplied, because the service must remain registered.

## Implementation Shape

Endpoint parsing and resolution will be a small testable unit used by
`quest_runner_service.__main__`. The argument parser will use `None` for absent
`--host` and `--port` values so the resolver can distinguish omission from an
explicit override. The resolved endpoint will feed both startup logging and
`app.run`.

`start_quest_runner.sh` will continue to own virtual-environment bootstrap and
log redirection, but it will invoke `python -m quest_runner_service` without a
port argument.

The existing operator CLI URL fallback remains unchanged. It is a client-side
recovery path and does not determine the service's bind endpoint.

## Documentation

`structure/services.md` will use the real Quest Runner registration as its
example instead of inventing a service on port `9000`. The Quest Runner
lifecycle spec and operations documentation will state that the registry owns
the default endpoint and that CLI flags are deliberate overrides.

The Agent VM `9000-9009` forwarding configuration, its OpenSpec contract, and
its tests are explicitly outside this change.

## Tests

Regression tests will cover:

- successful resolution of the registered host and port;
- independent host and port overrides;
- missing registry file;
- malformed or non-array registry content;
- missing `quest-runner` entry;
- duplicate `quest-runner` entries;
- empty host and invalid port values;
- launcher invocation without a hard-coded port.

Tests will be written and observed failing before implementation. The focused
Quest Runner test module and the complete Quest Runner unit suite will be run
after the change.
