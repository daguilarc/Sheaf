# Dictator refiner benchmark and prompt study

Date: 2026-07-13

## Executive recommendation

The current system is over-editing because the prompt explicitly asks it to rewrite for clarity, remove rambling, and improve grammar. The behavior is primarily a prompt problem, not a GPT-4.1-mini limitation.

Recommended pilot configuration:

- Model: `gpt-5.6-luna`
- Reasoning effort: `low`
- Base prompt: [`conservative_v4.md`](../../experiments/refiner-benchmark/prompts/conservative_v4.md)
- Blark rules: [`blark_v3.md`](../../experiments/refiner-benchmark/prompts/blark_v3.md)
- Borg rules: [`borg_v4.md`](../../experiments/refiner-benchmark/prompts/borg_v4.md)

The subsequent rollout work added explicit reasoning configuration, so Dictator can now reproduce the tested Luna-low setting.

Keep `gpt-5.5` at low reasoning as the challenger/fallback. It was more consistent than Luna on strict synthetic ASR/undo outputs, while Luna-low was faster and received slightly higher real-transcript judge scores.

Do not turn reasoning completely off if Borg is expected to carry arbitrary semantic transforms such as “make that a sonnet.” Both Luna-none and GPT-5.5-none sometimes ignored that instruction. Low reasoning performed the transform reliably in the final repeated probe. If Borg is restricted to simple replacements or handled structurally in code, `none` becomes a reasonable latency configuration.

## Data and methodology

The source corpus is `/Users/joyo/Sheaf/data/dictator/interactions` in the main worktree.

- 855 recorded interactions from 2026-06-07 through 2026-07-13
- 756 usable successful `revision` interactions
- All recorded refinements used `gpt-4.1-mini` and `intent_refiner_v1.md`
- 11 real transcripts contain the word Blark or Borg; several are prose discussing the feature, not commands

The stored output was treated as the historical baseline, not ground truth. The evaluation had three layers:

1. Deterministic corpus metrics over all 756 real interactions: lexical edit fraction, length change, marker presence, latency, and token use.
2. Blinded LLM judging over a stratified 160-record real sample. The sample includes all marker records, high-edit outliers, and all transcript-length bands. Both GPT-5.6 Terra and GPT-5.5 judged randomly relabeled outputs under a rubric that penalized style editing.
3. A 45-case synthetic suite with explicit expected outputs: 8 undo cases, 8 plausible ASR errors, 6 fidelity controls, 3 duplicate controls, 9 Blark cases, 8 Borg cases, and 3 mixed cases. The final Luna-low and GPT-5.5-low configurations were each run five times, for 225 outputs per model.

The reusable harness is [`benchmark.py`](../../experiments/refiner-benchmark/benchmark.py), and the synthetic cases are in [`datasets/synthetic.jsonl`](../../experiments/refiner-benchmark/datasets/synthetic.jsonl). Raw generated output and judge traces are retained under the ignored `data/dictator/experiments/refiner-benchmark/2026-07-13-refiner-study/` directory in the canonical checkout.

## What “overdoing it” means in this corpus

The current baseline makes large lexical changes even when no correction requires them:

| Metric over 756 real transcripts | Current baseline |
|---|---:|
| Mean word-sequence edit fraction | 24.6% |
| Median word-sequence edit fraction | 22.7% |
| Outputs shortened by more than 20% | 178 (23.5%) |
| Outputs shortened by more than 40% | 13 |
| Same words apart from case/punctuation | 34 (4.5%) |

Representative failure shapes include:

- A long dictated request becomes a formal numbered plan rather than remaining the request.
- Casual first-person prose becomes organized product prose with headings and paragraph restructuring.
- “Logical intelligence. I'm gonna make theorem-proofing agents.” becomes “I'm going to create theorem-proving agents focused on logical intelligence.” The facts are similar, but the voice, order, and rhythm are rewritten.
- “Fuck Elon Musk.” becomes “No refinements applied due to inappropriate language.” This is censorship and content replacement, not refinement. All conservative candidates preserved the sentence exactly.

The two independent judges agreed on the dominant baseline failure modes:

| Flag on 160 real cases | Terra judge | GPT-5.5 judge |
|---|---:|---:|
| Synonymized | 94 | 90 |
| Professionalized | 90 | 84 |
| Grammar overreach | 71 | 41 |
| Deleted content | 36 | 54 |
| Summarized | 18 | 24 |
| Reorganized | 37 | 22 |

This is directly predicted by the current prompt. It says to “rewrite,” correct “grammar, punctuation, and clarity,” and remove “rambling.” “Preserve tone” is too weak to countermand those active rewrite instructions.

## Real-transcript judge results

The judged candidates used the final conservative base prompt and the preceding marker-rule revision. Marker precedence was then refined separately because only 11 real records exercise it.

| Candidate | Terra overall | GPT-5.5 overall | Better than baseline (Terra) | Better than baseline (GPT-5.5) |
|---|---:|---:|---:|---:|
| Current baseline | 2.93 | 3.10 | — | — |
| GPT-4.1-mini + conservative prompt | 4.48 | 4.46 | 131/160 | 130/160 |
| GPT-5.5, reasoning none | 4.58 | 4.69 | 138/160 | 143/160 |
| Luna, reasoning none | 4.49 | 4.61 | 138/160 | 143/160 |
| Luna, reasoning low | **4.68** | **4.76** | **140/160** | **145/160** |

Both judges were shown randomly assigned candidate labels. The agreement is strong enough to conclude that the conservative prompt is a major improvement. The much smaller differences among the conservative candidates should be treated as directional.

The full 756-record reruns show how dramatically the prompt changes edit behavior:

| Configuration | Mean edit fraction | Median | Same words except case/punctuation | Shortened >20% |
|---|---:|---:|---:|---:|
| Current baseline | 24.62% | 22.73% | 34 | 178 |
| GPT-4.1-mini + conservative | 1.89% | 0% | 531 | 15 |
| Luna none + conservative | 2.02% | 0% | 530 | 16 |
| Luna low + conservative | 2.16% | 0% | 507 | 17 |
| GPT-5.5 none + conservative | 2.33% | 0% | 468 | 17 |

Low edit distance is a guardrail, not the objective: a refiner still has to fix Whisper errors and self-corrections. The judge and synthetic results are needed to distinguish good corrections from mere copying.

## Synthetic and repeated reliability results

The current GPT-4.1-mini prompt passed 21/45 synthetic cases (46.7%) in its probe and preserved none of the six already-good casual prose controls exactly.

With the final prompt set and low reasoning, five repeated trials produced:

| Category | Luna low | GPT-5.5 low |
|---|---:|---:|
| Overall pass rate | 198/225 (88.0%) | **208/225 (92.4%)** |
| Fidelity controls | 30/30 | 30/30 |
| Undo exact | 38/40 | **40/40** |
| ASR exact | 22/40 | **31/40** |
| Blark exact | 43/45 | 43/45 |
| Borg deterministic exact | 30/35 | 30/35 |
| Open-ended sonnet transform | 5/5 | 5/5 |
| Marker leakage on executable cases | 0 | 0 |

Several strict “failures” are harmless casing or punctuation differences, such as `GitHub action` versus `GitHub Action`; token similarity is 1.0. The repeated results therefore understate semantic success, but they are useful for comparing configurations.

The real marker examples also behaved correctly under the final low-reasoning prompt:

- Well-formed Hammer spans were transformed.
- A Blark span without a recognized format was preserved rather than guessed.
- Punctuation after the format name no longer broke the span.
- “verbatim” Borg instructions removed the instruction and preserved the outside text.
- The real “make that a sonnet” example produced a sonnet under both Luna-low and GPT-5.5-low.

## Reasoning and latency

The full-corpus runs measured request latency from the benchmark client:

| Configuration | Mean | p50 | p90 | Reasoning tokens |
|---|---:|---:|---:|---:|
| GPT-4.1-mini | 2.31 s | 1.40 s | 4.67 s | 0 |
| GPT-5.5 none | 1.74 s | 1.34 s | 2.81 s | 0 |
| Luna none | **1.06 s** | **0.90 s** | **1.54 s** | 0 |
| Luna low | 1.27 s | 0.96 s | 2.45 s | 31,729 across 756 calls |

Turning reasoning off is not quality-neutral:

- Both real-transcript judges gave Luna-low a higher overall score than Luna-none.
- Luna-none had more missed ASR and missed self-correction flags.
- Luna-none and GPT-5.5-none sometimes ignored a semantic Borg transform even after prompt precedence was clarified; low reasoning performed it in all five repeated final trials.
- Luna-none is still far better than the current baseline and is approximately 17% faster by mean latency.

Recommendation: use `low` initially. Reconsider `none` after Blark/Borg parsing is moved out of natural-language inference or if production telemetry shows the quality difference does not matter for the actual command mix.

OpenAI's current model guidance identifies Luna as the efficient high-volume tier and Terra as the balanced tier. It also documents that GPT-5.6 supports `none`, `low`, `medium`, `high`, `xhigh`, and `max`, with omitted effort defaulting to `medium`. See the [current model guide](https://developers.openai.com/api/docs/guides/latest-model.md), [Luna model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna), and [GPT-5.6 prompting guide](https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6.md).

## Prompt changes that mattered

The base prompt now establishes an explicit edit budget:

- Default to copying.
- Allow only self-correction/undo resolution, strongly supported ASR correction, obvious accidental duplication removal, minimal punctuation/capitalization, and marker execution.
- Protect vocabulary, order, tone, informality, fragments, hedges, humor, intensity, and detail.
- Explicitly prohibit summarizing, reorganizing, professionalizing, smoothing, tightening, and synonym substitution.
- Prefer no edit when uncertain.
- State that optional context disambiguates recognition; it does not authorize rewriting.

The marker prompts now define syntax and precedence rather than saying merely to preserve the rest “normally”:

- Blark requires two markers and a recognized format immediately after the opener.
- Punctuation around the marker or format name is tolerated.
- Invalid, unmatched, or prose mentions are preserved.
- Borg declares that only inside-marker text is meta-instruction; outside imperatives remain content.
- A Borg instruction can override the no-rewrite rule for exactly the requested transformation and nothing else.
- After the requested transformation, the complete outside text receives the default conservative pass.

## Runtime changes required for the tested configuration

The current `OpenAIRefinementEngine.ResponsesPayload` sends only `model`, `instructions`, and `input`. To reproduce the recommendation, add a validated optional reasoning effort to Dictator runtime configuration and send:

```json
{
  "model": "gpt-5.6-luna",
  "reasoning": { "effort": "low" }
}
```

Implemented configuration surface:

```json
{
  "cloud_model": "gpt-5.6-luna",
  "reasoning_effort": "low",
  "system_prompt": "intent_refiner_conservative_v4.md"
}
```

For GPT-4.1 models, omit the reasoning field. Validate the configured effort against the selected model rather than sending an unsupported field.

Also consider sending `"store": false`. The Responses API currently reports stored responses by default when this field is omitted, while Dictator already retains the desired local interaction log. This is a privacy/retention decision rather than a refinement-quality change.

## Marker architecture recommendation

Prompt improvements made markers much better, but Blark should not fundamentally be an LLM problem.

Recommended long-term split:

1. Parse Blark spans deterministically before refinement. The command vocabulary and transformations are a small grammar, so code can provide exact behavior, explicit malformed-span handling, and direct unit tests.
2. Parse Borg boundaries deterministically, but keep the inside instruction semantic. Render the request to the model as explicit structured segments such as `<dictation>` and `<instruction>` rather than asking the model to discover which occurrences are delimiters.
3. Run the normal conservative refinement on the complete transformed transcript, as requested, rather than freezing all outside text.
4. Preserve malformed/unmatched spans and record a marker-parse diagnostic instead of guessing.

This removes false activation when the user talks about Blark/Borg and makes casing commands reliable without spending reasoning tokens.

## Turning the live corpus into a durable benchmark

Keep the historical corpus as a distribution sample, not a target-output dataset. The useful benchmark should have three partitions:

1. `real-regression`: stratified real Whisper transcripts with historical output, context, model, and prompt metadata. Use blind judges plus edit guardrails; do not optimize toward the historical output.
2. `golden-disagreements`: a small human-reviewed set created from cases where strong candidates disagree, judges disagree, or edit distance is unusually high. The user only needs to review high-information cases, not all 756.
3. `synthetic-contracts`: exact undo, common ASR confusion, Blark grammar, Borg boundaries, malformed markers, multiple markers, and long mixed-prose cases.

Suggested release gates:

- No regression on user-reviewed golden cases.
- 100% exact deterministic Blark behavior once parsed in code.
- No marker leakage for valid spans.
- 100% fidelity on unchanged-prose controls.
- Judge mean overall at least 4.6/5 and mean over-editing no more than 0.2 on the fixed real sample.
- Compare same model/reasoning/prompt one variable at a time.
- Run marker/undo contracts repeatedly to expose stochastic failures.
- Track p50/p90 latency, input/output/reasoning tokens, refusal/censorship rate, and lexical edit distribution.

## Limitations

- There is no audio or human transcript ground truth, so real ASR correction accuracy cannot be measured directly.
- The historical output is only “lived with,” not approved as correct.
- Synthetic ASR errors are plausible but may not match Whisper's actual error distribution.
- LLM judges have bias. Random candidate labels and two independent judge models reduce but do not eliminate it.
- One model response is stochastic. The repeated synthetic trials address this for the most important contracts, but the full corpus was run once per configuration.
- Only two selected-text interactions exist, so selected-text transform behavior was not meaningfully evaluated.

## Practical rollout

1. Deploy only the conservative prompt files while staying on GPT-4.1-mini if a zero-runtime-change rollback point is desired.
2. Use the explicit `reasoning_effort` support in the Swift config and Responses payload.
3. Pilot Luna-low with the final prompt set and retain GPT-5.5-low as a switchable challenger.
4. Capture prompt/model/reasoning metadata on every interaction.
5. Add a lightweight thumbs-down or “show raw/use raw” action; feed those cases into `golden-disagreements`.
6. Move Blark parsing into code, then reconsider Luna-none for ordinary non-Borg refinement.

## Final prompt-selection addendum

The rollout selects conservative v4 rather than v3. V4 incorporates the useful part of Claude's proposal: explicit handling for immediate stutters, pure hesitation tokens, clear abandoned starts, and correction cues, while keeping v3's loss-minimizing edit budget and uncertainty rule. Across five Luna-low synthetic repetitions, v4 scored 199/225 versus v3's 198/225, improved undo cases from 38/40 to 40/40 and ASR cases from 22/40 to 24/40, and retained 30/30 fidelity controls. Its higher full-corpus edit fraction (2.66% versus 2.16%) is expected from the additional speech-artifact repairs and remains far below the 24.62% historical baseline.

The semantic-landmine review did not justify guessing at dropped negation, ambiguous numbers, paths, commands, or identifiers. V4 therefore retains the decisive rule: if it is unclear whether text is a stutter, correction, recognition error, or intentional wording, copy it.
