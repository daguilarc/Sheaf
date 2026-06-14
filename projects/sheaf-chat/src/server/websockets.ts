export interface BuildChatWebSocketUrlInput
{
  repoId: string;
  workspaceId: string;
  chatId: string;
  clientId?: string;
  after?: number;
}

export function BuildChatWebSocketUrl(input: BuildChatWebSocketUrlInput): string
{
  const params = new URLSearchParams();
  params.set("repo", input.repoId);
  params.set("workspace", input.workspaceId);
  params.set("chat", input.chatId);

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
