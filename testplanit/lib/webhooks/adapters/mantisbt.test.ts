import { describe, expect, it } from "vitest";
import { mantisbtAdapter } from "./mantisbt";
import type { ParsedWebhookPayload } from "./types";

function body(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj), "utf8");
}

const HEADERS = new Headers();
const SECRET = "";

describe("mantisbtAdapter (inbound webhook)", () => {
  it("declares the MANTISBT adapter type", () => {
    expect(mantisbtAdapter.adapterType).toBe("MANTISBT");
  });

  describe("verify", () => {
    it("parses an issue event into a normalized payload", () => {
      const result = mantisbtAdapter.verify(
        body({
          event: "updated",
          issue: { id: 42, status: { name: "resolved" } },
        }),
        HEADERS,
        SECRET
      );

      expect(result).toEqual({
        valid: true,
        payload: {
          eventType: "mantisbt:issue_updated",
          issueKey: "#42",
          externalStatus: "resolved",
          synthetic: false,
          data: {
            event: "updated",
            issue: { id: 42, status: { name: "resolved" } },
          },
        },
      });
    });

    it("does no signature check — the URL token is the credential", () => {
      // A garbage secret and empty headers still verify; only the body shape matters.
      const result = mantisbtAdapter.verify(
        body({ action: "created", issue: { id: 1, status: { label: "new" } } }),
        new Headers({ "x-whatever": "nope" }),
        "totally-wrong-secret"
      );
      expect(result.valid).toBe(true);
    });

    it("reads the issue from the `bug` envelope and a string status", () => {
      const result = mantisbtAdapter.verify(
        body({ event_type: "created", bug: { id: 7, status: "new" } }),
        HEADERS,
        SECRET
      );

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.issueKey).toBe("#7");
        expect(result.payload.eventType).toBe("mantisbt:issue_created");
        expect(result.payload.externalStatus).toBe("new");
      }
    });

    it("flags the synthetic self-test id (0)", () => {
      const result = mantisbtAdapter.verify(
        body({ event: "ping", issue: { id: 0 } }),
        HEADERS,
        SECRET
      );
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.payload.synthetic).toBe(true);
    });

    it("rejects an unparseable body", () => {
      const result = mantisbtAdapter.verify(
        Buffer.from("not json", "utf8"),
        HEADERS,
        SECRET
      );
      expect(result).toEqual({ valid: false, reason: "unparseable-body" });
    });

    it("rejects a body missing the issue id or action", () => {
      expect(
        mantisbtAdapter.verify(body({ issue: { id: 5 } }), HEADERS, SECRET)
      ).toEqual({ valid: false, reason: "missing-required-field" });

      expect(
        mantisbtAdapter.verify(body({ event: "updated" }), HEADERS, SECRET)
      ).toEqual({ valid: false, reason: "missing-required-field" });
    });
  });

  describe("extractLinkedIssueRef", () => {
    it("returns the #id key and MANTISBT system", () => {
      const payload: ParsedWebhookPayload = {
        eventType: "mantisbt:issue_updated",
        issueKey: "#42",
        externalStatus: "resolved",
        synthetic: false,
        data: { event: "updated", issue: { id: 42 } },
      };
      expect(mantisbtAdapter.extractLinkedIssueRef(payload)).toEqual({
        externalKey: "#42",
        externalSystem: "MANTISBT",
      });
    });

    it("returns null when no issue id is present", () => {
      const payload: ParsedWebhookPayload = {
        eventType: "mantisbt:issue_updated",
        issueKey: "",
        externalStatus: "",
        synthetic: false,
        data: { event: "updated" },
      };
      expect(mantisbtAdapter.extractLinkedIssueRef(payload)).toBeNull();
    });
  });

  describe("extractExternalStatus", () => {
    it("returns the status name for a mantisbt issue event", () => {
      const payload: ParsedWebhookPayload = {
        eventType: "mantisbt:issue_updated",
        issueKey: "#42",
        externalStatus: "resolved",
        synthetic: false,
        data: {
          event: "updated",
          issue: { id: 42, status: { name: "resolved" } },
        },
      };
      expect(
        mantisbtAdapter.extractExternalStatus(payload, "mantisbt:issue_updated")
      ).toBe("resolved");
    });

    it("returns null for an unrelated event type", () => {
      const payload: ParsedWebhookPayload = {
        eventType: "jira:issue_updated",
        issueKey: "#42",
        externalStatus: "resolved",
        synthetic: false,
        data: {},
      };
      expect(
        mantisbtAdapter.extractExternalStatus(payload, "jira:issue_updated")
      ).toBeNull();
    });
  });
});
