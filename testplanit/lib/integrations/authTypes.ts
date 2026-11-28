/**
 * Authentication types whose credentials belong to the integration itself.
 * Every request runs on them; no user authorizes individually, and there is
 * nothing a user can re-authorize when they stop working.
 */
const INTEGRATION_LEVEL_AUTH_TYPES: ReadonlySet<string> = new Set([
  "API_KEY",
  "PERSONAL_ACCESS_TOKEN",
  "GITHUB_APP",
]);

export function usesIntegrationCredentials(
  authType: string | null | undefined
): boolean {
  return !!authType && INTEGRATION_LEVEL_AUTH_TYPES.has(authType);
}
