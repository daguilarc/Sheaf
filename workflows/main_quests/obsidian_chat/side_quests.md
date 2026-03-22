# Side Quests

- `chat_patch_tool_contract`
  Path: `../../side_quests/chat_patch_tool_contract/`
  Summary: Clarify the mismatch between OpenAI-style patch payloads and the server's current unified-diff-only patch tool, then choose whether to adopt an OpenAI-native patch contract, rename the tool for clarity, or add a compatibility adapter.
- `legacy_chat_rest_contract`
  Path: `../../side_quests/legacy_chat_rest_contract/`
  Summary: Retire legacy chat-first REST compatibility, remove stale iOS helpers and Chainlit references, keep the thread-first websocket-replay contract, and expose vault repair only as `POST /vaults/repair`.
- `thread_management`
  Path: `../../side_quests/thread_management/`
  Summary: Plan future rename and delete actions for chat threads from the thread list once the server contract and UI affordances are ready.
- `tool_call_summary_contract`
  Path: `../../side_quests/tool_call_summary_contract/`
  Summary: Define stable, privacy-safe summary rules for file-oriented tool calls so chat transcripts can show useful labels without leaking full paths or file contents.
