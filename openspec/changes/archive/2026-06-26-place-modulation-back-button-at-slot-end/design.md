## Context

`BankSlot` owns the ordered list of physical encoder positions. `Bank` owns the current top-level and modulation-view mappings, but it currently infers modulation-view shape from its compact top-level bank mappings. That is sufficient for packed views, but it cannot represent an empty middle slot position when the return cell should live at the final physical position.

## Decisions

1. **Slot-routed press passes physical layout to the bank.**
   `BankSlot::HandlePress` will call a layout-aware bank press path with `physicalEncoders_`. This lets the bank place modulation-depth cells at the first slot positions and the selected/return cell at `physicalEncoders_.back()`.

2. **Direct bank press keeps compact fallback semantics.**
   Existing direct tests and non-slot callers can continue calling `Bank::HandlePress(encoderId)`. That path will use the bank's top-level mapping order as its layout, preserving current behavior for callers that do not have a slot.

3. **More modulators than slot depth positions is an error.**
   A slot with `N` positions has `N - 1` modulation-depth positions because the final position is reserved for return. Opening a modulation view for a parameter whose group has `numModulators > N - 1` will throw `std::logic_error`. This is a configuration error: the UI cannot faithfully present all modulators while preserving a stable return position.

4. **Gaps are represented by absent visible cells.**
   `BankSlot::PopulateUIState` already disconnects physical positions whose encoder is not present in the bank's visible mapping. The implementation can leave the middle position absent, and the existing UI-state path will mark it disconnected.

## Risks

- Direct bank callers with too few compact top-level cells for a group's modulator count will now see a configuration error instead of silently truncating. Slot-routed callers get the intended physical layout semantics.
- Randomized tests mirror bank/slot behavior, so their oracle must learn the slot layout instead of assuming packed bank mappings only.
