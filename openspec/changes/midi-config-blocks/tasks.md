# Tasks: midi-config-blocks

## 1. Library: schema, ordering, blocks (JUCE-free)

- [x] 1.1 `SystemAddressSchema(kind)` shared table driving row fields/headers/block forms; twister's address becomes logical button 0..5 (stored `cc = 8 + button`, fixed ch3 display-only, out-of-range refused); update existing view-model tests (sru-8)
- [x] 1.2 `NormalizeMidiProfileConfig` (turns/pushes by slot,pos; system by the D2 total `SystemMessageSortKey` — every MessageIn type, then address tuple, then stable original order; gestures by ix); unit tests incl. stability, modifier set/release variants, and persistence-shape invariance (sru-9)
- [x] 1.3 `MidiConfigBlocks.hpp/.cpp`: EncoderBlock/AnalogBlock/SystemBlock structs (SystemBlock carries `outputFeedback` and directional inclusive rectangle corners) + Expand* functions with full validation (all-or-nothing), feedback = press per cell, release patterns per type; unit tests per form incl. row-major, column-major, and descending-row traversal (sru-10)
- [x] 1.4 Reconstruct* functions (greedy runs, ±y rectangles, ≥2 threshold, twister never blocks, non-blockable types individual, feedback/outputFeedback run consistency); round-trip property tests (Expand∘Reconstruct == sorted config for every config incl. duplicates; Reconstruct∘Expand == same block for any block reconstruction can itself produce), broken-run splits, 1×N/N×1, ragged remainders, the default WRLD.Bldr 8×2 descending bank grid (sru-10)

## 2. View model: presentation state and operations

- [x] 2.1 Presentation state per (controller, section): built at expand transition, identity-keyed re-resolve on Rebuild without re-grouping, discarded on collapse; block rows expose their form's fields; stability tests (sru-11)
- [x] 2.2 Block row editing: whole-block validate → replace-cells commit (delete old identities, insert expansion, normalize) keeping the row in place; tests (sru-10, sru-11)
- [x] 2.3 Add "+" (next-free single config per group) and "+B" (block with next-free seed, committed as expansion), appending without re-grouping; delete for individual and block rows, none for config-level rows; tests (sru-11)
- [x] 2.4 Commit paths all normalize (sru-9); existing viewmodel tests updated for schema/ordering changes

## 3. Renderer and verification

- [x] 3.1 ControllersPage renders presentation rows: block rows with their field set (message-type combo over the three blockable types, row-major toggle), group headers with +/+B, per-row delete buttons; deferred-commit discipline unchanged (sru-5)
- [x] 3.2 Full suite + apps build green, zero warnings; launch smoke
- [x] 3.3 Sync delta specs to main specs; user visual check: default wrldbldr shows 1 turn block + 1 push block + bank/scene/gesture blocks + individual modifiers; collapse/re-expand reconstructs; +/+B/delete flows
