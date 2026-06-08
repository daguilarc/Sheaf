export interface BuildChatWebSocketUrlInput
{
  pile: string;
  sessionId: string;
  clientId?: string;
  after?: number;
}

export function BuildChatWebSocketUrl(input: BuildChatWebSocketUrlInput): string
{
  const params = new URLSearchParams();
  params.set("p", input.pile);
  params.set("session", input.sessionId);

  if (input.clientId !== undefined && input.clientId.length > 0)
  {
    params.set("client", input.clientId);
  }

  if (input.after !== undefined)
  {
    params.set("after", String(input.after));
  }

  return `/ws/chat?${params.toString()}`;
}
