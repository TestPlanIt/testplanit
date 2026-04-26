import { describe, expect, it } from "vitest";

import { redactToken, redactWebhookUrl } from "./redaction";

/**
 * Behaviour suite for D-08 token redaction. These helpers exist solely so token
 * values never appear cleartext in server logs (see plan 01-04, WARNING #12 on
 * the absence of a structured logger). Redacted form keeps the prefix +
 * first 8 hex chars so operators can correlate log lines without seeing the
 * full secret.
 */
describe("redactToken", () => {
  it("retains prefix + first 8 hex chars and replaces the rest with the redacted marker", () => {
    const fullToken =
      "whk_a8d3f1b2c4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
    expect(redactToken(fullToken)).toBe("whk_a8d3f1b2…[redacted]");
  });

  it("masks the entire tail when fewer than 8 hex chars follow the prefix", () => {
    expect(redactToken("whk_short")).toBe("whk_…[redacted]");
  });

  it("returns the input unchanged when it is not a whk_ token", () => {
    expect(redactToken("not-a-webhook-token")).toBe("not-a-webhook-token");
  });

  it("returns empty string for nullish input", () => {
    expect(redactToken(null)).toBe("");
    expect(redactToken(undefined)).toBe("");
    expect(redactToken("")).toBe("");
  });
});

describe("redactWebhookUrl", () => {
  it("masks the whk_ token segment inside a URL but preserves the rest", () => {
    const url =
      "https://app.example/api/webhooks/whk_a8d3f1b2c4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2";
    expect(redactWebhookUrl(url)).toBe(
      "https://app.example/api/webhooks/whk_a8d3f1b2…[redacted]"
    );
  });

  it("returns the URL unchanged when it has no whk_ token segment", () => {
    expect(redactWebhookUrl("https://app/health")).toBe("https://app/health");
  });

  it("returns empty string for nullish input", () => {
    expect(redactWebhookUrl(null)).toBe("");
    expect(redactWebhookUrl(undefined)).toBe("");
    expect(redactWebhookUrl("")).toBe("");
  });
});
