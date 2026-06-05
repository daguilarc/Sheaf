# Agent Messages

Agent communication is asynchronous.

Agents communicate through the runtime message queue.

## Assistant Messages

When an agent produces an assistant message, the runtime queues that message to the agent's parent as a `child` message.

The parent receives the message later through its queue.

## Parent Messages

A parent can send a message to a subagent by enqueueing a `parent` message for that subagent.

The message is not processed immediately if the subagent is active.

The subagent receives the message later through its queue.

## Response Flow

When the subagent produces an assistant message in response, the runtime queues that message back to the parent as a `child` message.

The original sender does not block waiting for that response.

