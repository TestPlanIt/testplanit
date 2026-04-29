import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { githubAdapter } from "./github";

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

function headersOf(init: Record<string, string>): Headers {
  return new Headers(init);
}

const CANONICAL_PAYLOAD = {
  action: "closed",
  issue: {
    number: 42,
    state: "closed",
    state_reason: "completed",
    title: "Fix bug",
  },
  repository: { full_name: "octocat/Hello-World" },
};

describe("githubAdapter", () => {
  it("Test 10 (adapterType): exposes adapterType === 'GITHUB'", () => {
    expect(githubAdapter.adapterType).toBe("GITHUB");
  });

  it("Test 1 (missing-signature): no x-hub-signature-256 header → { valid: false, reason: 'missing-signature' }", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const result = githubAdapter.verify(
      body,
      headersOf({ "x-github-event": "issues" }),
      SECRET,
    );
    expect(result).toEqual({ valid: false, reason: "missing-signature" });
  });

  it("Test 2 (malformed-signature): missing 'sha256=' prefix → { valid: false, reason: 'malformed-signature' }", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const result = githubAdapter.verify(
      body,
      headersOf({
        "x-hub-signature-256": "deadbeef".padEnd(64, "0"),
        "x-github-event": "issues",
      }),
      SECRET,
    );
    expect(result).toEqual({ valid: false, reason: "malformed-signature" });
  });

  it("Test 2b (malformed-signature): sha256= followed by non-hex → { valid: false, reason: 'malformed-signature' }", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const result = githubAdapter.verify(
      body,
      headersOf({
        "x-hub-signature-256": "sha256=zzzzzzzz",
        "x-github-event": "issues",
      }),
      SECRET,
    );
    expect(result).toEqual({ valid: false, reason: "malformed-signature" });
  });

  it("Test 3 (signature-mismatch): correct shape but wrong digest → { valid: false, reason: 'signature-mismatch' }", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const wrongSig = signBody(body, "different-secret");
    const result = githubAdapter.verify(
      body,
      headersOf({
        "x-hub-signature-256": wrongSig,
        "x-github-event": "issues",
      }),
      SECRET,
    );
    expect(result).toEqual({ valid: false, reason: "signature-mismatch" });
  });

  it("Test 4 (unparseable-body): valid HMAC but body is not JSON → { valid: false, reason: 'unparseable-body' }", () => {
    const body = Buffer.from("not-json{[", "utf8");
    const sig = signBody(body, SECRET);
    const result = githubAdapter.verify(
      body,
      headersOf({
        "x-hub-signature-256": sig,
        "x-github-event": "issues",
      }),
      SECRET,
    );
    expect(result).toEqual({ valid: false, reason: "unparseable-body" });
  });

  it("Test 5 (missing-required-field): missing X-GitHub-Event header → { valid: false, reason: 'missing-required-field' }", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const sig = signBody(body, SECRET);
    const result = githubAdapter.verify(
      body,
      headersOf({ "x-hub-signature-256": sig }),
      SECRET,
    );
    expect(result).toEqual({
      valid: false,
      reason: "missing-required-field",
    });
  });

  it("Test 6 (happy path — issues event): valid signed canonical payload returns ParsedWebhookPayload", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const sig = signBody(body, SECRET);
    const result = githubAdapter.verify(
      body,
      headersOf({
        "x-hub-signature-256": sig,
        "x-github-event": "issues",
      }),
      SECRET,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.eventType).toBe("issues");
      expect(result.payload.issueKey).toBe("octocat/Hello-World#42");
      expect(result.payload.externalStatus).toBe("closed");
      expect(result.payload.synthetic).toBe(false);
    }
  });

  it("Test 7a (HI-02 sentinel): synthetic flag bound to '__synthetic__/__synthetic__' AND issue.number === 0 → synthetic=true", () => {
    const synth = {
      action: "opened",
      issue: { number: 0, state: "open", title: "Synthetic test" },
      repository: { full_name: "__synthetic__/__synthetic__" },
    };
    const body = bodyOf(synth);
    const sig = signBody(body, SECRET);
    const result = githubAdapter.verify(
      body,
      headersOf({
        "x-hub-signature-256": sig,
        "x-github-event": "issues",
      }),
      SECRET,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.synthetic).toBe(true);
      expect(result.payload.issueKey).toBe("__synthetic__/__synthetic__#0");
    }
  });

  it("Test 7b (HI-02 sentinel): real repo + issue.number=0 → synthetic=false (sentinel requires BOTH)", () => {
    const notQuiteSynth = {
      action: "opened",
      issue: { number: 0, state: "open" },
      repository: { full_name: "octocat/Hello-World" },
    };
    const body = bodyOf(notQuiteSynth);
    const sig = signBody(body, SECRET);
    const result = githubAdapter.verify(
      body,
      headersOf({
        "x-hub-signature-256": sig,
        "x-github-event": "issues",
      }),
      SECRET,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.synthetic).toBe(false);
    }
  });

  it("Test 7c (HI-02 sentinel): synthetic-named repo + non-zero issue.number → synthetic=false (sentinel requires BOTH)", () => {
    const notQuiteSynth = {
      action: "opened",
      issue: { number: 5, state: "open" },
      repository: { full_name: "__synthetic__/__synthetic__" },
    };
    const body = bodyOf(notQuiteSynth);
    const sig = signBody(body, SECRET);
    const result = githubAdapter.verify(
      body,
      headersOf({
        "x-hub-signature-256": sig,
        "x-github-event": "issues",
      }),
      SECRET,
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.synthetic).toBe(false);
    }
  });

  it("Test 8 (case-insensitive header reads): mixed-case headers accepted by Headers normalization", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const sig = signBody(body, SECRET);
    const result = githubAdapter.verify(
      body,
      headersOf({
        "X-Hub-Signature-256": sig,
        "X-GitHub-Event": "issues",
      }),
      SECRET,
    );
    expect(result.valid).toBe(true);
  });

  it("Test 9 (timing-safe equality): runtime smoke that equal signatures verify (source uses crypto.timingSafeEqual — verified by static analysis)", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const sig = signBody(body, SECRET);
    const result = githubAdapter.verify(
      body,
      headersOf({
        "x-hub-signature-256": sig,
        "x-github-event": "issues",
      }),
      SECRET,
    );
    expect(result.valid).toBe(true);
  });

  it("Test 9b (no SHA-1 fallback): legacy x-hub-signature header is NOT accepted (D-04 — GitHub deprecated SHA-1 in 2020)", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const sig = signBody(body, SECRET);
    const result = githubAdapter.verify(
      body,
      headersOf({
        "x-hub-signature": sig,
        "x-github-event": "issues",
      }),
      SECRET,
    );
    expect(result).toEqual({ valid: false, reason: "missing-signature" });
  });
});

describe("githubAdapter — extractLinkedIssueRef", () => {
  it("returns { externalKey: '<owner>/<repo>#<number>', externalSystem: 'GITHUB' } for canonical payload", () => {
    const ref = githubAdapter.extractLinkedIssueRef(CANONICAL_PAYLOAD);
    expect(ref).toEqual({
      externalKey: "octocat/Hello-World#42",
      externalSystem: "GITHUB",
    });
  });

  it("returns null when repository.full_name is missing", () => {
    const ref = githubAdapter.extractLinkedIssueRef({
      issue: { number: 42 },
    });
    expect(ref).toBeNull();
  });

  it("returns null when repository.full_name is not a string", () => {
    const ref = githubAdapter.extractLinkedIssueRef({
      issue: { number: 42 },
      repository: { full_name: 12345 },
    });
    expect(ref).toBeNull();
  });

  it("returns null when issue.number is missing", () => {
    const ref = githubAdapter.extractLinkedIssueRef({
      repository: { full_name: "octocat/Hello-World" },
    });
    expect(ref).toBeNull();
  });

  it("returns null when issue.number is not a number (string '42')", () => {
    const ref = githubAdapter.extractLinkedIssueRef({
      issue: { number: "42" },
      repository: { full_name: "octocat/Hello-World" },
    });
    expect(ref).toBeNull();
  });
});

describe("githubAdapter — extractExternalStatus", () => {
  it("returns 'closed' for canonical issues payload + eventType 'issues'", () => {
    expect(
      githubAdapter.extractExternalStatus(CANONICAL_PAYLOAD, "issues"),
    ).toBe("closed");
  });

  it("returns 'open' for an open issue payload + eventType 'issues'", () => {
    const openPayload = {
      issue: { number: 1, state: "open" },
      repository: { full_name: "octocat/Hello-World" },
    };
    expect(githubAdapter.extractExternalStatus(openPayload, "issues")).toBe(
      "open",
    );
  });

  it("returns null for eventType 'push' (D-06: only `issues` is handled in Phase 3)", () => {
    expect(
      githubAdapter.extractExternalStatus(CANONICAL_PAYLOAD, "push"),
    ).toBeNull();
  });

  it("returns null for eventType 'release' (D-06: only `issues` is handled in Phase 3)", () => {
    expect(
      githubAdapter.extractExternalStatus(CANONICAL_PAYLOAD, "release"),
    ).toBeNull();
  });

  it("returns null for eventType 'pull_request' (D-06: PR events deferred)", () => {
    expect(
      githubAdapter.extractExternalStatus(CANONICAL_PAYLOAD, "pull_request"),
    ).toBeNull();
  });

  it("returns null for eventType 'issue_comment' (D-06: comment events deferred)", () => {
    expect(
      githubAdapter.extractExternalStatus(CANONICAL_PAYLOAD, "issue_comment"),
    ).toBeNull();
  });

  it("returns null when issue.state is missing on an issues event", () => {
    const noState = {
      issue: { number: 42 },
      repository: { full_name: "octocat/Hello-World" },
    };
    expect(githubAdapter.extractExternalStatus(noState, "issues")).toBeNull();
  });

  it("returns null when issue is missing on an issues event", () => {
    const noIssue = { repository: { full_name: "octocat/Hello-World" } };
    expect(githubAdapter.extractExternalStatus(noIssue, "issues")).toBeNull();
  });

  it("returns null when issue.state is not a string on an issues event", () => {
    const badState = {
      issue: { number: 42, state: 123 },
      repository: { full_name: "octocat/Hello-World" },
    };
    expect(githubAdapter.extractExternalStatus(badState, "issues")).toBeNull();
  });

  // Regression: verify() returns a denormalized ParsedWebhookPayload; extractors
  // must read raw fields via `payload.data`. End-to-end seam test (no mocks).
  it("INTEGRATION: real verify() output flows through real extractors with non-null linkedRef + externalStatus", () => {
    const body = bodyOf(CANONICAL_PAYLOAD);
    const sig = signBody(body, SECRET);
    const headers = headersOf({
      "x-hub-signature-256": sig,
      "x-github-event": "issues",
    });

    const result = githubAdapter.verify(body, headers, SECRET);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    const linkedRef = githubAdapter.extractLinkedIssueRef(result.payload);
    expect(linkedRef).toEqual({
      externalKey: "octocat/Hello-World#42",
      externalSystem: "GITHUB",
    });

    const status = githubAdapter.extractExternalStatus(
      result.payload,
      result.payload.eventType,
    );
    expect(status).toBe("closed");
  });
});
