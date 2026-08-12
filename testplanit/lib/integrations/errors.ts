/**
 * Typed errors for external issue-tracker integrations.
 *
 * Adapters throw `IntegrationApiError` so consumers can branch on
 * `kind`/`status` rather than substring-matching `error.message`. Message
 * matching was the previous approach and is unreliable: it couples every
 * caller to the exact wording of a string built for humans, and it silently
 * stops working when an upstream omits the HTTP reason phrase.
 */

export type IntegrationErrorKind =
  /** Upstream rejected the credentials (401). */
  | "auth"
  /** Credentials are valid but lack permission on the target (403). */
  | "permission"
  /** Site/base URL or resource does not exist (404). */
  | "not_found"
  /** Upstream is throttling us (429). */
  | "rate_limited"
  /** DNS/TCP/TLS failure or timeout — nothing answered. */
  | "unreachable"
  /** Stored credentials could not be decrypted, or are not encrypted at all. */
  | "credentials_corrupt"
  /** Anything else, including upstream 5xx. */
  | "upstream";

export class IntegrationApiError extends Error {
  constructor(
    readonly provider: string,
    /** Upstream HTTP status, or 0 when no response was received. */
    readonly status: number,
    readonly kind: IntegrationErrorKind,
    /** Safe to render to an end user — carries no internals. */
    readonly userMessage: string,
    options?: { cause?: unknown }
  ) {
    super(`${provider} API error ${status} (${kind})`, options);
    this.name = "IntegrationApiError";
  }
}

export const isIntegrationApiError = (
  error: unknown
): error is IntegrationApiError => error instanceof IntegrationApiError;

const JIRA_API_TOKEN_URL =
  "https://id.atlassian.com/manage-profile/security/api-tokens";

const providerLabel = (provider: string): string => {
  const known: Record<string, string> = {
    JIRA: "Jira",
    GITHUB: "GitHub",
    GITLAB: "GitLab",
    GITEA: "Gitea",
    AZURE_DEVOPS: "Azure DevOps",
    REDMINE: "Redmine",
    MANTISBT: "MantisBT",
    BITBUCKET: "Bitbucket",
  };
  return known[provider.toUpperCase()] ?? provider;
};

const userMessageForStatus = (provider: string, status: number): string => {
  const label = providerLabel(provider);
  switch (status) {
    case 401:
      return provider.toUpperCase() === "JIRA"
        ? `${label} rejected the credentials. Jira Cloud requires your account email plus an API token — an account password will not work for API access. Create a token at ${JIRA_API_TOKEN_URL} and re-enter it.`
        : `${label} rejected the credentials. Check the token or password and re-enter it.`;
    case 403:
      return `The credentials are valid, but the account does not have permission to access this project in ${label}. Grant that account access, or use credentials for an account that already has it.`;
    case 404:
      return `${label} returned "not found" for that address. Check the site URL on the integration — it should be the base address of your instance, with no path.`;
    case 429:
      return `${label} is rate limiting requests. Wait a moment and try again.`;
    default:
      return status >= 500
        ? `${label} returned a server error (${status}). This is a problem on their side — try again shortly.`
        : `${label} rejected the request (HTTP ${status}).`;
  }
};

const kindForStatus = (status: number): IntegrationErrorKind => {
  switch (status) {
    case 401:
      return "auth";
    case 403:
      return "permission";
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    default:
      return "upstream";
  }
};

/**
 * Build a typed error from an upstream HTTP status.
 *
 * Always pass `response.status`. Classification must not depend on
 * `response.statusText`: the reason phrase is optional, servers may send it
 * empty, and a message assembled from it then loses the only signal a
 * consumer had.
 */
export const integrationErrorFromStatus = (
  provider: string,
  status: number,
  options?: { userMessage?: string; cause?: unknown }
): IntegrationApiError =>
  new IntegrationApiError(
    provider,
    status,
    kindForStatus(status),
    options?.userMessage ?? userMessageForStatus(provider, status),
    { cause: options?.cause }
  );

export const credentialsCorruptError = (
  provider: string,
  options?: { cause?: unknown }
): IntegrationApiError =>
  new IntegrationApiError(
    provider,
    0,
    "credentials_corrupt",
    `The stored credentials for this ${providerLabel(provider)} integration could not be read. Re-enter them on the integration and save again.`,
    { cause: options?.cause }
  );

const NETWORK_ERROR_CODES = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
];

const isNetworkError = (error: Error): boolean => {
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && NETWORK_ERROR_CODES.includes(code)) return true;
  const causeCode = (error.cause as NodeJS.ErrnoException | undefined)?.code;
  if (causeCode && NETWORK_ERROR_CODES.includes(causeCode)) return true;
  return (
    error.message === "fetch failed" ||
    /^Request timeout after \d+ms/.test(error.message)
  );
};

/**
 * Normalize any thrown value into an `IntegrationApiError`.
 *
 * Recognizes, in order: an already-typed error; `BaseAdapter.makeRequest`'s
 * `HTTP <status>: <body>` message, matched on the numeric status; and
 * network/timeout failures. Anything else becomes a generic `upstream` error
 * whose `userMessage` omits the original text, so adapter internals and
 * upstream response bodies are never echoed back to the client.
 */
export const toIntegrationError = (
  error: unknown,
  provider: string
): IntegrationApiError => {
  if (isIntegrationApiError(error)) return error;

  if (error instanceof Error) {
    const httpMatch = error.message.match(/^HTTP (\d{3}):/);
    if (httpMatch) {
      return integrationErrorFromStatus(provider, parseInt(httpMatch[1], 10), {
        cause: error,
      });
    }

    // Provider SDKs (octokit and friends) attach the status to the error
    // object. Reading the property is exact, unlike matching the message.
    const carried = error as { status?: unknown; statusCode?: unknown };
    const carriedStatus =
      typeof carried.status === "number"
        ? carried.status
        : typeof carried.statusCode === "number"
          ? carried.statusCode
          : undefined;
    if (carriedStatus && carriedStatus >= 400 && carriedStatus <= 599) {
      return integrationErrorFromStatus(provider, carriedStatus, {
        cause: error,
      });
    }

    if (isNetworkError(error)) {
      return new IntegrationApiError(
        provider,
        0,
        "unreachable",
        `Could not reach ${providerLabel(provider)}. Check the site URL on the integration, and that the instance is reachable from this server.`,
        { cause: error }
      );
    }
  }

  return new IntegrationApiError(
    provider,
    0,
    "upstream",
    `The request to ${providerLabel(provider)} could not be completed. Check the integration settings and try again.`,
    { cause: error }
  );
};

/**
 * HTTP status this API returns for a given upstream failure.
 *
 * Never 401: a 401 from our own origin trips client-side NextAuth session
 * handling and bounces the user to the sign-in screen, when it is the
 * *upstream* credentials that were rejected, not the user's session.
 *
 * Never 5xx either. Every one of these is a configuration problem the admin
 * can act on, and keeping them in the 4xx range means the JSON body survives
 * to the client and alerting is not paged for customer misconfiguration.
 */
export const responseStatusForIntegrationError = (
  error: IntegrationApiError
): number => {
  switch (error.kind) {
    case "permission":
      return 403;
    case "rate_limited":
      return 429;
    default:
      return 400;
  }
};

export interface IntegrationErrorBody {
  error: string;
  kind: IntegrationErrorKind;
  provider: string;
  /** Upstream status, 0 when no response was received. */
  upstreamStatus: number;
}

export const integrationErrorBody = (
  error: IntegrationApiError
): IntegrationErrorBody => ({
  error: error.userMessage,
  kind: error.kind,
  provider: error.provider,
  upstreamStatus: error.status,
});
