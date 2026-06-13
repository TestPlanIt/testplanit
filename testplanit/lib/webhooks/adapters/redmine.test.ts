import { describe, expect, it } from "vitest";
import { redmineAdapter } from "./redmine";
import type { ParsedWebhookPayload } from "./types";

// Shapes captured from the redmine_webhook plugin against Redmine 6.1.2.
const OPENED = {
  payload: {
    action: "opened",
    issue: {
      id: 5,
      subject: "[hook] capture create",
      status: { id: 1, name: "New" },
      tracker: { id: 1, name: "Bug" },
      priority: { id: 3, name: "High" },
    },
    url: "http://redmine.example.com/issues/5",
  },
};

const UPDATED = {
  payload: {
    action: "updated",
    issue: {
      id: 5,
      status: { id: 3, name: "Resolved" },
    },
    journal: {
      id: 6,
      notes: "resolving",
      details: [{ prop_key: "status_id", old_value: "1", value: "3" }],
    },
    url: "http://redmine.example.com/issues/5",
  },
};

const buf = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8");
const headers = new Headers();
const SECRET = "unused-for-redmine";

describe("redmineAdapter (inbound webhook)", () => {
  it("declares the REDMINE adapter type", () => {
    expect(redmineAdapter.adapterType).toBe("REDMINE");
  });

  describe("verify", () => {
    it("parses an 'opened' delivery (no signature required)", () => {
      const r = redmineAdapter.verify(buf(OPENED), headers, SECRET);
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.eventType).toBe("redmine:issue_opened");
      expect(r.payload.issueKey).toBe("#5");
      expect(r.payload.externalStatus).toBe("New");
      expect(r.payload.synthetic).toBe(false);
      expect(r.payload.data).toEqual(OPENED);
    });

    it("parses an 'updated' delivery with the changed status", () => {
      const r = redmineAdapter.verify(buf(UPDATED), headers, SECRET);
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.eventType).toBe("redmine:issue_updated");
      expect(r.payload.issueKey).toBe("#5");
      expect(r.payload.externalStatus).toBe("Resolved");
    });

    it("rejects an unparseable body", () => {
      const r = redmineAdapter.verify(Buffer.from("not json"), headers, SECRET);
      expect(r).toEqual({ valid: false, reason: "unparseable-body" });
    });

    it("rejects a payload missing issue.id", () => {
      const r = redmineAdapter.verify(
        buf({ payload: { action: "opened", issue: { subject: "x" } } }),
        headers,
        SECRET
      );
      expect(r).toEqual({ valid: false, reason: "missing-required-field" });
    });

    it("rejects a payload missing the action", () => {
      const r = redmineAdapter.verify(
        buf({ payload: { issue: { id: 5 } } }),
        headers,
        SECRET
      );
      expect(r).toEqual({ valid: false, reason: "missing-required-field" });
    });

    it("tolerates a missing status (externalStatus empty)", () => {
      const r = redmineAdapter.verify(
        buf({ payload: { action: "opened", issue: { id: 9 } } }),
        headers,
        SECRET
      );
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.externalStatus).toBe("");
    });

    it("flags the synthetic sentinel id", () => {
      const r = redmineAdapter.verify(
        buf({ payload: { action: "opened", issue: { id: 0 } } }),
        headers,
        SECRET
      );
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.synthetic).toBe(true);
    });
  });

  describe("extractLinkedIssueRef", () => {
    it("returns #id keyed to REDMINE from a parsed payload", () => {
      const parsed: ParsedWebhookPayload = {
        eventType: "redmine:issue_updated",
        issueKey: "#5",
        externalStatus: "Resolved",
        synthetic: false,
        data: UPDATED,
      };
      expect(redmineAdapter.extractLinkedIssueRef(parsed)).toEqual({
        externalKey: "#5",
        externalSystem: "REDMINE",
      });
    });

    it("reads the raw body shape directly too", () => {
      expect(redmineAdapter.extractLinkedIssueRef(OPENED)).toEqual({
        externalKey: "#5",
        externalSystem: "REDMINE",
      });
    });

    it("returns null when there is no issue id", () => {
      expect(
        redmineAdapter.extractLinkedIssueRef({ payload: { action: "opened" } })
      ).toBeNull();
    });
  });

  describe("extractExternalStatus", () => {
    it("returns the status name for opened/updated events", () => {
      expect(
        redmineAdapter.extractExternalStatus(OPENED, "redmine:issue_opened")
      ).toBe("New");
      expect(
        redmineAdapter.extractExternalStatus(UPDATED, "redmine:issue_updated")
      ).toBe("Resolved");
    });

    it("returns null for unrelated event types", () => {
      expect(
        redmineAdapter.extractExternalStatus(OPENED, "redmine:issue_deleted")
      ).toBeNull();
    });
  });
});
