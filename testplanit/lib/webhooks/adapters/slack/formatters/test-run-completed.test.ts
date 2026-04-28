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

describe("formatTestRunCompletedBlocks", () => {
  it("returns body string + JSON content type", () => {
    const out = formatTestRunCompletedBlocks(baseEnvelope);
    expect(typeof out.body).toBe("string");
    expect(out.contentType).toBe("application/json");
  });

  it("first block is a header with success emoji + 'Test run completed'", () => {
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
    expect(parsed.blocks[1].text.text).toBe(
      "*<http://localhost:3000/projects/runs/1/42|Smoke v3>*\nin Acme"
    );
  });

  it("summary line collapses completion + cases + elapsed (24 cases all completed → 100%)", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    expect(parsed.blocks[2].text.text).toBe(
      "*100% complete* · 24 cases · 10 minutes"
    );
  });

  it("derives Passed/Failed/Pending counts via the shared aggregateRunCounts helper (not from custom logic in the formatter)", () => {
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
            // isCompleted absent → counted as pending
          },
        ],
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    // Pending = 38 total - 12 completed (5+1+6) = 26 (Retest 3 + Blocked 2 + Pending 21)
    expect(rendered).toContain(":white_check_mark: *Passed:*\\n5");
    expect(rendered).toContain(":x: *Failed:*\\n1");
    expect(rendered).toContain(":hourglass_flowing_sand: *Pending:*\\n26");
    // Skipped (completed, neither success nor failure) is intentionally NOT
    // rendered as its own row — only the three canonical buckets are surfaced.
    expect(rendered).not.toContain("*Skipped:*");
    // Completion: 12 / 38 = 31.6% → rounds to 32%
    expect(rendered).toContain("*32% complete*");
  });

  it("omits a bucket entirely when its count is 0 (no 'Failed: 0' or 'Pending: 0')", () => {
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
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).toContain(":white_check_mark: *Passed:*");
    expect(rendered).not.toContain("*Failed:*");
    expect(rendered).not.toContain("*Pending:*");
  });

  it("status breakdown is preceded by a divider for visual separation", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    const blocks = parsed.blocks as Array<Record<string, unknown>>;
    const dividerIndex = blocks.findIndex((b) => b.type === "divider");
    expect(dividerIndex).toBeGreaterThan(0);
    const fieldsAfter = blocks[dividerIndex + 1];
    expect(fieldsAfter.type).toBe("section");
    expect(Array.isArray(fieldsAfter.fields)).toBe(true);
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
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const blocks = parsed.blocks as Array<Record<string, unknown>>;
    expect(blocks.find((b) => b.type === "divider")).toBeUndefined();
    for (const block of blocks) {
      if (Array.isArray(block.fields)) {
        expect((block.fields as unknown[]).length).toBeGreaterThan(0);
      }
    }
  });

  it("8000% regression guard — completion is derived from aggregateRunCounts, not multiplied", () => {
    // 19 cases, 6 completed → 32% (the user's reported run)
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
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).toContain("32% complete");
    expect(rendered).not.toContain("3200%");
    expect(rendered).not.toContain("8000%");
  });

  it("totalElapsed > 0 renders into the inline summary line via toHumanReadable", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    expect(parsed.blocks[2].text.text).toContain("10 minutes");
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
    expect(parsed.blocks[2].text.text).not.toContain("0 seconds");
    expect(parsed.blocks[2].text.text).not.toContain("minutes");
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
    expect(parsed.blocks[1].text.text).toBe("*Smoke v3*\nin Acme");
    expect(parsed.blocks[1].text.text).not.toMatch(/<\|/);
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
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    expect(parsed.blocks[2].text.text).toContain("1 case");
    expect(parsed.blocks[2].text.text).not.toContain("1 cases");
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
