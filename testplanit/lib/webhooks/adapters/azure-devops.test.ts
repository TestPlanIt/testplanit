import { describe, expect, it } from "vitest";
import { azureDevopsAdapter } from "./azure-devops";

function basicAuthHeader(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
}

function bodyOf(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), "utf8");
}

function headersOf(init: Record<string, string>): Headers {
  return new Headers(init);
}

const ADO_SECRET = JSON.stringify({ username: "tpi", password: "s3cret" });

const CANONICAL_PAYLOAD = {
  eventType: "workitem.updated",
  resource: {
    id: 297,
    fields: { "System.State": "Closed" },
  },
};

describe("azureDevopsAdapter", () => {
  it("Test 0: adapterType is AZURE_DEVOPS", () => {
    expect(azureDevopsAdapter.adapterType).toBe("AZURE_DEVOPS");
  });

  describe("verify()", () => {
    it("Test 1: missing Authorization header → missing-auth", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({}),
        ADO_SECRET,
      );
      expect(result).toEqual({ valid: false, reason: "missing-auth" });
    });

    it("Test 1b: header without Basic prefix → missing-auth", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ authorization: "Bearer xyz" }),
        ADO_SECRET,
      );
      expect(result).toEqual({ valid: false, reason: "missing-auth" });
    });

    it("Test 1c: case-insensitive header read (Authorization, not authorization)", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ Authorization: basicAuthHeader("tpi", "s3cret") }),
        ADO_SECRET,
      );
      expect(result.valid).toBe(true);
    });

    it("Test 2: wrong username → auth-mismatch", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ authorization: basicAuthHeader("wrong", "s3cret") }),
        ADO_SECRET,
      );
      expect(result).toEqual({ valid: false, reason: "auth-mismatch" });
    });

    it("Test 2b: wrong password → auth-mismatch", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ authorization: basicAuthHeader("tpi", "wrong") }),
        ADO_SECRET,
      );
      expect(result).toEqual({ valid: false, reason: "auth-mismatch" });
    });

    it("Test 2c: malformed secret JSON → auth-mismatch (NOT unparseable-body)", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        "not-json{[",
      );
      expect(result).toEqual({ valid: false, reason: "auth-mismatch" });
    });

    it("Test 2d: secret JSON missing username field → auth-mismatch", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        JSON.stringify({ password: "only" }),
      );
      expect(result).toEqual({ valid: false, reason: "auth-mismatch" });
    });

    it("Test 2e: secret JSON missing password field → auth-mismatch", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        JSON.stringify({ username: "only" }),
      );
      expect(result).toEqual({ valid: false, reason: "auth-mismatch" });
    });

    it("Test 2f: decoded credential missing colon → auth-mismatch", () => {
      const malformed =
        "Basic " + Buffer.from("nocolon", "utf8").toString("base64");
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ authorization: malformed }),
        ADO_SECRET,
      );
      expect(result).toEqual({ valid: false, reason: "auth-mismatch" });
    });

    it("Test 2g: length-different credentials still surface auth-mismatch (mitigation check)", () => {
      // Different-length username and password vs configured creds; without the
      // hash-then-timingSafeEqual mitigation, timingSafeEqual would throw on
      // unequal-length buffers. With the mitigation, we get a clean
      // auth-mismatch return value.
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({
          authorization: basicAuthHeader("a-very-long-username", "x"),
        }),
        ADO_SECRET,
      );
      expect(result).toEqual({ valid: false, reason: "auth-mismatch" });
    });

    it("Test 2h: password containing colon parses correctly (split on first colon only)", () => {
      const passWithColon = "p:a:s:s";
      const secret = JSON.stringify({
        username: "tpi",
        password: passWithColon,
      });
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ authorization: basicAuthHeader("tpi", passWithColon) }),
        secret,
      );
      expect(result.valid).toBe(true);
    });

    it("Test 3: valid auth + non-JSON body → unparseable-body", () => {
      const result = azureDevopsAdapter.verify(
        Buffer.from("not-json{[", "utf8"),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        ADO_SECRET,
      );
      expect(result).toEqual({ valid: false, reason: "unparseable-body" });
    });

    it("Test 4: valid auth + JSON without eventType → missing-required-field", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf({ resource: { id: 1 } }),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        ADO_SECRET,
      );
      expect(result).toEqual({ valid: false, reason: "missing-required-field" });
    });

    it("Test 4b: valid auth + JSON with non-string eventType → missing-required-field", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf({ eventType: 42, resource: { id: 1 } }),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        ADO_SECRET,
      );
      expect(result).toEqual({ valid: false, reason: "missing-required-field" });
    });

    it("Test 5: happy path — valid auth + canonical workitem.updated payload", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        ADO_SECRET,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.eventType).toBe("workitem.updated");
        expect(result.payload.issueKey).toBe("297");
        expect(result.payload.externalStatus).toBe("Closed");
        expect(result.payload.synthetic).toBe(false);
      }
    });

    it("Test 5b: happy path — resourceVersion 1.0 payload tolerated (same field paths)", () => {
      const v1Payload = {
        eventType: "workitem.updated",
        resourceVersion: "1.0",
        resource: {
          id: 297,
          fields: { "System.State": "Active" },
        },
      };
      const result = azureDevopsAdapter.verify(
        bodyOf(v1Payload),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        ADO_SECRET,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.issueKey).toBe("297");
        expect(result.payload.externalStatus).toBe("Active");
      }
    });

    it("Test 5c: happy path — resourceVersion 2.0 payload tolerated (same field paths)", () => {
      const v2Payload = {
        eventType: "workitem.updated",
        resourceVersion: "2.0",
        resource: {
          id: 297,
          fields: { "System.State": "Resolved" },
        },
      };
      const result = azureDevopsAdapter.verify(
        bodyOf(v2Payload),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        ADO_SECRET,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.issueKey).toBe("297");
        expect(result.payload.externalStatus).toBe("Resolved");
      }
    });
  });

  describe("synthetic sentinel", () => {
    it("Test 6: resource.id === 0 marks payload.synthetic=true", () => {
      const synth = {
        eventType: "workitem.updated",
        resource: { id: 0, fields: { "System.State": "Synthetic" } },
      };
      const result = azureDevopsAdapter.verify(
        bodyOf(synth),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        ADO_SECRET,
      );
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.synthetic).toBe(true);
        expect(result.payload.issueKey).toBe("0");
      }
    });

    it("Test 6b: real-world resource.id (≥ 1) keeps synthetic=false", () => {
      const result = azureDevopsAdapter.verify(
        bodyOf(CANONICAL_PAYLOAD),
        headersOf({ authorization: basicAuthHeader("tpi", "s3cret") }),
        ADO_SECRET,
      );
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.payload.synthetic).toBe(false);
    });
  });

  describe("extractLinkedIssueRef()", () => {
    it("Test 7: returns String(resource.id) for canonical payload", () => {
      expect(
        azureDevopsAdapter.extractLinkedIssueRef(CANONICAL_PAYLOAD),
      ).toEqual({
        externalKey: "297",
        externalSystem: "AZURE_DEVOPS",
      });
    });

    it("Test 7b: returns null when resource.id is not a number (string)", () => {
      expect(
        azureDevopsAdapter.extractLinkedIssueRef({ resource: { id: "297" } }),
      ).toBeNull();
    });

    it("Test 7c: returns null when resource is missing", () => {
      expect(azureDevopsAdapter.extractLinkedIssueRef({})).toBeNull();
    });

    it("Test 7d: returns null when resource.id is missing", () => {
      expect(
        azureDevopsAdapter.extractLinkedIssueRef({ resource: {} }),
      ).toBeNull();
    });
  });

  describe("extractExternalStatus()", () => {
    it("Test 8: returns System.State for workitem.updated", () => {
      expect(
        azureDevopsAdapter.extractExternalStatus(
          CANONICAL_PAYLOAD,
          "workitem.updated",
        ),
      ).toBe("Closed");
    });

    it("Test 8b: returns null for build.complete (no_handler)", () => {
      expect(
        azureDevopsAdapter.extractExternalStatus(
          CANONICAL_PAYLOAD,
          "build.complete",
        ),
      ).toBeNull();
    });

    it("Test 8c: returns null for workitem.created (no_handler in Phase 3)", () => {
      expect(
        azureDevopsAdapter.extractExternalStatus(
          CANONICAL_PAYLOAD,
          "workitem.created",
        ),
      ).toBeNull();
    });

    it("Test 8d: returns null for workitem.deleted (no_handler in Phase 3)", () => {
      expect(
        azureDevopsAdapter.extractExternalStatus(
          CANONICAL_PAYLOAD,
          "workitem.deleted",
        ),
      ).toBeNull();
    });

    it("Test 8e: returns null when System.State is missing for workitem.updated", () => {
      expect(
        azureDevopsAdapter.extractExternalStatus(
          { resource: { id: 1, fields: {} } },
          "workitem.updated",
        ),
      ).toBeNull();
    });

    it("Test 8f: returns null when System.State is non-string", () => {
      expect(
        azureDevopsAdapter.extractExternalStatus(
          { resource: { id: 1, fields: { "System.State": 42 } } },
          "workitem.updated",
        ),
      ).toBeNull();
    });
  });

  // Regression: verify() returns a denormalized ParsedWebhookPayload; extractors
  // must read raw fields via `payload.data`. End-to-end seam test (no mocks).
  describe("INTEGRATION: real verify→extractors path", () => {
    it("real verify() output flows through real extractors with non-null linkedRef + externalStatus", () => {
      const body = bodyOf(CANONICAL_PAYLOAD);
      const headers = headersOf({
        authorization: basicAuthHeader("tpi", "s3cret"),
      });

      const result = azureDevopsAdapter.verify(body, headers, ADO_SECRET);
      expect(result.valid).toBe(true);
      if (!result.valid) return;

      const linkedRef = azureDevopsAdapter.extractLinkedIssueRef(result.payload);
      expect(linkedRef).toEqual({
        externalKey: "297",
        externalSystem: "AZURE_DEVOPS",
      });

      const status = azureDevopsAdapter.extractExternalStatus(
        result.payload,
        result.payload.eventType,
      );
      expect(status).toBe("Closed");
    });
  });
});
