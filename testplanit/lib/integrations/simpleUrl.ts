export function buildSimpleUrlLink(
  baseUrl: string | null | undefined,
  externalId: string | null | undefined
): string | null {
  if (!baseUrl || !externalId) return null;
  return baseUrl.replace("{issueId}", externalId);
}
