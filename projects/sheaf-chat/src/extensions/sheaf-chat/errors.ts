export const x_rootEscapeDeniedCode = "root_escape_denied";

export class PathEscapeError extends Error
{
  readonly code = x_rootEscapeDeniedCode;

  constructor(
    message: string,
    readonly inputPath: string,
    readonly reason: string,
  )
  {
    super(message);
    this.name = "PathEscapeError";
  }
}
