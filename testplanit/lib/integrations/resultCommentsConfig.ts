import { usesIntegrationCredentials } from "./authTypes";

/**
 * Posting test results as a comment on the tracker issues a completed run
 * covers. A project switches it on in its integration settings
 * (`ProjectIntegration.config.resultComments`). Safe to import from client
 * code: it reads plain values and nothing else.
 */
export interface ResultCommentsConfig {
  enabled: boolean;
}

/** Trackers whose adapter can write a comment and edit it afterwards. */
const RESULT_COMMENT_PROVIDERS: ReadonlySet<string> = new Set(["GITHUB"]);

/**
 * Whether a connection can post result comments. The comment is written
 * when a run completes, with no user present, so the connection must carry
 * its own credentials: a per-user OAuth connection has no account to post
 * as.
 */
export function supportsResultComments(
  integration:
    { provider?: string | null; authType?: string | null } | null | undefined
): boolean {
  return (
    !!integration &&
    RESULT_COMMENT_PROVIDERS.has(integration.provider ?? "") &&
    usesIntegrationCredentials(integration.authType)
  );
}

export function readResultCommentsConfig(
  config: unknown
): ResultCommentsConfig {
  const saved =
    config && typeof config === "object"
      ? (config as Record<string, any>).resultComments
      : undefined;
  return { enabled: saved?.enabled === true };
}
