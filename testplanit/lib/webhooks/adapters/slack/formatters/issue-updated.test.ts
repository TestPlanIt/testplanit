import { describe, expect, it } from "vitest";

import type { OutboundEnvelope } from "../../types";
import { formatIssueUpdatedBlocks } from "./issue-updated";

function env(data: Record<string, unknown>): OutboundEnvelope {
  return {
    eventId: "evt_test",
    eventName: "issue.updated",
    eventTimestamp: "2026-06-10T12:00:00.000Z",
    tenantId: null,
    projectId: 293,
    projectName: "Demo Project",
    actorUserId: null,
    data,
  };
}

describe("formatIssueUpdatedBlocks", () => {
  it("links the title back to the issue in TestPlanIt", () => {
    const { body } = formatIssueUpdatedBlocks(
      env({
        id: 654,
        title: "Checkout bug",
        diff: {
          changedFields: ["status"],
          before: { status: "Open" },
          after: { status: "In Progress" },
        },
      })
    );
    expect(body).toContain("/projects/issues/293?issueId=654");
    expect(body).toContain("Checkout bug");
    expect(body).toContain("*status:* `Open` → `In Progress`");
  });

  it("adds a Tracked in link to the external tracker when present", () => {
    const { body } = formatIssueUpdatedBlocks(
      env({
        id: 654,
        title: "Checkout bug",
        externalKey: "TPIWEB-37",
        externalUrl: "https://x.atlassian.net/browse/TPIWEB-37",
        diff: { changedFields: [], before: {}, after: {} },
      })
    );
    // Title still links internally; tracker is a secondary link.
    expect(body).toContain("/projects/issues/293?issueId=654");
    expect(body).toContain(
      "Tracked in <https://x.atlassian.net/browse/TPIWEB-37|TPIWEB-37>"
    );
  });
});
