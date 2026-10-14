import { resolveStoredCredentials } from "~/lib/integrations/credentials";

/** An AI model integration's credentials, decrypted. */
export interface LlmCredentials {
  apiKey?: string;
  endpoint?: string;
  baseUrl?: string;
  /** Extra request headers for a custom endpoint; may carry auth. */
  headers?: Record<string, string>;
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => typeof v === "string");

/**
 * Decrypt an LlmIntegration's stored credentials. Rows written before the
 * key was encrypted at rest still read, as plain values, until the startup
 * pass or a re-save seals them.
 */
export async function resolveLlmCredentials(
  raw: unknown,
  provider: string
): Promise<LlmCredentials> {
  const stored: Record<string, unknown> = await resolveStoredCredentials(
    raw,
    provider
  );
  return {
    ...(typeof stored.apiKey === "string" && stored.apiKey
      ? { apiKey: stored.apiKey }
      : {}),
    ...(typeof stored.endpoint === "string" && stored.endpoint
      ? { endpoint: stored.endpoint }
      : {}),
    ...(typeof stored.baseUrl === "string" && stored.baseUrl
      ? { baseUrl: stored.baseUrl }
      : {}),
    ...(isStringRecord(stored.headers) && Object.keys(stored.headers).length
      ? { headers: stored.headers }
      : {}),
  };
}

/** The stored credentials of an integration by id, decrypted. */
export async function loadLlmCredentials(
  db: {
    llmIntegration: {
      findUnique(args: {
        where: { id: number };
        select: { credentials: true; provider: true };
      }): Promise<{ credentials: unknown; provider: string } | null>;
    };
  },
  llmIntegrationId: number
): Promise<LlmCredentials | null> {
  const row = await db.llmIntegration.findUnique({
    where: { id: llmIntegrationId },
    select: { credentials: true, provider: true },
  });
  if (!row) return null;
  return resolveLlmCredentials(row.credentials, row.provider);
}
