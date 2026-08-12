import { describe, expect, it } from "vitest";
import {
  IntegrationApiError,
  credentialsCorruptError,
  integrationErrorBody,
  integrationErrorFromStatus,
  isIntegrationApiError,
  responseStatusForIntegrationError,
  toIntegrationError,
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
