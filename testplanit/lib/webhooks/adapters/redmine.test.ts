import { createHmac } from "node:crypto";
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

// Shapes captured from Redmine 7.0.3's own webhooks.
const NATIVE_ISSUE = {
  id: 1,
  project: { id: 1, name: "Sample project" },
  tracker: { id: 1, name: "Bug" },
  status: { id: 1, name: "New", is_closed: false },
  priority: { id: 2, name: "Normal" },
  author: { id: 1, name: "Redmine Admin" },
  fixed_version: { id: 1, name: "1.0" },
  subject: "[hook] native create",
  description: "body",
  start_date: null,
  due_date: null,
  done_ratio: 0,
  is_private: false,
  estimated_hours: null,
  total_estimated_hours: null,
  created_on: "2026-11-27T14:23:34Z",
  updated_on: "2026-11-27T14:23:34Z",
  closed_on: null,
};

const NATIVE_ISSUE_CREATED = {
  type: "issue.created",
  timestamp: "2026-11-27T14:23:34Z",
  data: { issue: NATIVE_ISSUE },
};

const NATIVE_ISSUE_UPDATED = {
  type: "issue.updated",
  timestamp: "2026-11-27T14:23:36Z",
  data: {
    issue: {
      ...NATIVE_ISSUE,
      status: { id: 3, name: "Resolved", is_closed: false },
      updated_on: "2026-11-27T14:23:36Z",
    },
    journal: {
      id: 1,
      created_on: "2026-11-27T14:23:36Z",
      notes: "resolving via native hook",
      user: { id: 1, name: "Redmine Admin" },
      details: [
        {
          property: "attr",
          prop_key: "status_id",
          old_value: "1",
          value: "3",
        },
      ],
    },
  },
};

const NATIVE_ISSUE_DELETED = {
  type: "issue.deleted",
  timestamp: "2026-11-27T14:23:37+00:00",
  data: { issue: { ...NATIVE_ISSUE, id: 2 } },
};

const NATIVE_VERSION = {
  id: 1,
  project: { id: 7, name: "Sample project" },
  name: "1.0",
  description: "hook test",
  status: "open",
  due_date: "2026-12-31",
  sharing: "none",
  wiki_page_title: null,
  created_on: "2026-11-27T14:23:34Z",
  updated_on: "2026-11-27T14:23:34Z",
};

const versionEvent = (action: string, version: object = {}) => ({
  type: `version.${action}`,
  timestamp: "2026-11-27T14:23:36Z",
  data: { version: { ...NATIVE_VERSION, ...version } },
});

const buf = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8");
const SECRET = "redmine-webhook-secret";
const unsignedHeaders = new Headers();
const UNSIGNED_OK = { allowUnsigned: true };

function signed(body: Buffer, secret = SECRET) {
  return new Headers({
    "x-redmine-signature-256":
      "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
  });
}

describe("redmineAdapter (inbound webhook)", () => {
  it("declares the REDMINE adapter type", () => {
    expect(redmineAdapter.adapterType).toBe("REDMINE");
  });

  describe("verify: signature", () => {
    it("accepts a delivery signed with the config secret", () => {
      const body = buf(NATIVE_ISSUE_UPDATED);
      const r = redmineAdapter.verify(body, signed(body), SECRET);
      expect(r.valid).toBe(true);
    });

    it("matches the signature Redmine computed for a captured delivery", () => {
      // Body and header as Redmine 7.0.3 sent them for a hook whose secret
      // was "testplanit-fixture-secret".
      const body = Buffer.from(
        '{"type":"version.created","timestamp":"2026-11-27T14:29:39Z","data":{"version":{"id":3,"project":{"id":1,"name":"TestPlanIt gap check"},"name":"1.0","description":"fixture","status":"open","due_date":"2026-12-31","sharing":"none","wiki_page_title":null,"created_on":"2026-11-27T14:29:39Z","updated_on":"2026-11-27T14:29:39Z"}}}',
        "utf8"
      );
      const headers = new Headers({
        "x-redmine-signature-256":
          "sha256=733f9302e833fd1992226eb3f0711f0a3c2bfbc6c06a37f5b81b757d2b4e13b3",
      });
      const r = redmineAdapter.verify(
        body,
        headers,
        "testplanit-fixture-secret"
      );
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.eventType).toBe("milestone_created");
    });

    it("rejects a signature made with another secret", () => {
      const body = buf(NATIVE_ISSUE_UPDATED);
      const r = redmineAdapter.verify(body, signed(body, "other"), SECRET);
      expect(r).toEqual({ valid: false, reason: "signature-mismatch" });
    });

    it("rejects a signature over a different body", () => {
      const r = redmineAdapter.verify(
        buf(NATIVE_ISSUE_UPDATED),
        signed(buf(NATIVE_ISSUE_CREATED)),
        SECRET
      );
      expect(r).toEqual({ valid: false, reason: "signature-mismatch" });
    });

    it("rejects a mismatched signature even when unsigned deliveries are allowed", () => {
      const body = buf(OPENED);
      const r = redmineAdapter.verify(
        body,
        signed(body, "other"),
        SECRET,
        UNSIGNED_OK
      );
      expect(r).toEqual({ valid: false, reason: "signature-mismatch" });
    });

    it("rejects a malformed signature header", () => {
      const body = buf(NATIVE_ISSUE_UPDATED);
      for (const value of ["abc", "sha256=xyz", "sha1=" + "a".repeat(64)]) {
        const r = redmineAdapter.verify(
          body,
          new Headers({ "x-redmine-signature-256": value }),
          SECRET
        );
        expect(r).toEqual({ valid: false, reason: "malformed-signature" });
      }
    });

    it("rejects an unsigned delivery unless the config allows them", () => {
      for (const body of [OPENED, NATIVE_ISSUE_UPDATED]) {
        expect(
          redmineAdapter.verify(buf(body), unsignedHeaders, SECRET)
        ).toEqual({ valid: false, reason: "missing-signature" });
        expect(
          redmineAdapter.verify(buf(body), unsignedHeaders, SECRET, UNSIGNED_OK)
            .valid
        ).toBe(true);
      }
    });
  });

  describe("verify: redmine_webhook plugin payload", () => {
    const verify = (body: unknown) =>
      redmineAdapter.verify(buf(body), unsignedHeaders, SECRET, UNSIGNED_OK);

    it("parses an 'opened' delivery", () => {
      const r = verify(OPENED);
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.eventType).toBe("redmine:issue_opened");
      expect(r.payload.issueKey).toBe("#5");
      expect(r.payload.externalStatus).toBe("New");
      expect(r.payload.synthetic).toBe(false);
      expect(r.payload.data).toEqual(OPENED);
    });

    it("parses an 'updated' delivery with the changed status", () => {
      const r = verify(UPDATED);
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.eventType).toBe("redmine:issue_updated");
      expect(r.payload.issueKey).toBe("#5");
      expect(r.payload.externalStatus).toBe("Resolved");
    });

    it("rejects an unparseable body", () => {
      const r = redmineAdapter.verify(
        Buffer.from("not json"),
        unsignedHeaders,
        SECRET,
        UNSIGNED_OK
      );
      expect(r).toEqual({ valid: false, reason: "unparseable-body" });
    });

    it("rejects a payload missing issue.id", () => {
      expect(
        verify({ payload: { action: "opened", issue: { subject: "x" } } })
      ).toEqual({ valid: false, reason: "missing-required-field" });
    });

    it("rejects a payload missing the action", () => {
      expect(verify({ payload: { issue: { id: 5 } } })).toEqual({
        valid: false,
        reason: "missing-required-field",
      });
    });

    it("tolerates a missing status (externalStatus empty)", () => {
      const r = verify({ payload: { action: "opened", issue: { id: 9 } } });
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.externalStatus).toBe("");
    });

    it("flags the synthetic sentinel id", () => {
      const r = verify({ payload: { action: "opened", issue: { id: 0 } } });
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.synthetic).toBe(true);
    });
  });

  describe("verify: Redmine 7 payload", () => {
    const verify = (body: unknown) => {
      const raw = buf(body);
      return redmineAdapter.verify(raw, signed(raw), SECRET);
    };

    it("parses issue.created", () => {
      const r = verify(NATIVE_ISSUE_CREATED);
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.eventType).toBe("redmine:issue_created");
      expect(r.payload.issueKey).toBe("#1");
      expect(r.payload.externalStatus).toBe("New");
      expect(r.payload.synthetic).toBe(false);
      expect(r.payload.data).toEqual(NATIVE_ISSUE_CREATED);
    });

    it("parses issue.updated with the changed status", () => {
      const r = verify(NATIVE_ISSUE_UPDATED);
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.eventType).toBe("redmine:issue_updated");
      expect(r.payload.issueKey).toBe("#1");
      expect(r.payload.externalStatus).toBe("Resolved");
    });

    it("parses issue.deleted", () => {
      const r = verify(NATIVE_ISSUE_DELETED);
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.eventType).toBe("redmine:issue_deleted");
      expect(r.payload.issueKey).toBe("#2");
    });

    it("rejects an issue event with no issue id", () => {
      expect(verify({ type: "issue.updated", data: { issue: {} } })).toEqual({
        valid: false,
        reason: "missing-required-field",
      });
    });

    it("maps version events onto milestone event types", () => {
      const cases: Array<[unknown, string]> = [
        [versionEvent("created"), "milestone_created"],
        [versionEvent("updated"), "milestone_edited"],
        [versionEvent("updated", { status: "locked" }), "milestone_edited"],
        [versionEvent("updated", { status: "closed" }), "milestone_closed"],
        [versionEvent("deleted"), "milestone_deleted"],
        [versionEvent("deleted", { status: "closed" }), "milestone_deleted"],
      ];
      for (const [body, eventType] of cases) {
        const r = verify(body);
        expect(r.valid).toBe(true);
        if (!r.valid) return;
        expect(r.payload.eventType).toBe(eventType);
        expect(r.payload.issueKey).toBe("");
        expect(r.payload.synthetic).toBe(false);
      }
    });

    it("rejects a version event with no version id", () => {
      expect(
        verify({ type: "version.updated", data: { version: { name: "x" } } })
      ).toEqual({ valid: false, reason: "missing-required-field" });
    });

    it("accepts the other event kinds without an issue or milestone", () => {
      const r = verify({
        type: "time_entry.created",
        timestamp: "2026-11-27T14:23:36Z",
        data: { time_entry: { id: 4 } },
      });
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(r.payload.eventType).toBe("redmine:time_entry_created");
      expect(r.payload.issueKey).toBe("");
      expect(
        redmineAdapter.extractExternalStatus(r.payload, r.payload.eventType)
      ).toBeNull();
      expect(redmineAdapter.extractLinkedIssueRef(r.payload)).toBeNull();
    });

    it("rejects a type that names no action", () => {
      expect(verify({ type: "issue", data: {} })).toEqual({
        valid: false,
        reason: "missing-required-field",
      });
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
        externalId: "5",
      });
    });

    it("reads the raw body shape directly too", () => {
      expect(redmineAdapter.extractLinkedIssueRef(OPENED)).toEqual({
        externalKey: "#5",
        externalSystem: "REDMINE",
        externalId: "5",
      });
    });

    it("reads the issue of a Redmine 7 payload", () => {
      expect(
        redmineAdapter.extractLinkedIssueRef(NATIVE_ISSUE_UPDATED)
      ).toEqual({
        externalKey: "#1",
        externalSystem: "REDMINE",
        externalId: "1",
      });
    });

    it("returns null when there is no issue id", () => {
      expect(
        redmineAdapter.extractLinkedIssueRef({ payload: { action: "opened" } })
      ).toBeNull();
      expect(
        redmineAdapter.extractLinkedIssueRef(versionEvent("updated"))
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

    it("returns the status name for Redmine 7 created/updated events", () => {
      expect(
        redmineAdapter.extractExternalStatus(
          NATIVE_ISSUE_CREATED,
          "redmine:issue_created"
        )
      ).toBe("New");
      expect(
        redmineAdapter.extractExternalStatus(
          NATIVE_ISSUE_UPDATED,
          "redmine:issue_updated"
        )
      ).toBe("Resolved");
    });

    it("returns null for unrelated event types", () => {
      expect(
        redmineAdapter.extractExternalStatus(OPENED, "redmine:issue_deleted")
      ).toBeNull();
      expect(
        redmineAdapter.extractExternalStatus(
          NATIVE_ISSUE_DELETED,
          "redmine:issue_deleted"
        )
      ).toBeNull();
    });
  });

  describe("extractMilestoneEventRef", () => {
    it("returns the version and its project as a RELEASE ref", () => {
      for (const eventType of [
        "milestone_created",
        "milestone_edited",
        "milestone_closed",
        "milestone_deleted",
      ]) {
        expect(
          redmineAdapter.extractMilestoneEventRef!(
            versionEvent("updated"),
            eventType
          )
        ).toEqual({
          kind: "RELEASE",
          externalId: "1",
          externalProjectId: "7",
          merge: false,
        });
      }
    });

    it("reads a parsed payload's data", () => {
      const raw = buf(versionEvent("created"));
      const r = redmineAdapter.verify(raw, signed(raw), SECRET);
      expect(r.valid).toBe(true);
      if (!r.valid) return;
      expect(
        redmineAdapter.extractMilestoneEventRef!(r.payload, r.payload.eventType)
      ).toEqual({
        kind: "RELEASE",
        externalId: "1",
        externalProjectId: "7",
        merge: false,
      });
    });

    it("returns null for issue events and incomplete versions", () => {
      expect(
        redmineAdapter.extractMilestoneEventRef!(
          NATIVE_ISSUE_UPDATED,
          "redmine:issue_updated"
        )
      ).toBeNull();
      expect(
        redmineAdapter.extractMilestoneEventRef!(
          { type: "version.updated", data: { version: { id: 3 } } },
          "milestone_edited"
        )
      ).toBeNull();
    });
  });
});
