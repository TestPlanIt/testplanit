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
        statusName: "Pass",
        colorValue: "#0f0",
        count: 22,
        isCompleted: true,
      },
      {
        statusId: 2,
        statusName: "Fail",
        colorValue: "#f00",
        count: 2,
        isCompleted: true,
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

  it("first block is a header with text 'Test run completed'", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    expect(parsed.blocks[0]).toMatchObject({
      type: "header",
      text: { type: "plain_text", text: "Test run completed" },
    });
  });

  it("statusCounts with 0 items produces a valid block array (no empty fields arrays)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        statusCounts: [],
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    // Slack rejects empty `fields` arrays — assert no block has fields: []
    for (const block of parsed.blocks as Array<Record<string, unknown>>) {
      if (Array.isArray(block.fields)) {
        expect((block.fields as unknown[]).length).toBeGreaterThan(0);
      }
    }
  });

  it("completionRate of 98.7 renders as '99%' (rounded; service returns 0..100, formatter does not rescale)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        completionRate: 98.7,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).toContain("99%");
    // Regression guard: 8000% would be the symptom of a double-multiplication.
    expect(rendered).not.toContain("9870%");
  });

  it("completionRate of 80 renders as '80%' (regression guard against 8000% bug)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        completionRate: 80,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).toContain("80%");
    expect(rendered).not.toContain("8000%");
  });

  it("runUrl is rendered as a Slack mrkdwn link <url|runTitle> in the Run field", () => {
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).toContain(
      "<http://localhost:3000/projects/runs/1/42|Smoke v3>"
    );
  });

  it("totalElapsed > 0 renders an 'Elapsed' field via toHumanReadable (matches in-app summary render)", () => {
    // baseEnvelope has totalElapsed: 600 → 600 seconds = "10 minutes"
    const parsed = JSON.parse(formatTestRunCompletedBlocks(baseEnvelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).toContain("*Elapsed:*");
    expect(rendered).toContain("10 minutes");
  });

  it("totalElapsed = 0 omits the Elapsed field entirely (no 'Elapsed: 0 seconds')", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalElapsed: 0,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).not.toContain("*Elapsed:*");
    expect(rendered).not.toContain("0 seconds");
  });

  it("missing totalElapsed (undefined) omits the Elapsed field", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        totalElapsed: undefined,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).not.toContain("*Elapsed:*");
  });

  it("missing runUrl falls back to plain runTitle (no broken <|...> link)", () => {
    const envelope: OutboundEnvelope = {
      ...baseEnvelope,
      data: {
        ...(baseEnvelope.data as Record<string, unknown>),
        runUrl: undefined,
      },
    };
    const parsed = JSON.parse(formatTestRunCompletedBlocks(envelope).body);
    const rendered = JSON.stringify(parsed);
    expect(rendered).not.toMatch(/<\|/);
    expect(rendered).toContain("*Run:*\\nSmoke v3");
  });

  it("statusCounts with 12 items truncates to 8 fields (Slack limit)", () => {
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
    // Find the fields-bearing block dedicated to statusCounts (the LAST fields block)
    const fieldsBlocks = (parsed.blocks as Array<Record<string, unknown>>).filter(
      (b) => Array.isArray(b.fields)
    );
    const statusFieldsBlock = fieldsBlocks[fieldsBlocks.length - 1];
    expect(Array.isArray(statusFieldsBlock.fields)).toBe(true);
    expect((statusFieldsBlock.fields as unknown[]).length).toBeLessThanOrEqual(8);
    // The status block should be at most 8 entries
    expect((statusFieldsBlock.fields as unknown[]).length).toBe(8);
  });
});
