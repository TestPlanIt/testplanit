import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

/**
 * D-15 — `test_run.completed` payload locked to TestRunSummaryData.
 * The Slack formatter only renders a stable subset; consumers of the
 * generic-HMAC adapter receive the full payload.
 */
interface TestRunCompletedData {
  runId: number;
  runTitle: string;
  totalCases: number;
  /** 0..1 fraction; rendered as a percentage. */
  completionRate: number;
  statusCounts?: Array<{
    statusId: number | null;
    statusName: string;
    colorValue: string;
    count: number;
    isCompleted?: boolean;
  }>;
  totalElapsed?: number | null;
}

/** Slack permits at most ~10 elements in a section's `fields`; we cap at 8 for legibility. */
const SLACK_MAX_FIELDS = 8;

/**
 * D-17 — Slack formatter for `test_run.completed`. Produces both `text`
 * (single-line notification preview / legacy fallback) and `blocks` (Block
 * Kit rich rendering).
 */
export function formatTestRunCompletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as TestRunCompletedData;
  const completionPct = Math.round((data.completionRate ?? 0) * 100);
  const text = `Test run "${data.runTitle}" completed (${completionPct}% complete, ${data.totalCases} cases)`;

  const statusCounts = data.statusCounts ?? [];
  const statusFields = statusCounts.slice(0, SLACK_MAX_FIELDS).map((sc) => ({
    type: "mrkdwn" as const,
    text: `*${sc.statusName}:*\n${sc.count}`,
  }));

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Test run completed", emoji: false },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Run:*\n${data.runTitle}` },
        { type: "mrkdwn", text: `*Project:*\n${envelope.projectName}` },
        { type: "mrkdwn", text: `*Cases:*\n${data.totalCases}` },
        { type: "mrkdwn", text: `*Completion:*\n${completionPct}%` },
      ],
    },
  ];

  // Per-status breakdown — only emit the section when there is at least one
  // entry (Slack rejects empty `fields` arrays).
  if (statusFields.length > 0) {
    blocks.push({ type: "section", fields: statusFields });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `eventId: \`${envelope.eventId}\` · ${envelope.eventTimestamp}`,
      },
    ],
  });

  return {
    body: JSON.stringify({ text, blocks }),
    contentType: "application/json",
  };
}
