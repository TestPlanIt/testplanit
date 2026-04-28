import { toHumanReadable } from "~/utils/duration";
import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

/**
 * D-15 — `test_run.completed` payload locked to TestRunSummaryData.
 * The Slack formatter only renders a stable subset; consumers of the
 * generic-HMAC adapter receive the full payload.
 */
interface TestRunCompletedData {
  runId: number;
  runTitle: string;
  /** Deep-link to the run in the TestPlanIt UI; rendered as a markdown link in Slack. */
  runUrl?: string;
  totalCases: number;
  /** 0..100 percentage (matches getTestRunSummary output and the in-app summary route). */
  completionRate: number;
  statusCounts?: Array<{
    statusId: number | null;
    statusName: string;
    colorValue: string;
    count: number;
    isCompleted?: boolean;
    isSuccess?: boolean;
    isFailure?: boolean;
  }>;
  totalElapsed?: number | null;
}

/**
 * Slack section.fields renders as a 2-column grid; an even count keeps the
 * grid clean. We cap at 6 to reserve room for an "and N more" footer if
 * ever needed (current product has ~5 status types in practice).
 */
const SLACK_MAX_STATUS_FIELDS = 6;

/** Pick a Slack `:emoji:` for a COMPLETED status row using the Status table flags. */
function emojiForCompletedStatus(sc: {
  isSuccess?: boolean;
  isFailure?: boolean;
}): string {
  if (sc.isSuccess) return ":white_check_mark:";
  if (sc.isFailure) return ":x:";
  // Completed but neither success nor failure (e.g. Skipped).
  return ":heavy_minus_sign:";
}

/**
 * D-17 — Slack formatter for `test_run.completed`. Produces both `text`
 * (single-line notification preview / legacy fallback) and `blocks` (Block
 * Kit rich rendering with hierarchy: header → run title → summary line →
 * divider → status breakdown → footer).
 */
export function formatTestRunCompletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as TestRunCompletedData;
  const completionPct = Math.round(data.completionRate ?? 0);
  const elapsedSeconds = data.totalElapsed ?? 0;
  const elapsedDisplay =
    elapsedSeconds > 0
      ? toHumanReadable(elapsedSeconds, { isSeconds: true })
      : null;

  const text = `Test run "${data.runTitle}" completed (${completionPct}% complete, ${data.totalCases} cases)`;

  // Run-title line: bold, clickable when runUrl present, with project as
  // smaller secondary text on a second line ("in <project>").
  const runLine = data.runUrl
    ? `*<${data.runUrl}|${data.runTitle}>*`
    : `*${data.runTitle}*`;
  const runWithProject = `${runLine}\nin ${envelope.projectName}`;

  // Summary line: "*32% complete* · 19 cases · 10m 55s" — completion gets
  // bold emphasis since it answers "how done?" at a glance.
  const summaryParts: string[] = [
    `*${completionPct}% complete*`,
    `${data.totalCases} ${data.totalCases === 1 ? "case" : "cases"}`,
  ];
  if (elapsedDisplay) summaryParts.push(elapsedDisplay);
  const summaryLine = summaryParts.join(" · ");

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: ":white_check_mark: Test run completed",
        emoji: true,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: runWithProject } },
    { type: "section", text: { type: "mrkdwn", text: summaryLine } },
  ];

  // Status breakdown — split into two buckets:
  //   - Completed statuses (isCompleted=true): one row each, emoji from
  //     isSuccess/isFailure flags.
  //   - Non-completed statuses (isCompleted=false OR null/undefined):
  //     aggregated into a single ":hourglass: Pending" row. This collapses
  //     retest/blocked/untested/etc. into one "still to do" tally so admins
  //     don't see a fragmented list of pending sub-states.
  const statusCounts = data.statusCounts ?? [];
  const completedRows = statusCounts.filter((sc) => sc.isCompleted === true);
  const pendingTotal = statusCounts
    .filter((sc) => sc.isCompleted !== true)
    .reduce((sum, sc) => sum + sc.count, 0);

  const statusFields: Array<{ type: "mrkdwn"; text: string }> = completedRows
    .slice(0, SLACK_MAX_STATUS_FIELDS)
    .map((sc) => ({
      type: "mrkdwn" as const,
      text: `${emojiForCompletedStatus(sc)} *${sc.statusName}:*\n${sc.count}`,
    }));
  if (pendingTotal > 0 && statusFields.length < SLACK_MAX_STATUS_FIELDS) {
    statusFields.push({
      type: "mrkdwn",
      text: `:hourglass_flowing_sand: *Pending:*\n${pendingTotal}`,
    });
  }

  if (statusFields.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", fields: statusFields });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `\`${envelope.eventId}\` · ${envelope.eventTimestamp}`,
      },
    ],
  });

  return {
    body: JSON.stringify({ text, blocks }),
    contentType: "application/json",
  };
}
