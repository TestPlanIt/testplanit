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
    completionRate: 95.83,
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

describe("formatTestRunCompletedBlocks", () => {
  it("returns body string + JSON content type", () => {
    const out = formatTestRunCompletedBlocks(baseEnvelope);
    expect(typeof out.body).toBe("string");
    expect(out.contentType).toBe("application/json");
  });

  it("body parses to {text, blocks}", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    expect(parsed).toHaveProperty("text");
    expect(parsed).toHaveProperty("blocks");
    expect(typeof parsed.text).toBe("string");
    expect(Array.isArray(parsed.blocks)).toBe(true);
  });

  it("text contains the runTitle and 'completed'", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    expect(parsed.text).toContain("Smoke v3");
    expect(parsed.text.toLowerCase()).toContain("completed");
  });

  it("first block is a header carrying the success emoji + 'Test run completed'", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    expect(parsed.blocks[0]).toMatchObject({
      type: "header",
      text: {
        type: "plain_text",
        text: ":white_check_mark: Test run completed",
        emoji: true,
      },
    });
  });

  it("run line uses bold + clickable link, project rendered as 'in <project>' below", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    const runSection = parsed.blocks[1];
    expect(runSection.type).toBe("section");
    expect(runSection.text.type).toBe("mrkdwn");
    expect(runSection.text.text).toBe(
      "*<http://localhost:3000/projects/runs/1/42|Smoke v3>*\nin Acme"
    );
  });

  it("summary line collapses completion + cases + elapsed into a single mrkdwn section", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    const summarySection = parsed.blocks[2];
    expect(summarySection.type).toBe("section");
    expect(summarySection.text.text).toBe("*96% complete* · 24 cases · 10 minutes");
  });

  it("status breakdown is preceded by a divider for visual separation", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    const blocks = parsed.blocks as Array<Record<string, unknown>>;
    const dividerIndex = blocks.findIndex((b) => b.type === "divider");
    expect(dividerIndex).toBeGreaterThan(0);
    // The block immediately following the divider must be the status fields section.
    const fieldsAfter = blocks[dividerIndex + 1];
    expect(fieldsAfter.type).toBe("section");
    expect(Array.isArray(fieldsAfter.fields)).toBe(true);
  });

  it("status fields use isSuccess/isFailure flags to pick emojis (not statusName)", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    const rendered = JSON.stringify(parsed);
    // Passed row tagged isSuccess=true → :white_check_mark:
    expect(rendered).toContain(":white_check_mark: *Passed:*");
    // Failed row tagged isFailure=true → :x:
    expect(rendered).toContain(":x: *Failed:*");
  });

  it("non-completed statuses (Retest/Blocked/Pending) aggregate into a single 'Pending' row with summed count", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        statusCounts: [
          {
            statusId: 1,
            statusName: "Passed",
            colorValue: "#0f0",
            count: 10,
            isCompleted: true,
            isSuccess: true,
          },
          {
            statusId: 2,
            statusName: "Retest",
            colorValue: "#fa0",
            count: 3,
            isCompleted: false,
          },
          {
            statusId: 3,
            statusName: "Blocked",
            colorValue: "#888",
            count: 2,
            isCompleted: false,
          },
          {
            statusId: null,
            statusName: "Pending",
            colorValue: "#aaa",
            count: 8,
            // isCompleted absent → treated as not-completed
          },
        ],
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    // Single aggregated Pending row with count 3+2+8 = 13
    expect(rendered).toContain(":hourglass_flowing_sand: *Pending:*\\n13");
    // Individual non-completed status names should NOT appear as their own rows
    expect(rendered).not.toContain("*Retest:*");
    expect(rendered).not.toContain("*Blocked:*");
    // Only one hourglass appears (the aggregate row), not three
    const hourglassCount = (rendered.match(/:hourglass_flowing_sand:/g) || [])
      .length;
    expect(hourglassCount).toBe(1);
  });

  it("non-completed statusCount with count=0 is excluded (no 'Pending: 0' noise)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
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
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).not.toContain("*Pending:*");
  });

  it("completed-but-neither-success-nor-failure status (e.g. Skipped) renders neutral emoji", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        statusCounts: [
          {
            statusId: 4,
            statusName: "Skipped",
            colorValue: "#aaa",
            count: 3,
            isCompleted: true,
            isSuccess: false,
            isFailure: false,
          },
        ],
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).toContain(":heavy_minus_sign: *Skipped:*");
  });

  it("statusCounts = [] omits the divider AND the status fields section", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        statusCounts: [],
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const blocks = parsed.blocks as Array<Record<string, unknown>>;
    expect(blocks.find((b) => b.type === "divider")).toBeUndefined();
    for (const block of blocks) {
      if (Array.isArray(block.fields)) {
        expect((block.fields as unknown[]).length).toBeGreaterThan(0);
      }
    }
  });

  it("completionRate of 98.7 renders as '99%' (regression guard against 8000% bug)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        completionRate: 98.7,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).toContain("99% complete");
    expect(rendered).not.toContain("9870%");
  });

  it("completionRate of 80 renders as '80% complete' (regression guard against 8000%)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        completionRate: 80,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).toContain("80% complete");
    expect(rendered).not.toContain("8000%");
  });

  it("totalElapsed > 0 renders into the inline summary line via toHumanReadable", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    const summarySection = parsed.blocks[2];
    expect(summarySection.text.text).toContain("10 minutes");
  });

  it("totalElapsed = 0 omits elapsed from the summary line entirely", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalElapsed: 0,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const summarySection = parsed.blocks[2];
    expect(summarySection.text.text).not.toContain("0 seconds");
    expect(summarySection.text.text).not.toContain("minutes");
    expect(summarySection.text.text).toBe("*96% complete* · 24 cases");
  });

  it("missing runUrl falls back to plain bold runTitle (no broken <|...> link)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        runUrl: undefined,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const runSection = parsed.blocks[1];
    expect(runSection.text.text).toBe("*Smoke v3*\nin Acme");
    expect(runSection.text.text).not.toMatch(/<\|/);
  });

  it("singular 'case' for totalCases=1, plural 'cases' otherwise", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalCases: 1,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    expect(parsed.blocks[2].text.text).toContain("1 case");
    expect(parsed.blocks[2].text.text).not.toContain("1 cases");
  });

  it("statusCounts with 12 items truncates to 6 fields (cap for legibility)", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      statusId: i + 1,
      statusName: `Status${i + 1}`,
      colorValue: "#888",
      count: i + 1,
      isCompleted: true,
    }));
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        statusCounts: many,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const fieldsBlocks = (parsed.blocks as Array<Record<string, unknown>>).filter(
      (b) => Array.isArray(b.fields)
    );
    const statusFieldsBlock = fieldsBlocks[fieldsBlocks.length - 1];
    expect((statusFieldsBlock.fields as unknown[]).length).toBe(6);
  });

  it("footer context shows eventId in monospace + ISO timestamp; no 'eventId:' label", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    const blocks = parsed.blocks as Array<Record<string, unknown>>;
    const context = blocks[blocks.length - 1] as any;
    expect(context.type).toBe("context");
    expect(context.elements[0].text).toBe(
      "`evt_00000000-0000-4000-8000-000000000000` · 2026-04-27T12:00:00.000Z"
    );
  });
});
