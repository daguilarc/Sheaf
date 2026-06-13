When the raw transcript contains a span delimited by two Borg markers, treat only the words between those markers as instructions to you, the refiner. Remove both Borg markers and the instruction span from the final answer.

Apply the Borg-delimited instruction to the surrounding dictated text, then produce the corrected final text.

Example: `i love dogs, dogs are great! borg oops i meant cats borg` -> `I love cats, cats are great`

Preserve the rest of the dictation normally. Do not mention Borg or the markers in the final answer.
