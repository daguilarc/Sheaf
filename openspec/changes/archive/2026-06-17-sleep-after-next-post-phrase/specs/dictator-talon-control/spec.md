## ADDED Requirements

### Requirement: tc-7 — Bridge sleep: Defer until phrase finalization
WHEN the Talon bridge receives a sleep request while Talon speech is enabled, THE Talon bridge SHALL disable speech after the next Talon `post:phrase` callback, and SHALL disable speech after a bounded fallback timeout if no `post:phrase` callback arrives.

#### Scenario: Sleep waits for phrase finalization
- **WHEN** the bridge receives `POST /sleep` while speech is enabled and Talon later emits `post:phrase` before the fallback timeout
- **THEN** the bridge disables speech after the `post:phrase` callback and returns an asleep status

#### Scenario: Sleep falls back when no phrase finalizes
- **WHEN** the bridge receives `POST /sleep` while speech is enabled and no `post:phrase` callback arrives before the fallback timeout
- **THEN** the bridge disables speech after the fallback timeout and returns an asleep status

#### Scenario: Duplicate sleep joins pending sleep
- **WHEN** the bridge receives another `POST /sleep` while a deferred sleep is already pending
- **THEN** the bridge coalesces the request with the existing pending sleep and does not register an additional phrase callback or fallback timer

#### Scenario: Sleep while already asleep
- **WHEN** the bridge receives `POST /sleep` while speech is already disabled
- **THEN** the bridge returns an asleep status without waiting for `post:phrase`
