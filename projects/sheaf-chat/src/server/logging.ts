type LogScalar = string | number | boolean | null;

export interface HandledServerErrorLogFields
{
  feature: string;
  message: string;
  level?: "warn" | "error";
  code?: string;
  statusCode?: number;
  requestId?: string;
  commandId?: string;
  action?: string;
  repoId?: string;
  workspaceId?: string;
  chatId?: string;
  clientId?: string;
  stale?: boolean;
}

const x_allowedFields = [
  "service",
  "level",
  "event",
  "feature",
  "statusCode",
  "code",
  "message",
  "requestId",
  "commandId",
  "action",
  "repoId",
  "workspaceId",
  "chatId",
  "clientId",
  "stale",
] as const;

function IsLogScalar(value: unknown): value is LogScalar
{
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function LogHandledServerError(fields: HandledServerErrorLogFields): void
{
  const raw: Record<(typeof x_allowedFields)[number], LogScalar | undefined> = {
    service: "sheaf-chat",
    level: fields.level ?? "error",
    event: "sheaf_chat.handled_error",
    feature: fields.feature,
    statusCode: fields.statusCode,
    code: fields.code,
    message: fields.message,
    requestId: fields.requestId,
    commandId: fields.commandId,
    action: fields.action,
    repoId: fields.repoId,
    workspaceId: fields.workspaceId,
    chatId: fields.chatId,
    clientId: fields.clientId,
    stale: fields.stale,
  };
  const entry: Record<string, LogScalar> = {};

  for (const key of x_allowedFields)
  {
    const value = raw[key];
    if (value !== undefined && IsLogScalar(value))
    {
      entry[key] = value;
    }
  }

  console.error(JSON.stringify(entry));
}
