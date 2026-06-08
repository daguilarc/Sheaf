export {
  CreateChatEnvelope,
  x_chatEnvelopeVersion,
  type ChatEnvelope,
  type CreateChatEnvelopeInput,
} from "../shared/envelope.js";

export const x_serverHelloKind = "server.hello";
export const x_serverCaughtUpKind = "server.caught_up";
export const x_serverErrorKind = "server.error";
export const x_serverPongKind = "server.pong";
export const x_historyPageKind = "history.page";
export const x_aguiEventKind = "agui.event";
export const x_chatUserMessageKind = "chat.user_message";
export const x_sessionUpdatedKind = "session.updated";
export const x_modelChangedKind = "model.changed";
export const x_agentStatusKind = "agent.status";
