# Crash Resistance

Arbitrary crash resistance is out of scope.

The runtime still provides a reasonable level of crash resistance using message IDs and replay.

## Message IDs

Every message has a unique ID.

Pi events already provide unique IDs.

All generated runtime events also receive unique IDs.

## Received ID Table

Each agent maintains an in-memory hash table of message IDs it has received.

This table is used to detect whether a queued message has already been delivered to that agent.

## Replay

During replay, each agent scans its `session.jsonl` file to populate its in-memory hash table with already received message IDs.

After the hash table is populated, each agent re-queues any message whose ID is not in the recipient's hash table.

The principle is:

- If a message ID is in `session.jsonl`, the message is delivered.
- If a message ID is not in `session.jsonl`, the message must be re-queued.

This is not perfect, but it addresses most crash scenarios.

If a message ID is in `session.jsonl`, the agent will wake up and retry or at least detect that it has not processed the message.

