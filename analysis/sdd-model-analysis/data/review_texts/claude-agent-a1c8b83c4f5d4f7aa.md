Perfect. Here's the summary:

**Status:** Both review findings fixed. **Commit:** `70f185d fix(synth): anchor app build paths to makefile directory` **Gates:** All four pass — `make -C projects/synth/apps/miniapp` builds, `make -f from repo root` works (previously broken), core build/test unaffected, old miniapp builds. **Concerns:** None.