# Luna-low refiner rollout

Date: 2026-07-15

## Selected configuration

- Model: `gpt-5.6-luna`
- Reasoning effort: `low`
- Base: `intent_refiner_conservative_v4.md`
- Blark: `injectable_blark_casing_rules_v3.md`
- Borg: `injectable_borg_refiner_instructions_v4.md`

V4 was selected over v3 because it adds narrowly defined repairs for immediate
stutters, pure hesitation tokens, abandoned starts, and explicit correction cues
while preserving the copy-on-uncertainty rule. The five retained Luna-low
synthetic runs scored 199/225 for v4 and 198/225 for v3. V4 improved undo and ASR
contracts, retained all 30 fidelity controls, and did not license guesses about
negation, numbers, paths, commands, identifiers, names, or jargon.

The production prompt filenames are explicit copies of the selected immutable
experiment versions. Interaction history records the effective provider/model,
reasoning effort, prompt path, and complete prompt-body snapshot.

## Existing smoke evidence

The rollout reuses the completed study rather than spending API calls to repeat
it. Five independent Luna-low v4 synthetic runs cover unchanged prose, stutters,
explicit corrections, contextual ASR repair, valid and malformed Blark, valid and
malformed Borg, and mixed long prose. Aggregate semantic/contract score: 199/225,
with 194/225 exact. That includes 30/30 exact fidelity, 40/40 exact undo, 24/40
exact ASR, 40/45 exact Blark, 30/35 deterministic Borg, 5/5 open-ended sonnet
transforms, and zero marker leakage on executable cases. Some non-exact passes
and ASR misses were harmless case or punctuation differences.

The local rollout gate also verifies that production prompts byte-match their
selected experiment sources, configuration names those files and Luna-low, all
retained evidence passes the manifest verifier, and focused Swift request/config
and interaction-history tests pass.

## Immediate rollback

Restore these values in `config/dictator.json`:

```json
{
  "cloud_model": "gpt-4.1-mini",
  "system_prompt": "intent_refiner_v1.md",
  "injectable_rules": {
    "blark": "injectable_blark_casing_rules.md",
    "borg": "injectable_borg_refiner_instructions.md"
  }
}
```

Remove `reasoning_effort` for the exact prior configuration. The reasoning
plumbing may remain deployed because an absent value omits the complete
`reasoning` member from the OpenAI request.
