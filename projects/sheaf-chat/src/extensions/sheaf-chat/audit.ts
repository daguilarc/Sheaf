export interface PathEscapeAuditEvent
{
  inputPath: string;
  reason: string;
  tool?: string;
}

export interface AuditLogger
{
  LogEscapeAttempt(event: PathEscapeAuditEvent): void;
}

export interface ScopedActivityEvent
{
  type: "sheaf_chat.path_escape_denied";
  inputPath: string;
  reason: string;
  tool?: string;
}

export interface ScopedToolBindings
{
  audit: AuditLogger;
  emitActivity: (event: ScopedActivityEvent) => void;
}

export function CreateAuditLogger(
  bindings: Pick<ScopedToolBindings, "emitActivity">,
): AuditLogger
{
  const entries: PathEscapeAuditEvent[] = [];

  return {
    LogEscapeAttempt(event: PathEscapeAuditEvent): void
    {
      entries.push({ ...event });
      bindings.emitActivity({
        type: "sheaf_chat.path_escape_denied",
        inputPath: event.inputPath,
        reason: event.reason,
        tool: event.tool,
      });
    },
  };
}

export function CreateNoopBindings(): ScopedToolBindings
{
  return {
    audit: {
      LogEscapeAttempt(): void
      {
      },
    },
    emitActivity(): void
    {
    },
  };
}
