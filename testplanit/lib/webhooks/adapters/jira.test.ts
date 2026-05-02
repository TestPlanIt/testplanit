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
    expect(result).toMatchObject({
      valid: true,
      payload: {
        eventType: "jira:issue_updated",
        issueKey: "DEMO-1",
        externalStatus: "Done",
        synthetic: false,
      },
    });
  });

  it("Test 7a (HI-02): synthetic flag is bound to issue.key === '__synthetic__', NOT to wire metadata", () => {
    // The self-loop server action sends issue.key='__synthetic__'; the adapter
    // detects that exact key and sets payload.synthetic=true. A real Jira can't
    // legitimately produce this key, so external callers cannot forge synthetic.
    const syntheticPayload = {
      webhookEvent: "jira:issue_updated",
      issue: {
        key: "__synthetic__",
        fields: { status: { name: "Synthetic Test" } },
      },
    };
    const body = bodyOf(syntheticPayload);
    const sig = signBody(body, SECRET);
    const headers = new Headers({ "x-hub-signature-256": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.synthetic).toBe(true);
      expect(result.payload.issueKey).toBe("__synthetic__");
    }
  });

  it("Test 7b (HI-02): wire-supplied metadata.synthetic=true is IGNORED for non-sentinel issue keys", () => {
    // A real Jira instance (or anyone with the secret) attempting to forge
    // synthetic via the metadata field MUST NOT succeed. The adapter binds
    // synthetic to the issue.key sentinel, never to wire-supplied metadata.
    const forgedPayload = {
      ...validJiraPayload,
      metadata: { synthetic: true }, // ← attacker-supplied, must be ignored
    };
    const body = bodyOf(forgedPayload);
    const sig = signBody(body, SECRET);
    const headers = new Headers({ "x-hub-signature-256": sig });
    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.synthetic).toBe(false);
      expect(result.payload.issueKey).toBe("DEMO-1");
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

describe("jiraAdapter — Phase 3 widened interface", () => {
  it("extractLinkedIssueRef: returns { externalKey, externalSystem: 'JIRA' } for canonical payload", () => {
    const payload = { issue: { key: "DEMO-42" } };
    expect(jiraAdapter.extractLinkedIssueRef(payload)).toEqual({
      externalKey: "DEMO-42",
      externalSystem: "JIRA",
    });
  });

  it("extractLinkedIssueRef: returns null when payload.issue is missing", () => {
    const payload = { webhookEvent: "jira:issue_updated" };
    expect(jiraAdapter.extractLinkedIssueRef(payload)).toBeNull();
  });

  it("extractLinkedIssueRef: returns null when payload.issue.key is not a string", () => {
    const payload = { issue: { key: 12345 } };
    expect(jiraAdapter.extractLinkedIssueRef(payload)).toBeNull();
  });

  it("extractExternalStatus: returns the status name for a jira:issue_updated event", () => {
    const payload = {
      issue: { fields: { status: { name: "In Progress" } } },
    };
    expect(
      jiraAdapter.extractExternalStatus(payload, "jira:issue_updated")
    ).toBe("In Progress");
  });

  it("extractExternalStatus: returns the status name for a jira:issue_created event (enables auto-create)", () => {
    // Auto-create relies on extractExternalStatus returning non-null for
    // creation events so the inbound apply path doesn't short-circuit
    // as `no_handler` and the post-commit system sync fires with
    // `createIfMissing: { projectId }`.
    const payload = {
      issue: { fields: { status: { name: "To Do" } } },
    };
    expect(
      jiraAdapter.extractExternalStatus(payload, "jira:issue_created")
    ).toBe("To Do");
  });

  it("extractExternalStatus: returns null for jira:issue_deleted (deletion events do NOT trigger auto-create)", () => {
    // Even though Jira's deletion payload still carries a status, we
    // shouldn't try to auto-create or system-sync an issue the upstream
    // just removed (sync would 404). Excluded from the eventType filter.
    const payload = {
      issue: { fields: { status: { name: "Done" } } },
    };
    expect(
      jiraAdapter.extractExternalStatus(payload, "jira:issue_deleted")
    ).toBeNull();
  });

  it("extractExternalStatus: returns null for unrelated events (e.g. comment/worklog/attachment)", () => {
    const payload = {
      issue: { fields: { status: { name: "In Progress" } } },
    };
    expect(jiraAdapter.extractExternalStatus(payload, "jira:other")).toBeNull();
    expect(
      jiraAdapter.extractExternalStatus(
        payload,
        "comment_created" as Parameters<
          typeof jiraAdapter.extractExternalStatus
        >[1]
      )
    ).toBeNull();
  });

  it("extractExternalStatus: returns null when payload.issue.fields.status.name is missing", () => {
    const payload = { issue: { fields: {} } };
    expect(
      jiraAdapter.extractExternalStatus(payload, "jira:issue_updated")
    ).toBeNull();
  });

  // Regression: verify() returns a denormalized ParsedWebhookPayload, but
  // extractors must read from the raw payload via `payload.data`. This test
  // exercises the production seam end-to-end (no mocks) so a future change
  // that drops `data` from verify() output fails fast.
  it("INTEGRATION: real verify() output flows through real extractors with non-null linkedRef + externalStatus", () => {
    const SECRET = "integration-secret";
    const rawPayload = {
      webhookEvent: "jira:issue_updated",
      issue: {
        key: "DEMO-7",
        fields: { status: { name: "In Review" } },
      },
    };
    const body = bodyOf(rawPayload);
    const sig = signBody(body, SECRET);
    const headers = new Headers({ "x-hub-signature-256": sig });

    const result = jiraAdapter.verify(body, headers, SECRET);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const linkedRef = jiraAdapter.extractLinkedIssueRef(result.payload);
    expect(linkedRef).toEqual({
      externalKey: "DEMO-7",
      externalSystem: "JIRA",
    });

    const status = jiraAdapter.extractExternalStatus(
      result.payload,
      result.payload.eventType
    );
    expect(status).toBe("In Review");
  });
});
