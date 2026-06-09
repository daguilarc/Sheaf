# Human Intervention Request

## PL-0001 source_commit completion criterion is not implementable as written

Polishing issue `PL-0001` requires `source_commit` returned by `land_experiment`
and stored in `experiment.json` to equal the actual post-land `HEAD` commit.

That creates a self-reference: if `experiment.json` is committed with
`source_commit=<HEAD>`, the file content changes the tree hash, which changes the
commit hash. Amending or recommitting after writing the new hash produces a new
`HEAD`, so the stored value is stale again. Producing a Git commit that embeds its
own SHA would require finding a cryptographic fixed point and is not a practical
or maintainable implementation path.

The implementable alternatives need a product/spec decision:

- Store the archive commit SHA in `source_commit`, then make a separate metadata
  commit that records that reachable archive commit.
- Store the final metadata commit SHA in the API response only, while leaving
  `experiment.json` without a self-referential commit hash.
- Replace `source_commit` with a different locator such as a ref, tag, or commit
  range.

I fixed the independent retry-cleanup issue (`PL-0002`) but did not change
`source_commit` semantics for `PL-0001` because doing so requires this decision.
