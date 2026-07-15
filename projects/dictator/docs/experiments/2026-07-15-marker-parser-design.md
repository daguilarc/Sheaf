# Structural marker parser follow-up

Date: 2026-07-15

Prompt rules substantially improve Blark and Borg, but discovering delimiter
boundaries and command syntax should not remain probabilistic.

## Blark

Add a deterministic, case-insensitive scanner before model refinement. It emits
ordinary text segments, valid Blark commands, and diagnostics for preserved
malformed spans. A valid span is `blark FORMAT CONTENT blark`, tolerating only
documented punctuation beside markers and the format token. The parser recognizes
the exact current vocabulary: `hammer`, `camel`, `smash`, `snake`, `kebab`,
`dotted`, `conga`, `slasher`, `packed`, `constant`, `string`, `dub string`,
`padded`, `all cap`, and `all down`.

Transformation is deterministic in code. Multiple valid spans execute left to
right. Unmatched markers, unknown formats, empty content, and prose mentions are
preserved byte-for-byte and produce a structured diagnostic such as
`unmatched_open`, `unknown_format`, or `empty_content`. The transformed complete
transcript then receives the normal conservative cleanup pass.

## Borg

Use the same deterministic scanner for case-insensitive Borg boundaries, but do
not implement its instruction semantics in a fixed command grammar. A valid
`borg INSTRUCTION borg` span becomes a structured instruction segment; outside
text becomes explicit dictation segments. The model receives the complete
outside text plus ordered instruction segments, so it executes meaning without
having to infer which words were delimiters.

Unmatched or empty Borg spans and prose mentions are preserved and diagnosed.
Valid marker words and instruction text never appear in the output. Instructions
execute in spoken order and override the conservative no-rewrite rule only for
the transformation they explicitly request. The complete result receives normal
cleanup afterward.

## Contract and rollout

Parser results should include transformed/structured content and diagnostics, be
covered by exact unit tests for every format, punctuation adjacency, multiple and
nested-looking spans, malformed boundaries, prose mentions, and long mixed prose,
and be recorded with interaction metadata. Prompt-based marker behavior remains
in production until that parser is implemented and separately rolled out.

Do not test or deploy reasoning `none` as the default before this boundary is
structural unless production evidence independently demonstrates that semantic
Borg execution at `none` is as reliable as `low`.
