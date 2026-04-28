import {
  aggregateRunCounts,
  type TestRunSummaryData,
} from "~/lib/services/testRunSummary-shared";
import { toHumanReadable } from "~/utils/duration";
import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

/**
 * D-15 — `test_run.completed` payload locked to TestRunSummaryData. The
 * Slack formatter renders a stable subset; consumers of the generic-HMAC
 * adapter receive the full payload.
 *
 * Pass/Fail/Pending math comes from the shared `aggregateRunCounts`
 * helper (lib/services/testRunSummary.ts) so the in-app summary
 * component and this formatter never disagree on what "completed" means.
 */
interface TestRunCompletedData
  extends Pick<TestRunSummaryData, "statusCounts"> {
  runId: number;
  runTitle: string;
  /** Deep-link to the run in the TestPlanIt UI; rendered as a markdown link in Slack. */
  runUrl?: string;
  totalCases: number;
  /** 0..100 percentage from the in-app summary route; not used directly here (we derive). */
  completionRate?: number;
  totalElapsed?: number | null;
}

/**
 * D-17 — Slack formatter for `test_run.completed`. Produces both `text`
 * (single-line notification preview / legacy fallback) and `blocks` (Block
 * Kit rich rendering with hierarchy: header → run title → summary line →
 * divider → Passed/Failed/Pending breakdown → footer).
 */
export function formatTestRunCompletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as TestRunCompletedData;
  const { totalCases, passed, failed, pending, completionPct } =
    aggregateRunCounts({
      totalCases: data.totalCases,
      statusCounts: data.statusCounts ?? [],
    });
  const elapsedSeconds = data.totalElapsed ?? 0;
  const elapsedDisplay =
    elapsedSeconds > 0
      ? toHumanReadable(elapsedSeconds, { isSeconds: true })
      : null;

  const text = `Test run "${data.runTitle}" completed (${completionPct}% complete, ${totalCases} cases)`;

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
    `${totalCases} ${totalCases === 1 ? "case" : "cases"}`,
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

  // Status breakdown — three canonical buckets straight from
  // aggregateRunCounts. Skipped/blocked statuses (completed but neither
  // success nor failure) intentionally do not get their own row — the
  // demo target is "did the run pass?" not "exhaustive status taxonomy."
  // A row is omitted when its count is 0 so we never show "Failed: 0".
  const statusFields: Array<{ type: "mrkdwn"; text: string }> = [];
  if (passed > 0) {
    statusFields.push({
      type: "mrkdwn",
      text: `:white_check_mark: *Passed:*\n${passed}`,
    });
  }
  if (failed > 0) {
    statusFields.push({
      type: "mrkdwn",
      text: `:x: *Failed:*\n${failed}`,
    });
  }
  if (pending > 0) {
    statusFields.push({
      type: "mrkdwn",
      text: `:hourglass_flowing_sand: *Pending:*\n${pending}`,
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
