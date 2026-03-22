# Issues

## toolSummary path extraction truncates paths containing colons

The `extractPatchPaths` function in `toolSummary.ts` uses `line.split(": ", 2)` to
extract file paths from patch envelope headers. In JavaScript, the second argument
to `split` limits the number of returned array elements, not the number of splits
performed. This means file paths containing `: ` would be truncated.

Example:
- Input: `*** Update File: notes:draft/file.md`
- Actual result: `notes` (truncated)
- Expected result: `notes:draft/file.md`

The server-side parsing in `patching.py` correctly uses `removeprefix` and is not
affected. This only impacts the UI summary display.

Impact is low because `: ` in file paths is rare (uncommon on Unix, often invalid
on Windows), and the summary would still show a reasonable partial name.

Status: `rejected`

Next Action: `rejected`
