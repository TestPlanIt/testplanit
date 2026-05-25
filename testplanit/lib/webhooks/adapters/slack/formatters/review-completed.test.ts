import { describe, expect, it } from "vitest";
import type { OutboundEnvelope } from "../../types";
import { formatReviewCompletedBlocks } from "./review-completed";

function envelopeFor(
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | "CANCELLED",
  overrides: Record<string, unknown> = {}
): OutboundEnvelope {
  return {
    eventId: "evt_00000000-0000-4000-8000-000000000000",
    eventName: "case.review_completed",
    eventTimestamp: "2026-05-20T12:00:00.000Z",
    tenantId: "test-tenant",
    projectId: 1,
    projectName: "Acme",
    actorUserId: "u-2",
    data: {
      reviewRequestId: "rr_1",
      projectId: 1,
      entityType: "CASE",
      entityId: 42,
      entityName: "Login flow",
      entityUrl: "http://app.example.com/projects/repository/1/42",
      toStateName: "Ready",
      toStateColor: "#22c55e",
      decision,
      deciderName: "Bob",
      requesterName: "Alice",
      decisionComment: "Looks good.",
      ...overrides,
    },
  };
}

function parse(envelope: OutboundEnvelope) {
  return JSON.parse(formatReviewCompletedBlocks(envelope).body);
}

function blocksOf(envelope: OutboundEnvelope) {
  return parse(envelope).attachments[0].blocks as Array<Record<string, any>>;
}

describe("formatReviewCompletedBlocks", () => {
  it("returns body string + JSON content type", () => {
    const out = formatReviewCompletedBlocks(envelopeFor("APPROVED"));
    expect(typeof out.body).toBe("string");
    expect(out.contentType).toBe("application/json");
  });

  it("APPROVED → green bar with 'Review approved' header", () => {
    const parsed = parse(envelopeFor("APPROVED"));
    expect(parsed.attachments[0].color).toBe("#22c55e");
    expect(parsed.attachments[0].blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "Review approved" },
    });
  });

  it("REJECTED → red bar with 'Review rejected' header", () => {
    const parsed = parse(envelopeFor("REJECTED"));
    expect(parsed.attachments[0].color).toBe("#ef4444");
    expect(parsed.attachments[0].blocks[0].text.text).toBe("Review rejected");
  });

  it("CHANGES_REQUESTED → yellow bar with 'Changes requested' header", () => {
    const parsed = parse(envelopeFor("CHANGES_REQUESTED"));
    expect(parsed.attachments[0].color).toBe("#eab308");
    expect(parsed.attachments[0].blocks[0].text.text).toBe("Changes requested");
  });

  it("CANCELLED → neutral bar with 'Review cancelled' header", () => {
    const parsed = parse(envelopeFor("CANCELLED"));
    expect(parsed.attachments[0].color).toBe("#64748b");
    expect(parsed.attachments[0].blocks[0].text.text).toBe("Review cancelled");
  });

  it("title section uses entityUrl link and 'in <project>' line", () => {
    const blocks = blocksOf(envelopeFor("APPROVED"));
    expect(blocks[1].text.text).toBe(
      "*<http://app.example.com/projects/repository/1/42|Login flow>*\nin Acme"
    );
  });

  it("renders decider + requester identity line", () => {
    const blocks = blocksOf(envelopeFor("APPROVED"));
    expect(blocks[2].text.text).toBe("Decided by *Bob* for *Alice*");
  });

  it("renders decisionComment when present", () => {
    const blocks = blocksOf(envelopeFor("APPROVED"));
    const comment = blocks.find(
      (b) => b.type === "section" && b.text?.text === "Looks good."
    );
    expect(comment).toBeDefined();
  });

  it("omits divider when decisionComment is null", () => {
    const blocks = blocksOf(envelopeFor("APPROVED", { decisionComment: null }));
    expect(blocks.find((b) => b.type === "divider")).toBeUndefined();
  });

  it("renders target state line when toStateName present", () => {
    const blocks = blocksOf(envelopeFor("APPROVED"));
    const stateLine = blocks.find((b) =>
      String(b.text?.text ?? "").includes("Target state")
    );
    expect(stateLine?.text.text).toBe("*Target state:* Ready");
  });

  it("top-level text preview includes the header verb and entity name", () => {
    const parsed = parse(envelopeFor("APPROVED"));
    expect(parsed.text).toBe("Review approved: Login flow");
  });
});
