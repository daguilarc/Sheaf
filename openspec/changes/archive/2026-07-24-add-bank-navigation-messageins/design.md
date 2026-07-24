## Context

`MessageInBus` currently routes absolute `SelectParamBank` messages to `ParameterManager::SelectBankForSlot`. The manager owns the ordered bank collection and effective reset/random/random-mod state, while each `BankSlot` stores only its selected-bank pointer. Modified absolute selection applies the effective modifier to the requested bank and leaves selection unchanged.

Relative navigation differs in one important respect: an unmodified message derives a destination from the addressed slot's current bank, but a modified message acts on that current bank rather than either neighboring destination. The messages must also participate in MIDI profile persistence and the controller configuration view model.

## Goals / Non-Goals

**Goals:**

- Add `NextParamBank` and `PrevParamBank` message types and factories carrying `slotIx`.
- Wrap unmodified navigation over all manager-owned bank indices.
- Apply the effective modifier to the addressed slot's current bank without navigation.
- Preserve safe no-op behavior for invalid or incomplete runtime state.
- Make both messages serializable, configurable, describable, and deterministically testable.

**Non-Goals:**

- Change absolute `SelectParamBank` behavior.
- Add bank history, per-slot bank lists, configurable navigation ranges, or persisted selection state.
- Make relative navigation blockable in controller configuration.
- Give momentary navigation actions a persistent output-feedback on state.

## Decisions

### Keep relative routing in `ParameterManager`

Add one manager operation that accepts a slot and direction. It validates the slot, resolves the selected bank's index in the manager-owned bank vector, and then either applies the effective modifier or selects the wrapped neighbor.

This keeps ordering, ownership, scene state, and modifier precedence together. Computing the destination in `MessageInBus` would put live model traversal in the transport layer. Putting it in `BankSlot` would require the slot to know the manager's global bank ordering and modifier state.

### Resolve the current bank before acting

An invalid slot, an empty bank vector, a null selected bank, or a selected pointer not owned by the manager is a no-op. With a valid current bank:

- next maps the last bank to index `0` and otherwise selects index `current + 1`;
- previous maps index `0` to the last bank and otherwise selects `current - 1`;
- any effective reset/random/random-mod modifier is applied to the current bank and selection is not changed.

Modifier handling occurs before destination calculation so both directions have identical modified behavior. Existing modifier precedence remains authoritative.

Alternative considered: let a missing selection establish bank `0` for next and the last bank for previous. Requiring a current bank matches the operation's relative meaning and avoids silently creating selection state from incomplete initialization.

### Use existing message and persistence conventions

The public enum/factory names are `NextParamBank` and `PrevParamBank`; serialized message type names are `nextParamBank` and `prevParamBank`. Both use the existing `slotIx` field and carry no bank index.

The controller system-message catalog exposes “Next Bank” and “Previous Bank.” For these kinds, the row's single `Arg` field reads and writes `slotIx`; changing kinds preserves the current primary argument through the existing view-model conversion path. They produce no release message and remain non-blockable individual mappings.

Alternative considered: add a dedicated slot column. The request defines slot as the message argument, and reusing `Arg` avoids changing the row schema for two action messages.

### Treat feedback as stateless

Profile feedback may retain the action message, as it does for other system mappings, but `SystemMessageOutputInfo` returns the default off state for relative navigation. There is no single selected boolean represented by a next/previous action.

Alternative considered: color the action from the current bank. That would invent a dynamic semantic not shared by other stateless transport actions and is outside the requested behavior.

### Test the public paths and state-machine integration

Focused tests cover factories, bus routing, forward/backward wrapping, all three modifiers, precedence reuse, invalid state, serialized profile round trips, output-info behavior, configuration catalog/argument editing, and message descriptions. The deterministic randomized message-bus and controller view-model simulations add the two operations to their action models so interaction with existing state remains covered.

## Risks / Trade-offs

- [A bank is already associated with another slot] → Relative selection uses the same `BankSlot::SelectBank` association contract as absolute selection; tests keep relative behavior aligned with that existing contract rather than defining a second ownership policy.
- [New enum cases are missed in exhaustive switches] → Compile with warnings-as-errors where configured and add focused serialization, description, output-info, and view-model tests.
- [Unsigned previous-index arithmetic underflows] → Branch explicitly at index `0` before subtracting.
- [Action feedback is visually unlit] → Keep the state truthful and stateless; controller profiles may still disable output feedback for these mappings.

## Migration Plan

No persisted profile migration is required. Existing message names and records remain unchanged; profiles may begin storing the two new type names with `slotIx`. Rollback consists of removing mappings that use those new names before loading profiles in an older build.

## Open Questions

None.
