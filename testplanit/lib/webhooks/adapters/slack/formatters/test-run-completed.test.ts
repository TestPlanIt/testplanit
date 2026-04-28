import { describe, expect, it } from "vitest";
import type { OutboundEnvelope } from "../../types";
import { formatTestRunCompletedBlocks } from "./test-run-completed";

const baseEnvelope: OutboundEnvelope = {
  eventId: "evt_00000000-0000-4000-8000-000000000000",
  eventName: "test_run.completed",
  eventTimestamp: "2026-04-27T12:00:00.000Z",
  tenantId: "test-tenant",
  projectId: 1,
  projectName: "Acme",
  actorUserId: "user-1",
  data: {
    runId: 42,
    runTitle: "Smoke v3",
    runUrl: "http://localhost:3000/projects/runs/1/42",
    totalCases: 24,
    statusCounts: [
      {
        statusId: 1,
        statusName: "Passed",
        colorValue: "#0f0",
        count: 22,
        isCompleted: true,
        isSuccess: true,
        isFailure: false,
      },
      {
        statusId: 2,
        statusName: "Failed",
        colorValue: "#f00",
        count: 2,
        isCompleted: true,
        isSuccess: false,
        isFailure: true,
      },
    ],
    totalElapsed: 600,
  },
};

/** Helper: pull blocks out of the attachment wrapper. */
function getBlocks(envelope: OutboundEnvelope) {
  const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
  return parsed.attachments[0].blocks as Array<Record<string, any>>;
}

function getColor(envelope: OutboundEnvelope) {
  const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
  return parsed.attachments[0].color as string;
}

describe("formatTestRunCompletedBlocks", () => {
  it("returns body string + JSON content type", () => {
    const out = formatTestRunCompletedBlocks(baseEnvelope);
    expect(typeof out.body).toBe("string");
    expect(out.contentType).toBe("application/json");
  });

  it("body wraps blocks inside attachments[0] (so Slack renders a left-edge color bar)", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    expect(parsed).toHaveProperty("text");
    expect(parsed).toHaveProperty("attachments");
    expect(Array.isArray(parsed.attachments)).toBe(true);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toHaveProperty("color");
    expect(parsed.attachments[0]).toHaveProperty("blocks");
    expect(Array.isArray(parsed.attachments[0].blocks)).toBe(true);
    // Top-level `blocks` MUST NOT exist — would cause Slack to render twice.
    expect(parsed).not.toHaveProperty("blocks");
  });

  it("header is plain 'Test run completed' (no green checkmark — color bar carries the visual signal)", () => {
    const blocks = getBlocks(baseEnvelope);
    expect(blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "Test run completed", emoji: false },
    });
    // Regression: previously the header used :white_check_mark: which was
    // misleading when the run had failures or pending cases.
    expect(blocks[0].text.text).not.toContain(":white_check_mark:");
  });

  it("color = GREEN (#22c55e) when run is 100% complete with zero failures", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 5,
        statusCounts: [
          {
            statusId: 1,
            statusName: "Passed",
            colorValue: "#0f0",
            count: 5,
            isCompleted: true,
            isSuccess: true,
          },
        ],
      },
    };
    expect(getColor(envelope)).toBe("#22c55e");
  });

  it("color = RED (#ef4444) when there is at least one failure (even if 100% complete)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 24,
        statusCounts: [
          {
            statusId: 1,
            statusName: "Passed",
            colorValue: "#0f0",
            count: 22,
            isCompleted: true,
            isSuccess: true,
          },
          {
            statusId: 2,
            statusName: "Failed",
            colorValue: "#f00",
            count: 2,
            isCompleted: true,
            isFailure: true,
          },
        ],
      },
    };
    expect(getColor(envelope)).toBe("#ef4444");
  });

  it("color = RED even when there are also pending cases (failure dominates)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 10,
        statusCounts: [
          {
            statusId: 1,
            statusName: "Passed",
            colorValue: "#0f0",
            count: 4,
            isCompleted: true,
            isSuccess: true,
          },
          {
            statusId: 2,
            statusName: "Failed",
            colorValue: "#f00",
            count: 1,
            isCompleted: true,
            isFailure: true,
          },
          {
            statusId: 3,
            statusName: "Pending",
            colorValue: "#aaa",
            count: 5,
          },
        ],
      },
    };
    expect(getColor(envelope)).toBe("#ef4444");
  });

  it("color = YELLOW (#eab308) when there are no failures but not 100% complete", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 20,
        statusCounts: [
          {
            statusId: 1,
            statusName: "Passed",
            colorValue: "#0f0",
            count: 6,
            isCompleted: true,
            isSuccess: true,
          },
          {
            statusId: 3,
            statusName: "Pending",
            colorValue: "#aaa",
            count: 14,
          },
        ],
      },
    };
    expect(getColor(envelope)).toBe("#eab308");
  });

  it("run line uses bold + clickable link, project rendered as 'in <project>' below", () => {
    const blocks = getBlocks(baseEnvelope);
    expect(blocks[1].text.text).toBe(
      "*<http://localhost:3000/projects/runs/1/42|Smoke v3>*\nin Acme"
    );
  });

  it("summary line collapses completion + cases + elapsed (24 cases all completed → 100%)", () => {
    const blocks = getBlocks(baseEnvelope);
    expect(blocks[2].text.text).toBe(
      "*100% complete* · 24 cases · 10 minutes"
    );
  });

  it("renders each status row individually with admin-defined names (matches in-app TestRunCasesSummary)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 38,
        statusCounts: [
          {
            statusId: 1,
            statusName: "Passed",
            colorValue: "#0f0",
            count: 5,
            isCompleted: true,
            isSuccess: true,
          },
          {
            statusId: 2,
            statusName: "Failed",
            colorValue: "#f00",
            count: 1,
            isCompleted: true,
            isFailure: true,
          },
          {
            statusId: 3,
            statusName: "Skipped",
            colorValue: "#aaa",
            count: 6,
            isCompleted: true,
          },
          {
            statusId: 4,
            statusName: "Retest",
            colorValue: "#fa0",
            count: 3,
            isCompleted: false,
          },
          {
            statusId: 5,
            statusName: "Blocked",
            colorValue: "#888",
            count: 2,
            isCompleted: false,
          },
          {
            statusId: null,
            statusName: "Pending",
            colorValue: "#aaa",
            count: 21,
          },
        ],
      },
    };
    const rendered = JSON.stringify(getBlocks(envelope));
    expect(rendered).toContain(":white_check_mark: *Passed:* 5");
    expect(rendered).toContain(":x: *Failed:* 1");
    expect(rendered).toContain(":fast_forward: *Skipped:* 6");
    expect(rendered).toContain(":hourglass_flowing_sand: *Retest:* 3");
    expect(rendered).toContain(":hourglass_flowing_sand: *Blocked:* 2");
    expect(rendered).toContain(":hourglass_flowing_sand: *Pending:* 21");
    // completionPct still reflects isCompleted-based completion:
    // completed = 5 + 1 + 6 = 12 → 12/38 = 31.6% → 32%.
    expect(rendered).toContain("*32% complete*");
  });

  it("MS Test 4 shape — 2 Passed, 1 Failed, 1 Skipped (the user's reported example) renders all three statuses", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 4,
        statusCounts: [
          {
            statusId: 2,
            statusName: "Passed",
            colorValue: "#2A843F",
            count: 2,
            isCompleted: true,
            isSuccess: true,
          },
          {
            statusId: 3,
            statusName: "Failed",
            colorValue: "#F44B25",
            count: 1,
            isCompleted: true,
            isFailure: true,
          },
          {
            statusId: 6,
            statusName: "Skipped",
            colorValue: "#786AC8",
            count: 1,
            isCompleted: true,
          },
        ],
      },
    };
    const rendered = JSON.stringify(getBlocks(envelope));
    expect(rendered).toContain(":white_check_mark: *Passed:* 2");
    expect(rendered).toContain(":x: *Failed:* 1");
    expect(rendered).toContain(":fast_forward: *Skipped:* 1");
    // Failure dominates → RED bar.
    expect(getColor(envelope)).toBe("#ef4444");
  });

  it("zero-count rows are filtered out (no 'Failed: 0' noise)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 5,
        statusCounts: [
          {
            statusId: 1,
            statusName: "Passed",
            colorValue: "#0f0",
            count: 5,
            isCompleted: true,
            isSuccess: true,
          },
          {
            statusId: 2,
            statusName: "Failed",
            colorValue: "#f00",
            count: 0,
            isCompleted: true,
            isFailure: true,
          },
        ],
      },
    };
    const rendered = JSON.stringify(getBlocks(envelope));
    expect(rendered).toContain(":white_check_mark: *Passed:*");
    expect(rendered).not.toContain("*Failed:*");
  });

  it("omits a status bucket entirely when its count is 0 (no 'Failed: 0' or 'Pending: 0')", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 5,
        statusCounts: [
          {
            statusId: 1,
            statusName: "Passed",
            colorValue: "#0f0",
            count: 5,
            isCompleted: true,
            isSuccess: true,
          },
        ],
      },
    };
    const rendered = JSON.stringify(getBlocks(envelope));
    expect(rendered).toContain(":white_check_mark: *Passed:*");
    expect(rendered).not.toContain("*Failed:*");
    expect(rendered).not.toContain("*Pending:*");
  });

  it("status breakdown is a single mrkdwn section (newline-joined rows, NOT a 2-col fields grid that would wrap)", () => {
    const blocks = getBlocks(baseEnvelope);
    const dividerIndex = blocks.findIndex((b) => b.type === "divider");
    expect(dividerIndex).toBeGreaterThan(0);
    const statusSection = blocks[dividerIndex + 1];
    expect(statusSection.type).toBe("section");
    expect(statusSection.text?.type).toBe("mrkdwn");
    expect(typeof statusSection.text?.text).toBe("string");
    // No `fields` array — that's what was wrapping counts onto two lines.
    expect(statusSection.fields).toBeUndefined();
    // Each row is on its own line, with count inline next to the label.
    expect(statusSection.text.text).toContain("\n");
  });

  it("statusCounts = [] omits the divider AND the status fields section", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 0,
        statusCounts: [],
      },
    };
    const blocks = getBlocks(envelope);
    expect(blocks.find((b) => b.type === "divider")).toBeUndefined();
    for (const block of blocks) {
      if (Array.isArray(block.fields)) {
        expect((block.fields as unknown[]).length).toBeGreaterThan(0);
      }
    }
  });

  it("8000% regression guard — completion derived from aggregateRunCounts", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 19,
        statusCounts: [
          {
            statusId: 1,
            statusName: "Passed",
            colorValue: "#0f0",
            count: 5,
            isCompleted: true,
            isSuccess: true,
          },
          {
            statusId: 2,
            statusName: "Failed",
            colorValue: "#f00",
            count: 1,
            isCompleted: true,
            isFailure: true,
          },
        ],
      },
    };
    const rendered = JSON.stringify(getBlocks(envelope));
    expect(rendered).toContain("32% complete");
    expect(rendered).not.toContain("3200%");
    expect(rendered).not.toContain("8000%");
  });

  it("totalElapsed > 0 renders into the inline summary line", () => {
    const blocks = getBlocks(baseEnvelope);
    expect(blocks[2].text.text).toContain("10 minutes");
  });

  it("totalElapsed = 0 omits elapsed from the summary line entirely", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalElapsed: 0,
      },
    };
    const blocks = getBlocks(envelope);
    expect(blocks[2].text.text).not.toContain("0 seconds");
    expect(blocks[2].text.text).not.toContain("minutes");
  });

  it("missing runUrl falls back to plain bold runTitle (no broken <|...> link)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        runUrl: undefined,
      },
    };
    const blocks = getBlocks(envelope);
    expect(blocks[1].text.text).toBe("*Smoke v3*\nin Acme");
    expect(blocks[1].text.text).not.toMatch(/<\|/);
  });

  it("singular 'case' for totalCases=1, plural 'cases' otherwise", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 1,
        statusCounts: [
          {
            statusId: 1,
            statusName: "Passed",
            colorValue: "#0f0",
            count: 1,
            isCompleted: true,
            isSuccess: true,
          },
        ],
      },
    };
    const blocks = getBlocks(envelope);
    expect(blocks[2].text.text).toContain("1 case");
    expect(blocks[2].text.text).not.toContain("1 cases");
  });

  it("footer context shows eventId in monospace + ISO timestamp; no 'eventId:' label", () => {
    const blocks = getBlocks(baseEnvelope);
    const context = blocks[blocks.length - 1] as any;
    expect(context.type).toBe("context");
    expect(context.elements[0].text).toBe(
      "`evt_00000000-0000-4000-8000-000000000000` · 2026-04-27T12:00:00.000Z"
    );
  });
});
