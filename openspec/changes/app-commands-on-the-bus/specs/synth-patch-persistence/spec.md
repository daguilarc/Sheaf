# Delta — `synth-patch-persistence`

A patch whose depths exceed available storage applies with depths missing
and reports Ok, at startup and while running. The engine already retries an
arena-exhausted patch message at both of its apply sites (inline before
audio; stash and retry while running); a storage shortfall is the second
reason at both, through one provisioning helper.

## ADDED Requirements

### Requirement: spp-12 — Load: a patch never applies with a depth missing
WHEN a patch message would leave a group's available depth storage below that group's low watermark, THE engine SHALL provision that group with the shortfall plus the watermark and then apply the message whole, at each site that applies patch messages: before audio, inline on the initializing thread and before the first block, as an exhausted arena is grown inline there; and while running, by stashing the message as it stashes one that exhausts the arena, under a storage reason of its own that the arena's growth cap never clears, with the per-group need written beside the stash for the message thread to provision, holding the stash while either reason is pending, re-stashing a retry that still reports the shortfall, and retrying on the first block after the message thread has provisioned and cleared the reason, the running patch untouched until the message applies whole. The arena's own growth SHALL stay as each site has it; the storage provisioning SHALL be one helper the message thread's existing storage-batch handling also calls. A message applied while a running Load waits is overwritten by the patch when it applies, and the stash SHALL say so.

#### Scenario: A depth-heavy patch opens whole at startup
- **WHEN** an engine initializes on data paths whose last-opened patch needs more depths than the launch batch leaves above the watermark
- **THEN** the patch is applied whole before the first audio block

#### Scenario: A depth-heavy patch loads whole while running
- **WHEN** a patch with more depths than available storage is loaded on a running engine that ticks once per several blocks
- **THEN** the running patch is unchanged across every block before the provisioning tick, and every depth of the loaded patch is live after the retry

#### Scenario: The arena retry is unchanged
- **WHEN** the serialization arena is exhausted during a load
- **THEN** the existing stash-and-retry behaviour is observed unchanged

#### Scenario: A Load that fits leaves one press of storage behind it
- **WHEN** a patch that fits is loaded and a press that allocates depths follows in the same tick
- **THEN** the press finds at least the watermark available after the Load applies
