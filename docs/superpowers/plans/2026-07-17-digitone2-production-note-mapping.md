# Digitone 2 Production Note Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the production Digitone 2 encoder-push CC addresses with the approved note sequence and add its note-addressed modifier and bank-selection controls.

**Architecture:** Perform one guarded, atomic transformation of the external Sheaf Patch runtime config. Snapshot both the original file and the parsed non-target state, replace only the `digitone2` profile fields, then validate the result with `jq` and the production C++ runtime-config loader.

**Tech Stack:** JSON, `jq`, C++20, `synth::LoadRuntimeConfigFile`, Git documentation.

## Global Constraints

- Target only `/Users/joyo/Library/Sheaf/synth/sheaf-patch/config`.
- Require exactly one Generic controller named `digitone2`.
- Use zero-based MIDI channel `0` for every new note address.
- Preserve all non-Digitone controllers, Digitone endpoints, and Digitone encoder turns.
- Create a timestamped sibling backup before mutation.
- Do not mutate the config while Sheaf Patch is running.

---

### Task 1: Atomically Update and Validate the Production Profile

**Files:**
- Modify: `/Users/joyo/Library/Sheaf/synth/sheaf-patch/config`
- Create temporarily: `/private/tmp/digitone2-note-map.jq`
- Create temporarily: `/private/tmp/validate-digitone2-config.cpp`

**Interfaces:**
- Consumes: the schema accepted by `synth::LoadRuntimeConfigFile(const std::filesystem::path&, MidiInstrumentConfig&, AudioDeviceState&)`.
- Produces: one loadable production config plus a timestamped `config.backup-before-digitone2-notes-*` sibling.

- [ ] **Step 1: Preflight the live file and capture immutable state**

Run `pgrep -af 'sheaf-patch|Sheaf Patch|SheafPatch'` and require no output. Run:

```bash
jq -e '[.midiInstrument.controllers[] | select(.name == "digitone2" and .kind == "generic")] | length == 1' /Users/joyo/Library/Sheaf/synth/sheaf-patch/config
jq -S '{others:[.midiInstrument.controllers[] | select(.name != "digitone2")], digitone:(.midiInstrument.controllers[] | select(.name == "digitone2") | {input,output,turns:.profile.encoderInput.turns})}' /Users/joyo/Library/Sheaf/synth/sheaf-patch/config
```

Expected: the first command prints `true`; save the second command's output as
`/private/tmp/digitone2-state-before.json` for the post-write comparison.

- [ ] **Step 2: Create the timestamped backup**

Resolve the current timestamp once with `date +%Y%m%dT%H%M%S`, form a sibling
path by appending that value to `config.backup-before-digitone2-notes-`, copy
the live config there, and verify `cmp` reports equality.

- [ ] **Step 3: Write the exact atomic transformation**

Create `/private/tmp/digitone2-note-map.jq` with helpers that construct the complete persisted shapes:

```jq
def message($type; $bank; $bool; $hasBool):
  {type:$type, slotIx:0, position:0, gestureIx:0, bankIx:$bank,
   sceneIx:0, value:0, delta:0, boolValue:$bool, hasBoolValue:$hasBool};
def modifier($note; $type):
  {control:{channel:0, cc:$note, type:"note"},
   wrldBldrPosition:null, launchpadPosition:null,
   press:message($type; 0; true; true),
   release:message($type; 0; false; true),
   feedback:message($type; 0; true; true), outputFeedback:false};
def bank($note; $bank):
  {control:{channel:0, cc:$note, type:"note"},
   wrldBldrPosition:null, launchpadPosition:null,
   press:message("selectParamBank"; $bank; false; false), release:null,
   feedback:message("selectParamBank"; $bank; false; false), outputFeedback:false};
(.midiInstrument.controllers[] | select(.name == "digitone2")) |=
  (.profile.encoderInput.pushes =
     ([68,69,70,71,60,61,62,63,72,73,74,75,64,65,66,67]
      | to_entries
      | map({control:{channel:0, cc:.value, type:"note"},
             slotIx:0, position:.key}))
   | .profile.systemMessages =
     ([modifier(84; "toggleReset"),
       modifier(85; "toggleRandom"),
       modifier(86; "toggleRandomMod")]
      + ([92,93,94,95,96,97,98,99]
         | to_entries
         | map(bank(.value; .key)))))
```

Apply it with `jq -c` to the sibling
`/Users/joyo/Library/Sheaf/synth/sheaf-patch/config.tmp-digitone2-notes`, require
`jq empty` to pass, copy the original mode obtained from `stat -f '%Lp'`, then
atomically rename the temporary file over `config`.

- [ ] **Step 4: Verify the exact semantic result**

Use `jq -e` assertions to require:

```jq
(.midiInstrument.controllers[] | select(.name == "digitone2")) as $d
| [$d.profile.encoderInput.pushes[].control.cc]
    == [68,69,70,71,60,61,62,63,72,73,74,75,64,65,66,67]
and ([$d.profile.encoderInput.pushes[].control.channel] | all(. == 0))
and ([$d.profile.encoderInput.pushes[].control.type] | all(. == "note"))
and ([$d.profile.encoderInput.pushes[].position] == [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15])
and ([$d.profile.systemMessages[].control.cc] == [84,85,86,92,93,94,95,96,97,98,99])
and ([$d.profile.systemMessages[].control.channel] | all(. == 0))
and ([$d.profile.systemMessages[].control.type] | all(. == "note"))
and ([$d.profile.systemMessages[].outputFeedback] | all(. == false))
and ([$d.profile.systemMessages[3:][] | .press.bankIx] == [0,1,2,3,4,5,6,7])
```

Regenerate the immutable-state snapshot from Step 1 and require it to compare equal to the pre-write snapshot.

- [ ] **Step 5: Validate with the production parser**

Create `/private/tmp/validate-digitone2-config.cpp`:

```cpp
#include "synth/PatchPersistence.hpp"
#include <iostream>

int main(int argc, char** argv) {
    if (argc != 2) return 2;
    synth::MidiInstrumentConfig instrument;
    synth::AudioDeviceState audio;
    const auto status = synth::LoadRuntimeConfigFile(argv[1], instrument, audio);
    std::cout << synth::RuntimeConfigFileStatusName(status) << '\n';
    return status == synth::RuntimeConfigFileStatus::Ok ? 0 : 1;
}
```

Run `make -C projects/synth build`, compile the validator with `-std=c++20 -Iprojects/synth/include` and `projects/synth/build/libsynth.a`, then run it against the production config.

Expected: output `Ok`, exit `0`.

- [ ] **Step 6: Final handoff checks**

Confirm the backup exists, the live file mode is unchanged, `jq empty` succeeds, the exact mapping assertion succeeds, the immutable-state comparison succeeds, and the production parser returns `Ok`. Do not commit the external production config or temporary validator files.
