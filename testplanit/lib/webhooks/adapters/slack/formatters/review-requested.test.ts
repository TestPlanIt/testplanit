import { describe, expect, it } from "vitest";
import type { OutboundEnvelope } from "../../types";
import { formatReviewRequestedBlocks } from "./review-requested";

function baseEnvelope(
  overrides: Record<string, unknown> = {}
): OutboundEnvelope {
  return {
    eventId: "evt_00000000-0000-4000-8000-000000000000",
    eventName: "case.review_requested",
    eventTimestamp: "2026-05-20T12:00:00.000Z",
    tenantId: "test-tenant",
    projectId: 1,
    projectName: "Acme",
    actorUserId: "u-1",
    data: {
      reviewRequestId: "rr_1",
      projectId: 1,
      entityType: "CASE",
      entityId: 42,
      entityName: "Login flow",
      entityUrl: "http://app.example.com/projects/repository/1/42",
      fromStateName: "Draft",
      toStateName: "Ready",
      toStateColor: "#22c55e",
      requesterName: "Alice",
      assigneeUserName: "Bob",
      assigneeRoleName: null,
      commentText: "Please review.",
      ...overrides,
    },
  };
}

function parse(envelope: OutboundEnvelope) {
  return JSON.parse(formatReviewRequestedBlocks(envelope).body);
}

function blocksOf(envelope: OutboundEnvelope) {
  return parse(envelope).attachments[0].blocks as Array<Record<string, any>>;
}

describe("formatReviewRequestedBlocks", () => {
  it("returns body string + JSON content type", () => {
    const out = formatReviewRequestedBlocks(baseEnvelope());
    expect(typeof out.body).toBe("string");
    expect(out.contentType).toBe("application/json");
  });

  it("uses workflow color of the to-state on the attachment bar", () => {
    const parsed = parse(baseEnvelope());
    expect(parsed.attachments[0].color).toBe("#22c55e");
  });

  it("falls back to a neutral color when toStateColor is null", () => {
    const parsed = parse(baseEnvelope({ toStateColor: null }));
    expect(parsed.attachments[0].color).toBe("#64748b");
  });

  it("header is plain 'Review requested'", () => {
    expect(blocksOf(baseEnvelope())[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "Review requested" },
    });
  });

  it("renders entity title with the entityUrl link and 'in <project>' line", () => {
    const blocks = blocksOf(baseEnvelope());
    expect(blocks[1].text.text).toBe(
      "*<http://app.example.com/projects/repository/1/42|Login flow>*\nin Acme"
    );
  });

  it("renders requester + assignee identity line for CASE entity", () => {
    const blocks = blocksOf(baseEnvelope());
    expect(blocks[2].text.text).toContain(
      "Test case review requested by *Alice* from *Bob*"
    );
  });

  it("falls back to role-name suffix when user assignee is absent", () => {
    const blocks = blocksOf(
      baseEnvelope({ assigneeUserName: null, assigneeRoleName: "QA Lead" })
    );
    expect(blocks[2].text.text).toContain("from *QA Lead (role)*");
  });

  it("renders target-state transition line when both states present", () => {
    const blocks = blocksOf(baseEnvelope());
    const stateLine = blocks.find((b) =>
      String(b.text?.text ?? "").includes("Target state")
    );
    expect(stateLine?.text.text).toBe("*Target state:* Draft → Ready");
  });

  it("renders the requester comment when present", () => {
    const blocks = blocksOf(baseEnvelope());
    const commentBlock = blocks.find(
      (b) =>
        b.type === "section" && String(b.text?.text ?? "") === "Please review."
    );
    expect(commentBlock).toBeDefined();
  });

  it("omits divider and comment block when commentText is null", () => {
    const blocks = blocksOf(baseEnvelope({ commentText: null }));
    expect(blocks.find((b) => b.type === "divider")).toBeUndefined();
  });

  it("uses 'Test run' label for RUN entityType", () => {
    const blocks = blocksOf(baseEnvelope({ entityType: "RUN" }));
    expect(blocks[2].text.text).toContain("Test run review requested");
  });

  it("uses 'Session' label for SESSION entityType", () => {
    const blocks = blocksOf(baseEnvelope({ entityType: "SESSION" }));
    expect(blocks[2].text.text).toContain("Session review requested");
  });
});
