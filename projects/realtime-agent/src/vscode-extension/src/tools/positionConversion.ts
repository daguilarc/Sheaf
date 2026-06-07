export function ToVscodePosition0(line1Based: number, character0: number): { line: number; character: number }
{
  return { line: Math.max(0, line1Based - 1), character: Math.max(0, character0) };
}

export function FromVscodePosition0(line0: number, character0: number): { line: number; character: number }
{
  return { line: line0 + 1, character: character0 };
}
