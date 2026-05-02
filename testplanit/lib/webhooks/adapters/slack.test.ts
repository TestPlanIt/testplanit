import { describe, expect, it } from "vitest";
import { SLACK_FORMATTERS } from "./slack/formatters";
import { slackAdapter } from "./slack";
import type { OutboundEnvelope } from "./types";

const baseEnvelope: OutboundEnvelope = {
  eventId: "evt_00000000-0000-4000-8000-000000000000",
  eventName: "test_run.completed",
  eventTimestamp: "2026-04-27T12:00:00.000Z",
  tenantId: "test-tenant",
  projectId: 1,
  projectName: "Test Project",
  actorUserId: "user-1",
  data: {},
};

const eventDataFixtures: Record<string, Record<string, unknown>> = {
  "test_run.completed": {
    runId: 1,
    runTitle: "Smoke",
    totalCases: 10,
    completionRate: 0.9,
    statusCounts: [
      {
        statusId: 1,
        statusName: "Pass",
        colorValue: "#0f0",
        count: 9,
        isCompleted: true,
      },
      {
        statusId: 2,
        statusName: "Fail",
        colorValue: "#f00",
        count: 1,
        isCompleted: true,
      },
    ],
  },
  "test_run.state_changed": {
    runId: 1,
    runTitle: "Smoke",
    from: { stateId: 1, stateName: "In Progress", isCompleted: false },
    to: { stateId: 2, stateName: "Completed", isCompleted: true },
    isCompletedTransition: true,
  },
  "test_run.result_added": {
    runId: 1,
    runTitle: "Smoke",
    caseId: 5,
    caseTitle: "Login flow",
    resultId: 1,
    statusId: 1,
    statusName: "Pass",
    isCompleted: true,
    attempt: 1,
  },
  "test_run.duplicated": {
    newRunId: 2,
    sourceRunId: 1,
    runTitle: "Smoke (copy)",
  },
  "session.completed": {
    sessionId: 1,
    sessionTitle: "Exploratory",
    totalCases: 5,
  },
  "issue.created": { id: 1, title: "Crash on login", severity: "high" },
  "issue.updated": {
    id: 1,
    title: "Crash on login",
    diff: {
      changedFields: ["status"],
      before: { status: "Open" },
      after: { status: "In Progress" },
    },
  },
  "case.created": {
    id: 1,
    title: "Login flow",
    description: "Verify login...",
  },
  "webhook.test": {
    source: "TestPlanIt",
    message: "Webhook pipeline is healthy",
  },
};

function envelopeFor(eventName: string): OutboundEnvelope {
  return {
    ...baseEnvelope,
    eventName,
    data: eventDataFixtures[eventName] ?? {},
  };
}

describe("slackAdapter", () => {
  it("has adapterType=SLACK", () => {
    expect(slackAdapter.adapterType).toBe("SLACK");
  });

  it("does NOT define a sign function (URL is the credential)", () => {
    expect(slackAdapter.sign).toBeUndefined();
  });

  it("formats a known event into Block Kit JSON (test_run.completed wraps blocks in attachments for the color bar)", () => {
    const out = slackAdapter.format(envelopeFor("test_run.completed"));
    expect(out.contentType).toBe("application/json");
    const parsed = JSON.parse(out.body) as Record<string, any>;
    expect(parsed).toHaveProperty("text");
    expect(typeof parsed.text).toBe("string");
    expect(Array.isArray(parsed.attachments)).toBe(true);
    expect(parsed.attachments).toHaveLength(1);
    expect(Array.isArray(parsed.attachments[0].blocks)).toBe(true);
    expect(typeof parsed.attachments[0].color).toBe("string");
  });

  it("falls through to the generic formatter for unknown event names", () => {
    const out = slackAdapter.format({
      ...baseEnvelope,
      eventName: "test_run.future_unknown",
      data: { hint: "future event added in a later phase" },
    });
    const parsed = JSON.parse(out.body) as Record<string, unknown>;
    expect(typeof parsed.text).toBe("string");
    expect((parsed.text as string).length).toBeGreaterThan(0);
    expect(Array.isArray(parsed.blocks)).toBe(true);
    expect((parsed.blocks as unknown[]).length).toBeGreaterThan(0);
  });

  // Smoke-test every registered formatter — catches a broken contract in any
  // formatter without a dedicated test file. Formatters MAY put blocks at the
  // top level OR inside an attachment (used by test_run.completed for the
  // colored left-edge bar). Accept either shape.
  describe("smoke-test for every registered formatter", () => {
    for (const eventName of Object.keys(SLACK_FORMATTERS)) {
      it(`produces valid Block Kit for ${eventName}`, () => {
        const out = slackAdapter.format(envelopeFor(eventName));
        expect(out.contentType).toBe("application/json");
        const parsed = JSON.parse(out.body) as Record<string, any>;
        expect(typeof parsed.text).toBe("string");
        expect((parsed.text as string).length).toBeGreaterThan(0);
        const blocks = Array.isArray(parsed.blocks)
          ? parsed.blocks
          : parsed.attachments?.[0]?.blocks;
        expect(Array.isArray(blocks)).toBe(true);
        expect(blocks.length).toBeGreaterThan(0);
      });
    }
  });
});
