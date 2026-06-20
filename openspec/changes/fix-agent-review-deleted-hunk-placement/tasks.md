## 1. Regression Coverage

- [ ] 1.1 Add an Agent Review state test that creates a real Git pure-deletion hunk after an unchanged context line and asserts inline row order is context-before, deletion, context-after.
- [ ] 1.2 Include a boundary-shaped fixture similar to a struct opening brace so the deleted row must remain inside the block where it originally appeared.

## 2. Core Implementation

- [ ] 2.1 Update the inline diff document builder to treat hunks with `newCount === 0` as inserting after `newStart` while leaving non-zero new ranges on the existing insertion path.
- [ ] 2.2 Preserve existing row ids, hunk ids, old/new line metadata, and client-facing state shape.

## 3. Verification

- [ ] 3.1 Run the targeted Sheaf Chat Agent Review tests covering REST/state inline diff output.
- [ ] 3.2 Run the broader Sheaf Chat test command used for this project if the targeted test command passes.
- [ ] 3.3 Confirm the OpenSpec change status is apply-ready after implementation tasks are complete.
