import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { jiraAdapter } from "./jira";

const SECRET = "test-secret-do-not-use-in-prod";

/** Helper: produce the `sha256=<hex>` header value for a body+secret pair. */
function signBody(body: Buffer | string, secret: string): string {
  const buf = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const hex = createHmac("sha256", secret).update(buf).digest("hex");
  return `sha256=${hex}`;
}

/** Build a buffer from a JSON-serializable object. */
function bodyOf(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), "utf8");
}

const validJiraPayload = {
  webhookEvent: "jira:issue_updated",
  issue: {
    id: "10001",
    key: "DEMO-1",
    fields: {
      status: { name: "Done" },
      summary: "Implement webhook receiver",
    },
  },
  user: { accountId: "5b10a..." },
  timestamp: 1714000000000,
};

describe("jiraAdapter", () => {
  it("Test 10 (adapterType): exposes adapterType === 'JIRA'", () => {
    expect(jiraAdapter.adapterType).toBe("JIRA");
  });

  it("Test 1 (missing-signature): no signature header → { valid: false, reason: 'missing-signature' }", () => {
    const body = bodyOf(validJiraPayload);
    const headers = new Headers();
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result).toEqual({ valid: false, reason: "missing-signature" });
  });

  it("Test 2 (malformed-signature): header doesn't match shape → { valid: false, reason: 'malformed-signature' }", () => {
    const body = bodyOf(validJiraPayload);
    const headers = new Headers({ "x-hub-signature-256": "sha256=not-hex-zz" });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result).toEqual({ valid: false, reason: "malformed-signature" });
  });

  it("Test 2b (malformed-signature): missing 'sha256=' prefix → { valid: false, reason: 'malformed-signature' }", () => {
    const body = bodyOf(validJiraPayload);
    const sig = signBody(body, SECRET).slice("sha256=".length); // strip prefix
    const headers = new Headers({ "x-hub-signature-256": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result).toEqual({ valid: false, reason: "malformed-signature" });
  });

  it("Test 3 (signature-mismatch): correct shape but wrong digest → { valid: false, reason: 'signature-mismatch' }", () => {
    const body = bodyOf(validJiraPayload);
    // Sign with a DIFFERENT secret to produce a same-shape but wrong digest.
    const wrongSig = signBody(body, "different-secret");
    const headers = new Headers({ "x-hub-signature-256": wrongSig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result).toEqual({ valid: false, reason: "signature-mismatch" });
  });

  it("Test 4 (unparseable-body): valid HMAC but body is not JSON → { valid: false, reason: 'unparseable-body' }", () => {
    const body = Buffer.from("not-json{[", "utf8");
    const sig = signBody(body, SECRET);
    const headers = new Headers({ "x-hub-signature-256": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result).toEqual({ valid: false, reason: "unparseable-body" });
  });

  it("Test 5 (missing-required-field): valid HMAC + JSON but no issue.key → { valid: false, reason: 'missing-required-field' }", () => {
    const partial = {
      webhookEvent: "jira:issue_updated",
      issue: { fields: { status: { name: "Done" } } },
    };
    const body = bodyOf(partial);
    const sig = signBody(body, SECRET);
    const headers = new Headers({ "x-hub-signature-256": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result).toEqual({
      valid: false,
      reason: "missing-required-field",
    });
  });

  it("Test 5b (missing-required-field): valid HMAC + JSON + key but no status name", () => {
    const partial = {
      webhookEvent: "jira:issue_updated",
      issue: { key: "DEMO-99", fields: {} },
    };
    const body = bodyOf(partial);
    const sig = signBody(body, SECRET);
    const headers = new Headers({ "x-hub-signature-256": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result).toEqual({
      valid: false,
      reason: "missing-required-field",
    });
  });

  it("Test 6 (happy path — issue updated): valid signed jira:issue_updated payload returns parsed data", () => {
    const body = bodyOf(validJiraPayload);
    const sig = signBody(body, SECRET);
    const headers = new Headers({ "x-hub-signature-256": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result).toEqual({
      valid: true,
      payload: {
        eventType: "jira:issue_updated",
        issueKey: "DEMO-1",
        externalStatus: "Done",
        synthetic: false,
      },
    });
  });

  it("Test 7 (synthetic ping per D-20): metadata.synthetic === true is propagated to payload.synthetic", () => {
    const syntheticPayload = {
      ...validJiraPayload,
      metadata: { synthetic: true },
    };
    const body = bodyOf(syntheticPayload);
    const sig = signBody(body, SECRET);
    const headers = new Headers({ "x-hub-signature-256": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.synthetic).toBe(true);
      expect(result.payload.issueKey).toBe("DEMO-1");
      expect(result.payload.externalStatus).toBe("Done");
    }
  });

  it("Test 8a (legacy header): x-hub-signature is accepted", () => {
    const body = bodyOf(validJiraPayload);
    const sig = signBody(body, SECRET);
    const headers = new Headers({ "x-hub-signature": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result.valid).toBe(true);
  });

  it("Test 8b (case-insensitive header match): X-Hub-Signature-256 (mixed case) is accepted", () => {
    const body = bodyOf(validJiraPayload);
    const sig = signBody(body, SECRET);
    // Headers API normalizes case on construction.
    const headers = new Headers({ "X-Hub-Signature-256": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result.valid).toBe(true);
  });

  it("Test 9 (timing-safe equality): the source uses crypto.timingSafeEqual — verified by static analysis", async () => {
    // Runtime timing assertions are flaky; the acceptance grep below
    // (`grep -q 'timingSafeEqual' testplanit/lib/webhooks/adapters/jira.ts`)
    // is the authoritative check. This test pins a runtime smoke: equal
    // signatures still verify (not short-circuited by length-mismatch).
    const body = bodyOf(validJiraPayload);
    const sig = signBody(body, SECRET);
    const headers = new Headers({ "x-hub-signature-256": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result.valid).toBe(true);
  });
});
