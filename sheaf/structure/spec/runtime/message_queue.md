# Message Queue

Agents send messages to each other through JSONL message queues.

Messages are received in order.

Each message is one JSON object serialized on one line.

## Message Envelope

Every message has a unique `id`.

Message IDs come from Pi events when available.

Generated runtime events also receive unique IDs.

```json
{
  "id": "<message-id>",
  "type": "<message-type>",
  "payload": {}
}
```

## Message Types

Message routing depends on the message type:

- `merge`: tells the receiving agent to rebase its branch onto the message's commit hash.
- `commit`: tells the receiving agent to commit.
- `parent`: message from a child agent to its parent agent.
- `child`: message from a parent agent to a child agent.

## Commit Message

A commit message triggers a commit in the receiving agent.

```json
{
  "id": "<message-id>",
  "type": "commit",
  "payload": {
    "reason": "<commit-reason>"
  }
}
```

## Merge Message

A merge message triggers merge-message rebase behavior.

```json
{
  "id": "<message-id>",
  "type": "merge",
  "payload": {
    "commit": "<commit-hash>"
  }
}
```

## Subagent Queues

Git operations that target a subagent do not send instructions directly to that subagent.

Instead, those operations are placed in the same queue as the subagent so they do not execute while the subagent is active.

Administrative messages that are not sent to the agent still must be recorded in the agent's `session.jsonl` file.

Each subagent logically does only one thing at a time.

If a subagent is generating or otherwise running, it does not process its queue concurrently.

