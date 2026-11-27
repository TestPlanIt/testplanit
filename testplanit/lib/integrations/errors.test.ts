import { describe, expect, it } from "vitest";
import {
  IntegrationApiError,
  RefreshTokenRevokedError,
  credentialsCorruptError,
  integrationErrorBody,
  integrationErrorFromStatus,
  isDeadRefreshTokenResponse,
  isIntegrationApiError,
  oauthReauthorizeUrl,
  reauthorizationBody,
  responseStatusForIntegrationError,
  toIntegrationError,
  trackerRefusalMessage,
} from "./errors";

describe("integrationErrorFromStatus", () => {
  it.each([
    [401, "auth"],
    [403, "permission"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "upstream"],
    [418, "upstream"],
  ])("maps upstream %i to kind %s", (status, kind) => {
    expect(integrationErrorFromStatus("JIRA", status).kind).toBe(kind);
  });

  it("names the API token requirement for a rejected Jira credential", () => {
    const error = integrationErrorFromStatus("JIRA", 401);
    expect(error.userMessage).toMatch(/API token/);
    expect(error.userMessage).toContain(
      "id.atlassian.com/manage-profile/security/api-tokens"
    );
  });

  it("does not give Jira-specific advice for other providers", () => {
    const error = integrationErrorFromStatus("GITHUB", 401);
    expect(error.userMessage).toContain("GitHub");
    expect(error.userMessage).not.toMatch(/atlassian/i);
  });

  it("keeps the numeric status and provider on the error", () => {
    const error = integrationErrorFromStatus("GITLAB", 403);
    expect(error.status).toBe(403);
    expect(error.provider).toBe("GITLAB");
    expect(isIntegrationApiError(error)).toBe(true);
  });
});

describe("toIntegrationError", () => {
  it("passes an already-typed error through unchanged", () => {
    const original = integrationErrorFromStatus("JIRA", 401);
    expect(toIntegrationError(original, "JIRA")).toBe(original);
  });

  it("recovers the status from a makeRequest HTTP error", () => {
    const error = toIntegrationError(
      new Error('HTTP 403: {"message":"Forbidden"}'),
      "JIRA"
    );
    expect(error.kind).toBe("permission");
    expect(error.status).toBe(403);
  });

  it("never echoes the upstream response body to the user", () => {
    const error = toIntegrationError(
      new Error('HTTP 401: {"token":"super-secret-value"}'),
      "JIRA"
    );
    expect(error.userMessage).not.toContain("super-secret-value");
  });

  it.each([
    ["fetch failed", "fetch failed"],
    ["timeout", "Request timeout after 30000ms: https://example.com"],
  ])("classifies %s as unreachable", (_label, message) => {
    expect(toIntegrationError(new Error(message), "JIRA").kind).toBe(
      "unreachable"
    );
  });

  it("classifies a DNS failure carried on error.cause as unreachable", () => {
    const error = new Error("fetch failed");
    (error as Error & { cause?: unknown }).cause = Object.assign(
      new Error("getaddrinfo ENOTFOUND bad.example.com"),
      { code: "ENOTFOUND" }
    );
    expect(toIntegrationError(error, "JIRA").kind).toBe("unreachable");
  });

  it("classifies an aborted request as unreachable", () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    expect(toIntegrationError(error, "JIRA").kind).toBe("unreachable");
  });

  it("falls back to a generic upstream error without leaking the message", () => {
    const error = toIntegrationError(
      new Error("Cannot read properties of undefined (reading 'values')"),
      "JIRA"
    );
    expect(error.kind).toBe("upstream");
    expect(error.userMessage).not.toContain("Cannot read properties");
  });

  it("handles a non-Error throw", () => {
    const error = toIntegrationError("something odd", "JIRA");
    expect(error.kind).toBe("upstream");
    expect(error.status).toBe(0);
  });
});

describe("responseStatusForIntegrationError", () => {
  it("never returns 401, which would be read as an expired app session", () => {
    const statuses = ([401, 403, 404, 429, 500] as const).map((upstream) =>
      responseStatusForIntegrationError(
        integrationErrorFromStatus("JIRA", upstream)
      )
    );
    expect(statuses).not.toContain(401);
  });

  it("keeps every integration failure in the 4xx range", () => {
    const statuses = ([401, 403, 404, 429, 500, 502] as const).map((upstream) =>
      responseStatusForIntegrationError(
        integrationErrorFromStatus("JIRA", upstream)
      )
    );
    for (const status of statuses) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    }
  });

  it("preserves permission and rate-limit semantics", () => {
    expect(
      responseStatusForIntegrationError(integrationErrorFromStatus("JIRA", 403))
    ).toBe(403);
    expect(
      responseStatusForIntegrationError(integrationErrorFromStatus("JIRA", 429))
    ).toBe(429);
  });

  it("returns 400 for corrupt stored credentials", () => {
    expect(
      responseStatusForIntegrationError(credentialsCorruptError("JIRA"))
    ).toBe(400);
  });
});

describe("credentialsCorruptError", () => {
  it("tells the admin to re-enter the credentials", () => {
    const error = credentialsCorruptError("JIRA");
    expect(error.kind).toBe("credentials_corrupt");
    expect(error.status).toBe(0);
    expect(error.userMessage).toMatch(/re-enter/i);
  });
});

describe("integrationErrorBody", () => {
  it("exposes the user message and upstream status, not the internal message", () => {
    const error = new IntegrationApiError(
      "JIRA",
      401,
      "auth",
      "Friendly text."
    );
    expect(integrationErrorBody(error)).toEqual({
      error: "Friendly text.",
      kind: "auth",
      provider: "JIRA",
      upstreamStatus: 401,
    });
  });
});

describe("isDeadRefreshTokenResponse", () => {
  it.each([
    [
      403,
      '{"error":"unauthorized_client","error_description":"refresh_token is invalid"}',
    ],
    [400, '{"error":"invalid_grant","error_description":"revoked"}'],
    [403, '{"error":"invalid_grant"}'],
  ])("is true for %i %s", (status, body) => {
    expect(isDeadRefreshTokenResponse(status, body)).toBe(true);
  });

  it.each([
    [503, "upstream connect error or disconnect/reset before headers"],
    [503, '{"error":"invalid_grant"}'],
    [429, '{"error":"invalid_grant"}'],
    [
      401,
      '{"error":"unauthorized_client","error_description":"bad client secret"}',
    ],
    [400, '{"error":"invalid_request"}'],
    [400, "not json"],
  ])("is false for %i %s", (status, body) => {
    expect(isDeadRefreshTokenResponse(status, body)).toBe(false);
  });
});

describe("toIntegrationError with a dead refresh token", () => {
  it("is an auth error that asks the user to reconnect, without the upstream body", () => {
    const error = toIntegrationError(
      new RefreshTokenRevokedError("JIRA", "refresh_token is invalid"),
      "JIRA"
    );
    expect(error.kind).toBe("auth");
    expect(error.userMessage).toMatch(/reconnect your jira account/i);
    expect(error.userMessage).not.toContain("refresh_token");
  });
});

describe("reauthorizationBody", () => {
  const authUrl = oauthReauthorizeUrl("JIRA", 3);

  it("builds the kickoff URL that returns to the auth-complete page", () => {
    expect(authUrl).toBe(
      "/api/integrations/oauth/jira/auth?integrationId=3&returnUrl=%2Fintegrations%2Fauth-complete"
    );
  });

  it.each([
    [
      "a dead refresh token",
      new RefreshTokenRevokedError("JIRA", "refresh_token is invalid"),
    ],
    ["an upstream 401", new Error('HTTP 401: {"message":"Unauthorized"}')],
    ["a typed 401", integrationErrorFromStatus("JIRA", 401)],
  ])("is the reconnect prompt for %s", (_name, error) => {
    expect(reauthorizationBody(error, "JIRA", authUrl)).toMatchObject({
      kind: "auth",
      provider: "JIRA",
      authUrl,
      requiresAuth: true,
    });
  });

  it.each([
    ["a permission failure", new Error("HTTP 403: Forbidden")],
    ["a failing tracker", new Error("HTTP 503: upstream connect error")],
    ["a timeout", new Error("Request timeout after 30000ms: https://x")],
    ["an unrecognised failure", new Error("boom")],
  ])("is null for %s", (_name, error) => {
    expect(reauthorizationBody(error, "JIRA", authUrl)).toBeNull();
  });

  it("is null without an authUrl, as for API-key and PAT integrations", () => {
    expect(
      reauthorizationBody(
        new Error('HTTP 401: {"message":"Unauthorized"}'),
        "JIRA",
        undefined
      )
    ).toBeNull();
  });
});

describe("trackerRefusalMessage", () => {
  const refusal = (status: number, body: unknown) =>
    new Error(
      `HTTP ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`
    );

  it.each([
    [
      "MantisBT",
      refusal(400, {
        message: "Description not specified",
        code: 11,
        localized:
          'A necessary field "description" was empty. Please recheck your inputs.',
      }),
      'A necessary field "description" was empty. Please recheck your inputs.',
    ],
    [
      "Redmine",
      refusal(422, {
        errors: ["Subject cannot be blank", "Tracker cannot be blank"],
      }),
      "Subject cannot be blank; Tracker cannot be blank",
    ],
    [
      "Jira",
      refusal(400, {
        errorMessages: ["The issue type selected is invalid."],
        errors: { customfield_10020: "Sprint is required." },
      }),
      "The issue type selected is invalid.; customfield_10020: Sprint is required.",
    ],
    [
      "GitHub",
      refusal(422, {
        message: "Validation Failed",
        errors: [{ resource: "Issue", field: "title", code: "missing_field" }],
      }),
      "Validation Failed; title: missing_field",
    ],
    [
      "GitLab field messages",
      refusal(400, { message: { title: ["can't be blank", "is too long"] } }),
      "title: can't be blank, is too long",
    ],
    [
      "GitLab error string",
      refusal(400, { error: "title is missing" }),
      "title is missing",
    ],
    [
      "Gitea",
      refusal(422, { message: "[Title]: Required", url: "x" }),
      "[Title]: Required",
    ],
    [
      "Azure DevOps",
      refusal(400, {
        message: "TF401320: Rule Error for field Title.",
        typeKey: "RuleValidationException",
      }),
      "TF401320: Rule Error for field Title.",
    ],
    [
      "ClickUp",
      refusal(400, { err: "Task name invalid", ECODE: "INPUT_005" }),
      "Task name invalid",
    ],
    [
      "a nested error object",
      refusal(400, { error: { message: "Bad field" } }),
      "Bad field",
    ],
    ["plain text", refusal(400, "Project is archived"), "Project is archived"],
  ])("reads what %s said", (_tracker, error, expected) => {
    expect(trackerRefusalMessage(error)).toBe(expected);
  });

  it("says only the status when the reply carries no message", () => {
    expect(trackerRefusalMessage(refusal(400, { code: 11 }))).toBe(
      "The tracker answered with HTTP 400."
    );
    expect(
      trackerRefusalMessage(refusal(404, "<html><body>Not Found</body></html>"))
    ).toBe("The tracker answered with HTTP 404.");
  });

  it("keeps an error that is not an HTTP reply as it is", () => {
    expect(trackerRefusalMessage(new Error("No transition available"))).toBe(
      "No transition available"
    );
    expect(trackerRefusalMessage("boom")).toBe("boom");
  });

  it("cuts a very long reply short", () => {
    const message = trackerRefusalMessage(
      refusal(400, { message: "x".repeat(900) })
    );
    expect(message.length).toBe(401);
    expect(message.endsWith("…")).toBe(true);
  });
});
