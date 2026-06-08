export interface RestErrorBody
{
  error: {
    code: string;
    message: string;
  };
}

export function FormatRestError(code: string, message: string): RestErrorBody
{
  return {
    error: {
      code,
      message,
    },
  };
}
