# step 17 — polisher_reviewer

**thread:** Sheaf_quest_0003_slice_0005_polisher_reviewer

## output

I'll start by understanding the slice state, the spec, and existing issues.No prior issues, no responses file. Let me read the spec and physical plan.Now let me inspect the actual changes. Let me find the commits for this slice and the diff.Let me find the slice boundary and inspect changes via simpler commands.The git inspection commands are being denied. Let me reconsider — I'll inspect the implemented files directly via the Read/Glob tools, which is the sanctioned fallback. First let me see the project structure.I'll switch to direct file inspection. Let me map the implementation.Slice 0005 files (mtime ~14:38-44): `server.ts`, `static.ts`, `ui.ts`, `ui_helpers.ts`, `ui/`, `index.ts`, tests, docs, READMEs. Let me read them.Now the browser JS, index.ts, web assets, and tests.Now the tests and docs.Now the docs.Let me verify the config and check for a scroll-height constraint concern in the log viewer.Confirmed a functional defect. `.sheaf-log-view` has `overflow: auto` but **no height/max-height constraint**. A `<pre>` with no bounded height grows to fit its content and never produces an internal scrollbar — the page body scrolls instead. But the logs UI attaches its scroll listener to `logViewEl` itself (logs.js:257), and `requestEarlierBytes()` → `read_before` is *only* triggered from that element's scroll. So upward scrollback loading is unreachable in a real browser, violating the spec requirement to "scroll upward and load earlier chunks on demand."

Let me write this issue.Review complete. The implementation is largely solid — routes, REST/WebSocket wiring, constrained static serving with traversal rejection, HTML escaping, `0.0.0.0` home-URL rewriting, and comprehensive docs all match the spec. But I found one blocking functional defect, so I did **not** create `implementation_accepted.md`.

**Issue PR-0001 (open)** — Logs viewer scrollback is unreachable:
- `logs.js:257` attaches the scroll listener to `#log-view`, and `read_before` is only sent when that element scrolls to `scrollTop === 0`.
- `.sheaf-log-view` (`projects/web/src/sheaf.css:158`) has `overflow: auto` but **no height/max-height**, so the `<pre>` grows to fit content and never scrolls internally — the page scrolls instead. The element's scroll event never fires.
- Net effect: in a real browser, on-demand upward scrollback loading never triggers, violating the spec ("scroll upward and load earlier chunks on demand") and physical plan line 65. Not caught by tests since the integration suite has no DOM/scroll coverage.

Fix to close: give the log view a bounded height so long content produces an internal scrollbar and the scroll-to-top handler can fire.

Everything else (main UI, lifecycle controls, no-logs state, 404 handling, `POST /exit` docs, shared-CSS consumption, READMEs) checks out against the spec and physical plan.

