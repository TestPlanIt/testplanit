import { describe, expect, it } from "vitest";

import type { OutboundEnvelope } from "../../types";
import { formatIssueCreatedBlocks } from "./issue-created";

function env(data: Record<string, unknown>): OutboundEnvelope {
  return {
    eventId: "evt_test",
    eventName: "issue.created",
    eventTimestamp: "2026-06-10T12:00:00.000Z",
    tenantId: null,
    projectId: 293,
    projectName: "Demo Project",
    actorUserId: null,
    data,
  };
}

describe("formatIssueCreatedBlocks", () => {
  it("links the title to the TestPlanIt issue and the tracker as a secondary link", () => {
    const { body } = formatIssueCreatedBlocks(
      env({
        id: 81,
        title: "Checkout bug",
        status: "Open",
        externalKey: "TPIWEB-37",
        externalUrl: "https://x.atlassian.net/browse/TPIWEB-37",
      })
    );
    // Title links INTERNALLY (consistent with issue.updated).
    expect(body).toContain("/projects/issues/293?issueId=81");
    // External tracker is a secondary "Tracked in" link, not the title.
    expect(body).toContain(
      "Tracked in <https://x.atlassian.net/browse/TPIWEB-37|TPIWEB-37>"
    );
    expect(body).toContain("*Status:* Open");
  });

  it("omits the tracker line for a local issue with no external key", () => {
    const { body } = formatIssueCreatedBlocks(
      env({ id: 81, title: "Local only", status: "Open" })
    );
    expect(body).toContain("/projects/issues/293?issueId=81");
    expect(body).not.toContain("Tracked in");
  });
});
