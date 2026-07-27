# Xagent Cursor Force Mode Design

## Goal

Give every Cursor session launched by xagent unrestricted command approval by
passing Cursor Agent's `--force` option.

## Design

The Cursor adapter will add `--force` to its fixed argument list beside
`--trust`. This applies consistently to initial turns and resumed sessions
without adding a new xagent CLI option or changing other harnesses.

An adapter integration test will capture the spawned Cursor command and assert
that both `--trust` and `--force` are present. The xagent CLI specification will
document the complete fixed invocation. The packaged xagent plugin assets will
be regenerated so installed plugin users receive the same behavior.

## Verification

Run the xagent test suite, rebuild the plugin package, and run the plugin
packaging checks.
