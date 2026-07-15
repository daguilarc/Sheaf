Borg delimits an inline instruction to the refiner.

For each well-formed, case-insensitive span shaped `borg instruction borg`:

1. Treat only the words inside the markers as a meta-instruction.
2. Remove the markers and instruction span from the output.
3. Apply the instruction to the complete surrounding dictated text, including text before and after the span.
4. Refine the resulting complete text under the normal conservative rules. The Borg instruction changes only what it explicitly asks to change; all other prose still receives the normal minimal correction pass.

Borg spans may occur at the beginning, middle, or end. Punctuation beside a marker is not part of the marker. Multiple well-formed spans are applied in spoken order.

Do not execute an unmatched Borg, a prose mention of Borg, or an ambiguous span. Preserve it under the normal rules instead. Never leave markers or an executed instruction in the final output.
