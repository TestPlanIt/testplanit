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

/**
 * The provider terminally rejected a refresh token: it was revoked, rotated
 * away, or expired. Retrying cannot succeed — the owner has to reconnect.
 * Timeouts, network failures and 5xx responses are NOT this error; the token
 * may well still be valid once the provider recovers.
 */
export class RefreshTokenRevokedError extends Error {
  constructor(
    readonly provider: string,
    detail: string,
    options?: { cause?: unknown }
  ) {
    super(`${provider} rejected the refresh token: ${detail}`, options);
    this.name = "RefreshTokenRevokedError";
  }
}

export const isRefreshTokenRevokedError = (
  error: unknown
): error is RefreshTokenRevokedError =>
  error instanceof RefreshTokenRevokedError;

/**
 * Whether an OAuth token endpoint's error response to a refresh grant means
 * the refresh token itself is dead. RFC 6749 says `invalid_grant`; Atlassian
 * also answers `unauthorized_client` / "refresh_token is invalid" for a
 * refresh token it has already rotated. A bare `unauthorized_client` is a
 * misconfigured OAuth app, not a dead token, so it needs the description.
 */
export const isDeadRefreshTokenResponse = (
  status: number,
  body: string
): boolean => {
  if (status >= 500 || status === 429) return false;
  let parsed: { error?: unknown; error_description?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object") return false;
  const code = typeof parsed.error === "string" ? parsed.error : "";
  const description =
    typeof parsed.error_description === "string"
      ? parsed.error_description
      : "";
  if (code === "invalid_grant") return true;
  if (/refresh[_ ]token is invalid/i.test(description)) return true;
  return (
    code === "unauthorized_client" && /refresh[_ ]token/i.test(description)
  );
};

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
    CLICKUP: "ClickUp",
  };
  return known[provider.toUpperCase()] ?? provider;
};

const userMessageForStatus = (provider: string, status: number): string => {
  const label = providerLabel(provider);
  switch (status) {
    case 401:
      return provider.toUpperCase() === "JIRA"
        ? `${label} rejected the credentials. Jira Cloud needs your account email plus an API token — an account password will not work for API access; create a token at ${JIRA_API_TOKEN_URL}. Jira Server and Data Center need a personal access token, or a username and password.`
        : `${label} rejected the credentials. Check the token or password and re-enter it.`;
    case 403:
      return `The credentials are valid, but the account does not have permission to access this project in ${label}. Grant that account access, or use credentials for an account that already has it.`;
    case 404:
      return `${label} returned "not found" for that address. Check the site URL on the integration — it should be the address your instance is served from (including any context path, such as /jira), not a page within it.`;
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

  if (isRefreshTokenRevokedError(error)) {
    const label = providerLabel(provider || error.provider);
    return new IntegrationApiError(
      provider || error.provider,
      401,
      "auth",
      `The stored ${label} authorization is no longer valid. Reconnect your ${label} account.`,
      { cause: error }
    );
  }

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

/**
 * Where a signed-in user starts (re)authorizing an OAuth integration. The
 * kickoff route stores the state the callback verifies, and returns to a page
 * every signed-in user can view.
 */
export const oauthReauthorizeUrl = (
  provider: string,
  integrationId: number | string
): string =>
  `/api/integrations/oauth/${provider.toLowerCase()}/auth?integrationId=${integrationId}&returnUrl=${encodeURIComponent("/integrations/auth-complete")}`;

export interface ReauthorizationBody extends IntegrationErrorBody {
  authUrl: string;
  requiresAuth: true;
}

/**
 * The reconnect prompt for a failure that means the caller's stored OAuth
 * authorization was rejected; null for any other failure. Routes send it with
 * a 401. Pass no `authUrl` for API-key and PAT integrations, whose credentials
 * are fixed by an admin rather than by the user re-authorizing.
 */
export const reauthorizationBody = (
  error: unknown,
  provider: string,
  authUrl: string | undefined
): ReauthorizationBody | null => {
  if (!authUrl) return null;
  const integrationError = toIntegrationError(error, provider);
  if (integrationError.kind !== "auth") return null;
  return {
    ...integrationErrorBody(integrationError),
    authUrl,
    requiresAuth: true,
  };
};

const REFUSAL_MESSAGE_LIMIT = 400;

const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
};

/**
 * The human-readable parts of a tracker's JSON error body. Covers the shapes
 * the supported trackers answer with: a `message`/`error`/`err` string, a list
 * of messages, messages keyed by field, and a list of per-field error objects.
 */
const refusalParts = (body: Record<string, unknown>): string[] => {
  const parts: string[] = [];
  const add = (value: unknown, field?: string) => {
    const text = asText(value);
    if (text) parts.push(field ? `${field}: ${text}` : text);
  };
  const addFieldMap = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [field, messages] of Object.entries(value)) {
      if (Array.isArray(messages))
        add(messages.filter(asText).join(", "), field);
      else add(messages, field);
    }
  };

  // MantisBT's `localized` is its full sentence; `message` is the short form.
  add(body.localized ?? body.message);
  if (typeof body.message === "object") {
    if (Array.isArray(body.message))
      add(body.message.filter(asText).join("; "));
    else addFieldMap(body.message);
  }
  add(body.err);
  if (typeof body.error === "object" && body.error) {
    add((body.error as Record<string, unknown>).message);
  } else {
    add(body.error);
  }
  add(body.error_description);
  add(body.detail);

  if (Array.isArray(body.errorMessages)) {
    for (const message of body.errorMessages) add(message);
  }
  if (Array.isArray(body.errors)) {
    for (const entry of body.errors) {
      if (entry && typeof entry === "object") {
        const { field, message, code } = entry as Record<string, unknown>;
        add(message ?? code, asText(field) ?? undefined);
      } else {
        add(entry);
      }
    }
  } else {
    addFieldMap(body.errors);
  }
  return [...new Set(parts)];
};

/**
 * What a tracker said when it refused a request, without the HTTP status and
 * JSON it arrived in. Falls back to the text as thrown when the reply has no
 * recognisable message.
 */
export const trackerRefusalMessage = (error: unknown): string => {
  const thrown = error instanceof Error ? error.message : String(error);
  const http = thrown.match(/^HTTP (\d{3}):\s*([\s\S]*)$/);
  if (!http) return thrown;

  const [, status, body] = http;
  let message = "";
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      message = refusalParts(parsed as Record<string, unknown>).join("; ");
    } else if (Array.isArray(parsed)) {
      message = parsed.filter(asText).join("; ");
    }
  } catch {
    // An HTML error page says nothing a user can act on.
    message = /^\s*</.test(body) ? "" : body.trim();
  }

  if (!message) return `The tracker answered with HTTP ${status}.`;
  return message.length > REFUSAL_MESSAGE_LIMIT
    ? `${message.slice(0, REFUSAL_MESSAGE_LIMIT)}…`
    : message;
};
