export const x_identityIdPattern = /^[A-Za-z0-9_-]{16,128}$/;

const x_reservedNames = new Set([".", ".."]);

export function IsValidIdentityId(id: string): boolean
{
  if (id.length === 0 || x_reservedNames.has(id))
  {
    return false;
  }

  if (id.includes("/") || id.includes("\\"))
  {
    return false;
  }

  return x_identityIdPattern.test(id);
}
