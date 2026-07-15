# Awkward dictation review: ten Luna-low examples

Date: 2026-07-13

Configuration:

- Model: `gpt-5.6-luna`
- Reasoning effort: `low`
- Base prompt: [`conservative_v4.md`](../../experiments/refiner-benchmark/prompts/conservative_v4.md)
- Marker prompts: [`blark_v3.md`](../../experiments/refiner-benchmark/prompts/blark_v3.md) and [`borg_v4.md`](../../experiments/refiner-benchmark/prompts/borg_v4.md)

Terra ranked all 756 raw revision transcripts without seeing historical or candidate outputs. Eighty-seven passages tied at the maximum repair-opportunity score, so these ten were manually selected from that tier for diversity and interest rather than pretending the tie had a meaningful numerical order. Luna then refined every complete passage in the corpus with the configuration above. The focused spans below are excerpts from those full-passage runs.

These are review questions, not asserted ground truth. In particular, examples 1, 3, 7, and 9 show places where a warranted local repair may have encouraged extra smoothing, while example 10 shows a consequential likely mishearing that the conservative prompt declined to guess.

## 1. Restart inside a long product request

Why selected: a clear abandoned start appears inside otherwise intentional, informal prose.

Focused transformation:

> **Original:** “Instead of showing the instead of just showing the raw JSON L file on the agent pages…”
>
> **Refined:** “…instead of just showing the raw JSONL file on the agent pages…”

Manual question: the restart and `JSONL` correction look right, but did the refiner also over-edit elsewhere by removing “basically,” joining fragments, and normalizing terms such as “web socket”?

<details>
<summary>Complete original and refined passage</summary>

**Original**

> Okay, we are here to write the spec for the side quest one, the chat UI of the quest runner. So let's get started. So basically, we have the repo AG UI checked out next to this one. I don't know if that checkout helps or not. Only use it if you need it. The goal of this project is on the agent pages. Instead of showing the instead of just showing the raw JSON L file on the agent pages of the web UI, I want to make an AG UI chat transcript interface. And I want it to support streaming. So basically, everything else is updating on that five second tick. This should not be. This should, when you go to one of these agent pages, it should open a web socket. And this web socket should basically start by dumping the JSON L file at you. And when new streaming things come in, it should stream them directly to this. And we want to implement all of the appropriate callbacks for AG UI so that we can have a nice looking streaming chat. Like real time transcripts. We do not need to be able to talk back to the agent. So this is only showing the chat transcripts. So go ahead and basically write a spec for that. And

**Refined**

> Okay, we are here to write the spec for side quest one, the chat UI of the quest runner. So let's get started. Basically, we have the repo AG UI checked out next to this one. I don't know if that checkout helps or not. Only use it if you need it. The goal of this project is, on the agent pages, instead of just showing the raw JSONL file on the agent pages of the web UI, I want to make an AG UI chat transcript interface. And I want it to support streaming. So basically, everything else is updating on that five-second tick. This should not be. When you go to one of these agent pages, it should open a WebSocket. And this WebSocket should basically start by dumping the JSONL file at you. And when new streaming things come in, it should stream them directly to this. And we want to implement all of the appropriate callbacks for AG UI so that we can have a nice-looking streaming chat, like real-time transcripts. We do not need to be able to talk back to the agent. So this is only showing the chat transcripts. So go ahead and basically write a spec for that.

</details>

Record: `E4C53CD3-6505-40F8-A932-F7069A0DA0F3`

## 2. Repeated technical-name mishearings

Why selected: the same contextual mishearing occurs repeatedly, alongside a second technical mishearing.

Focused transformation:

> **Original:** “all of the clod user messages in all of the JSON elf files”
>
> **Refined:** “all of the Claude user messages in all of the JSONL files”

Manual question: are `clod` → `Claude`, `JSON elf` → `JSONL`, and `work around` → `workaround` all corrections you want automatically?

<details>
<summary>Complete original and refined passage</summary>

**Original**

> Next, can you go through and audit all of the clod user messages in all of the JSON elf files across all the quests? So write some script that's pulled out all of the clod user messages looking for ones that complain about permissions issues and for any run that has a complaint, see if clod did the work around that he did in the last one or if clod just gave up. And report back to me all of the runs where clod wanted to file a bug and gave up.

**Refined**

> Next, can you go through and audit all of the Claude user messages in all of the JSONL files across all the quests? So write some script that's pulled out all of the Claude user messages looking for ones that complain about permissions issues, and for any run that has a complaint, see if Claude did the workaround that he did in the last one or if Claude just gave up. And report back to me all of the runs where Claude wanted to file a bug and gave up.

</details>

Record: `AAC60FAA-88B0-4D03-BA5F-751F56124040`

## 3. Explicit correction followed by broader grammar cleanup

Why selected: “root file—or root directory” is an unambiguous spoken correction, but the full output tests how far cleanup should extend around it.

Focused transformation:

> **Original:** “each session has a specified root file. Or root directory.”
>
> **Refined:** “each session has a specified root directory.”

Manual question: the focused correction is clear; are the additional sentence joins, possessive fix, and `it` → `them` correction desirable transcription cleanup or unwanted prose editing?

<details>
<summary>Complete original and refined passage</summary>

**Original**

> The agents themselves should be running completely independently of any machine or global pie configuration. All of the pie extensions and pie configurations should be provided by this repo and by the chief chat server. In particular, each session has a specified root file. Or root directory. The agent is provided a set of tools similar to the built-in set of tools. Where all reads and writes are relative to the sessions root directory. When specifying file names, you specify it relative to the root directory when listening files. Everything comes back relative to the root directory. There's no way to view or modify files outside of that directory. Any of its descendants of course. This should be enforced at the tools layer. The agent should not be able to see anything outside of the directory that it started in.

**Refined**

> The agents themselves should be running completely independently of any machine or global pie configuration. All of the pie extensions and pie configurations should be provided by this repo and by the chief chat server. In particular, each session has a specified root directory. The agent is provided a set of tools similar to the built-in set of tools, where all reads and writes are relative to the session's root directory. When specifying file names, you specify them relative to the root directory when listing files. Everything comes back relative to the root directory. There's no way to view or modify files outside of that directory, any of its descendants, of course. This should be enforced at the tools layer. The agent should not be able to see anything outside of the directory that it started in.

</details>

Record: `B9DADB2F-706C-4723-9BD9-A5201E50B0CD`

## 4. A technical phrase broken by Whisper

Why selected: the surrounding vocabulary strongly resolves a small but confusing recognition error.

Focused transformation:

> **Original:** “transforming pi events to you to AG UI events”
>
> **Refined:** “transforming Pi events to AG-UI events”

Manual question: does this recover exactly what you meant, including the capitalization and hyphenation?

<details>
<summary>Complete original and refined passage</summary>

**Original**

> Could you look at the diff currently on top of the work tree and make sure that it makes sense and that they're properly transforming pi events to you to AG UI events

**Refined**

> Could you look at the diff currently on top of the work tree and make sure that it makes sense and that they're properly transforming Pi events to AG-UI events?

</details>

Record: `E0986B15-265D-4F4C-82D3-1EFFA2AFEF79`

## 5. Extreme Whisper repetition loop

Why selected: this is almost certainly an ASR loop rather than rhetorical repetition.

Focused transformation:

> **Original:** “The web UI should have a Web UI.” repeated eleven times
>
> **Refined:** “The web UI should have a Web UI.” once

Manual question: should one instance remain, or should the entire tautological sentence be removed as recognizer garbage?

<details>
<summary>Complete original and refined passage</summary>

**Original**

> The last thing we need to deal with is the web UI. The web UI should have a Web UI. The web UI should have a Web UI. The web UI should have a Web UI. The web UI should have a Web UI. The web UI should have a Web UI. The web UI should have a Web UI. The web UI should have a Web UI. The web UI should have a Web UI. The web UI should have a Web UI. The web UI should have a Web UI. The web UI should have a Web UI.

**Refined**

> The last thing we need to deal with is the web UI. The web UI should have a Web UI.

</details>

Record: `822AE231-91EA-4474-9739-51A7AD7F5104`

## 6. Two genuine word stutters in an emphatic passage

Why selected: the duplicated function words look accidental while the repeated “and” rhythm elsewhere carries your frustration and voice.

Focused transformations:

> **Original:** “with the with the previous changes”
>
> **Refined:** “with the previous changes”

> **Original:** “and and and the proof of it”
>
> **Refined:** “and the proof of it”

Manual question: are the numerous added commas helpful punctuation, or do they make the passage feel more edited than dictated?

<details>
<summary>Complete original and refined passage</summary>

**Original**

> Okay, well those horizontal lines are still there and the thinking traces still don't appear and they used to appear and none of these changes that you've made are something that we would have broken with the with the previous changes that we've made today. So I want you to revert all of the changes related to the collapsed thinking boxes and then I want you to conduct an actual experiment so that you can figure out what's actually going on and stop guessing. Tell me what you think the problem is before you make any fixes. Do not change the code until you tell me what you think the problem is and and and the proof of it.

**Refined**

> Okay, well those horizontal lines are still there, and the thinking traces still don't appear, and they used to appear, and none of these changes that you've made are something that we would have broken with the previous changes that we've made today. So I want you to revert all of the changes related to the collapsed thinking boxes, and then I want you to conduct an actual experiment so that you can figure out what's actually going on and stop guessing. Tell me what you think the problem is before you make any fixes. Do not change the code until you tell me what you think the problem is and the proof of it.

</details>

Record: `D0305422-FCE4-4FB7-AD5A-912B9E6614BD`

## 7. Abandoned restart in a long planning passage

Why selected: a recognizably tangled restart has a recoverable endpoint without changing the surrounding plan.

Focused transformation:

> **Original:** “with experiments, you copy in the currently you copy in the, and you replace that one file”
>
> **Refined:** “with experiments, you copy in the, and you replace that one file”

Manual question: the abandoned fragment is gone, but is “you copy in the” still too incomplete? The model also inserted a paragraph break and several commas.

<details>
<summary>Complete original and refined passage</summary>

**Original**

> Okay, so first open questions. I think pre-planning is kind of a fully bona fide state, but the only transition that it's allowed to do is the manual one. And so it's considered a state that the quest runner won't start if it's still in that state. So, yeah, we should keep slice set up just in case. We should not specifically declare the response files. We need to figure out how to specify the reviewer commit context selection. I didn't see that specified in here at all. So we need to figure that out. So, running an experiment. We want to fold this stuff into the experimental situation actually. So, with experiments, you copy in the currently you copy in the, and you replace that one file, the one YAML file, the state transition config YAML file. But now in this new world, we should be moving the whole directory. And that directory can just specify like this is the state at which the experiment is done. So that will make the execution of the experiments basically the same. It's the experiments YAML file. We'll tell it when to stop.

**Refined**

> Okay, so first, open questions. I think pre-planning is kind of a fully bona fide state, but the only transition that it's allowed to do is the manual one. And so it's considered a state that the quest runner won't start if it's still in that state. So, yeah, we should keep slice set up just in case. We should not specifically declare the response files. We need to figure out how to specify the reviewer commit context selection. I didn't see that specified in here at all. So we need to figure that out.
>
> So, running an experiment. We want to fold this stuff into the experimental situation, actually. So, with experiments, you copy in the, and you replace that one file, the one YAML file, the state transition config YAML file. But now, in this new world, we should be moving the whole directory. And that directory can just specify, like, this is the state at which the experiment is done. So that will make the execution of the experiments basically the same. It's the experiments YAML file. We'll tell it when to stop.

</details>

Record: `6CBAD565-AE27-42F9-8185-DF5F0A3B5FAF`

## 8. Explicit “sorry” correction

Why selected: the speaker explicitly replaces a likely homophone, making this a clean undo contract.

Focused transformation:

> **Original:** “includes a health... Sorry, that includes a help message”
>
> **Refined:** “includes a help message”

Manual question: this is the clearest example in the set—does the complete output preserve everything else as desired?

<details>
<summary>Complete original and refined passage</summary>

**Original**

> Okay, one last thing before we run the quest. So there's a preamble that it sends to every agent that includes a health... Sorry, that includes a help message for the CLI and maybe some other stuff. I'm not sure entirely what's there. I think it includes the metadata of what it's currently on. I don't think that is handled in the current spec. Could you please add one more file that explains how that preamble is supposed to get written in the new world?

**Refined**

> Okay, one last thing before we run the quest. So there's a preamble that it sends to every agent that includes a help message for the CLI and maybe some other stuff. I'm not sure entirely what's there. I think it includes the metadata of what it's currently on. I don't think that is handled in the current spec. Could you please add one more file that explains how that preamble is supposed to get written in the new world?

</details>

Record: `CB2BEEB8-19B7-40C5-9E37-5B4EC6FF1BF8`

## 9. Stutter plus likely homophone inside tangled syntax

Why selected: this passage combines two local speech/recognition errors with intentionally informal wording that should remain yours.

Focused transformation:

> **Original:** “everything else should say the same it's just we're moving the logic from Python code to this to this language”
>
> **Refined:** “everything else should stay the same; it's just we're moving the logic from Python code to this language”

Manual question: `say` → `stay` and removing the duplicated `to this` look strongly supported; did the rest of the sentence receive too much grammatical restructuring?

<details>
<summary>Complete original and refined passage</summary>

**Original**

> Can you go ahead and specify the unspecified stuff with the specific intent that the on-disc format and the commit format stays as close as possible to the existing thing for basically everything but the state transition config file. So everything else should say the same it's just we're moving the logic from Python code to this to this language. If there are any places where we are adding too much ad hoc crap to the workflow language call that out but that is the goal that the execution basically does not change and the on-disc format basically does not change but the implementation changes.

**Refined**

> Can you go ahead and specify the unspecified stuff with the specific intent that the on-disc format and the commit format stay as close as possible to the existing thing for basically everything but the state transition config file? So everything else should stay the same; it's just we're moving the logic from Python code to this language. If there are any places where we are adding too much ad hoc crap to the workflow language, call that out, but that is the goal: that the execution basically does not change and the on-disc format basically does not change, but the implementation changes.

</details>

Record: `86799D6A-1B3B-4BFA-B36B-12572E1A0A2C`

## 10. Likely missing negation that the refiner refuses to invent

Why selected: context strongly suggests Whisper dropped “don't,” but inserting or removing a negation can reverse the user's instruction and is therefore unusually risky.

Focused transformation:

> **Original:** “but you can check the logs. make any changes. Just tell me why this happened.”
>
> **Refined:** “but you can check the logs. Make any changes. Just tell me why this happened.”

Manual question: did you say “don't make any changes”? If so, should the refiner infer a missing negation from “Just tell me why,” or is preserving the ambiguous transcript the safer behavior?

<details>
<summary>Complete original and refined passage</summary>

**Original**

> We recently added a new state and tried to make the runner substantially more flexible. First of all, check to make sure that the quest is still running and that this is just a UI error and then can you figure out why the UI is caring about matching the state in this way. You're not going to be able to curl the actual server because of your sandbox, but you can check the logs. make any changes. Just tell me why this happened.

**Refined**

> We recently added a new state and tried to make the runner substantially more flexible. First of all, check to make sure that the quest is still running and that this is just a UI error, and then can you figure out why the UI is caring about matching the state in this way? You're not going to be able to curl the actual server because of your sandbox, but you can check the logs. Make any changes. Just tell me why this happened.

</details>

Record: `C6CAB855-2325-4A38-84B4-5C7A8190612C`

## Initial read

The new prompt is better at explicit corrections and simple stutters without sacrificing the synthetic fidelity controls, but it is not an unconditional improvement over v3.

Across five synthetic trials, v4 scored 199/225 versus v3's 198/225. Fidelity remained 30/30 and undos improved from 38/40 to 40/40; strict ASR exactness improved only slightly, from 22/40 to 24/40. Across all 756 real passages, mean word edit fraction rose from 2.16% to 2.66%, while both versions shortened 17 passages by more than 20%.

The blinded 160-record comparison showed the same tradeoff:

| Judge | Metric | v3 | v4 |
|---|---|---:|---:|
| Terra | correction | 3.33 | **3.44** |
| Terra | overediting | **0.07** | 0.14 |
| Terra | overall | **4.73** | 4.72 |
| GPT-5.5 | correction | 3.48 | **3.53** |
| GPT-5.5 | overediting | **0.03** | 0.16 |
| GPT-5.5 | overall | **4.79** | 4.73 |

The real examples explain the numbers: “fix awkward speech” can reopen a smaller version of the original over-editing problem. Luna sometimes treats permission to repair one local stumble as permission to smooth punctuation and grammar throughout the passage.

A stricter span-local follow-up (`conservative_v5.md`) preserved fidelity but reduced synthetic ASR exactness to 19/40, so it was rejected rather than used for this review.

The next prompt iteration should probably distinguish the passes even more sharply: first identify exact repair spans, then prohibit edits outside those spans except minimal terminal punctuation and high-confidence proper-name casing. The examples above are intended to decide whether that additional restriction is desirable.
