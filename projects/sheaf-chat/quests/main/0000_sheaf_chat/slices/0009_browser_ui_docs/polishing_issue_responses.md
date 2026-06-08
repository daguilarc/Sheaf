# Issue responses

## Response PL-0001 2026-06-08T23:27:02Z

- issue_id: PL-0001
- outcome: Fixed
- explanation: Added projects/sheaf-chat/tests/ui/chatScreen.test.ts with a VM fake-DOM/fake-WebSocket harness that boots sheaf-chat.js through the chat route and uses the real shared agui-chat.js renderer. The tests cover server-broadcast-only rendering with user-message/agui dedupe, disconnected queue/flush state, ack and reconnect after-cursor behavior, model selection frames, lazy history request gating, and touch/desktop Enter behavior. Verified npm run build and node --test dist/tests/ui/router.test.js dist/tests/ui/chatScreen.test.js pass; full make sheaf-chat-test also compiles and runs these tests but the sandbox blocks existing server tests from listening on 127.0.0.1 with EPERM.
