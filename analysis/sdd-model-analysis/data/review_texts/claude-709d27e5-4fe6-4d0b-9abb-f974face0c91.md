I have enough to write the review. Let me confirm the three delta requirement IDs one more time against what exists, then report.

The delta files add: `sar-14`, `sar-15`, `sar-16` (app-runtime), `spp-10` (patch-persistence), `sru-13` (runtime-ui).

## Review: `add-sheaf-synth-superapp`

**Verdict: one blocking issue** — requirement-ID collisions in two of the three delta specs. The design intent is sound and all three user corrections are correctly reflected. Details below, severity-ordered.

---

### BLOCKING

**1. Requirement IDs `sar-14/15/16` collide with existing requirements in the target spec.**
The delta `specs/synth-app-runtime/spec.md:3,22,39` adds `sar-14`, `sar-15`, `sar-16`. But those IDs are already taken in `openspec/specs/synth-app-runtime/spec.md`:
- `sar-14` — Miniapp: headless system-test coverage (line 254)
- `sar-15` — Audio: device selection and patch persistence (line 270)
- `sar-16` — Patches: message-side identity and save fallback (line 291)

The existing spec runs through `sar-18`, and `sar-18` is even used **twice** (lines 321 and 342, a pre-existing defect). The next free IDs are `sar-19`, `sar-20`, `sar-21`. As written, applying/archiving this change would either fail validation or silently duplicate IDs.

**2. Requirement ID `sru-13` collides.**
Delta `specs/synth-runtime-ui/spec.md:3` adds `sru-13 — Launcher: app list and one-way selection`, but the existing `openspec/specs/synth-runtime-ui/spec.md:222` already defines `sru-13 — File page: in-app patch browser`. That spec runs through `sru-16`; the next free ID is `sru-17`.

(`spp-10` in the patch-persistence delta is fine — existing spec tops out at `spp-9`.)

---

### Medium — spec ambiguity / implementation risk

**3. `config` vs `config.json` — path is inconsistent with the rest of the persistence system.**
`specs/synth-patch-persistence/spec.md:4` and its scenarios (lines 6-9) write configuration to `data/synth/sheaf-synth/config` (no extension). Everywhere else the runtime config document is a JSON file: `RuntimeDataPaths.configFile` defaults to `dataRoot / "config.json"` (`projects/synth/include/synth/AppContext.hpp:48`), and `spp-9` describes "an explicit configuration file path" containing a JSON object. The delta never says whether `config` is a file named `config`, a file `config/config.json`, or a directory. Recommend making it `data/synth/sheaf-synth/config.json` (or explicitly stating the shape) to match the injectable `configFile` contract.

**4. The `data/synth/sheaf-synth` root is not anchored, and appears to conflict with `sar-17`.**
`design.md:63` and the spec deltas name the product data root `data/synth/sheaf-synth` as a bare relative-looking path. Existing `sar-17` (`openspec/specs/synth-app-runtime/spec.md:304-309`) requires the production data root to live under the OS user-application-data area for "Sheaf and the app name" and explicitly **not** "under the build tree." A literal repo-relative `data/synth/...` would violate `sar-17`. If the intent is `<OS-app-data>/Sheaf/sheaf-synth/...`, say so; if it's genuinely a repo/cwd path, that contradicts `sar-17` and needs reconciling. This is the most likely place an implementer goes wrong.

**5. `<appname>` path segment is never bound to the *stable app id* in the persistence spec.**
The user correction (patch dirs use the stable app id, not display name) is captured in `design.md:102` and implied by `sar-14`'s "App id is path-safe" scenario. But the persistence delta (`specs/synth-patch-persistence/spec.md:4,11-14`) uses the placeholder `<appname>` and only says the patches root is "not both derived from the selected app's **display name**" (line 23) — it never positively states it is derived from the **stable app id**. A reader could still interpret `<appname>` loosely. Recommend `patches/<stable-app-id>` and an explicit cross-reference to `sar-14`'s app id, so the two specs can't drift.

---

### Low / non-blocking

**6. `logsRoot` is unspecified for Sheaf-launched apps.** `RuntimeDataPaths` requires four fields (`dataRoot`, `patchesRoot`, `logsRoot`, `configFile`); `Runtime::Start()` creates all three directories (`projects/synth/runtime/Runtime.hpp:188-206`). `design.md:66` waves off log placement ("not the behavioral focus"), and `spp-10` specifies only config + patches. The Sheaf Synth resolver still must supply *some* `logsRoot`. Fine to leave to implementation, but worth one sentence so it isn't left undefined.

**7. "Deterministic order" is asserted but the ordering key is undefined.** `sru-13` scenario (line 7-9) and `tasks.md:26` require deterministic ordering but don't say by what (registration order / app id / category). Pick one to make the test unambiguous.

**8. Polish:** `proposal.md:17` has an empty `### New Capabilities` heading with nothing under it — drop it or note it's intentional. And the pre-existing duplicate `sar-18` in the base spec is worth fixing opportunistically while you're renumbering (renumber the change's new reqs to `sar-19+`, and separately correct the base-spec dup).

---

### User corrections — all three correctly reflected
- **Config sharing only for Sheaf-Synth-launched apps:** ✅ `proposal.md:10`, `design.md:68` ("Standalone apps keep their existing default path behavior unless … launched through Sheaf Synth"), `spp-10` "Standalone app paths are unchanged" scenario (lines 26-29).
- **Patch dirs use the stable app id:** ✅ stated in `design.md:28,102` and `sar-14`'s path-safety scenario — though the persistence spec should tighten the `<appname>` wording (finding 5).
- **Hardware requirements advisory only:** ✅ `design.md:87,103`, `sru-13` "Hardware requirements are advisory" scenario (`specs/synth-runtime-ui/spec.md:25-28`), and `tasks.md:29` ("without hardware gating").

The tasks list also cleanly mirrors the design decisions and migration plan; no gaps there beyond what the spec findings above imply.

**Bottom line:** fix the three ID collisions (blocking), then resolve the `config` filename, the `data/synth/sheaf-synth` anchoring, and the `<appname>`-vs-app-id wording before implementation. Everything else is polish.