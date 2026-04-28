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
 * Hex colors for the Slack attachment left-edge bar. Picked to read well
 * on both light and dark Slack themes.
 *   - GREEN  "#22c55e": run finished 100% with zero failures (all passed)
 *   - RED    "#ef4444": at least one failure (regardless of completion)
 *   - YELLOW "#eab308": no failures but not yet 100% complete (pending)
 */
const COLOR_GREEN = "#22c55e";
const COLOR_RED = "#ef4444";
const COLOR_YELLOW = "#eab308";

function colorForOutcome(args: {
  failed: number;
  pending: number;
  completionPct: number;
}): string {
  if (args.failed > 0) return COLOR_RED;
  if (args.pending > 0 || args.completionPct < 100) return COLOR_YELLOW;
  return COLOR_GREEN;
}

/**
 * Pick a Slack `:emoji:` for a status row using the Status table flags.
 * Matches the schema's semantics so admin-renamed statuses still get the
 * right marker (e.g. a custom "All Good" status with isSuccess=true gets
 * the green check; a "Skipped" with isCompleted=true but neither flag
 * gets the neutral marker).
 */
function emojiForStatus(sc: {
  isSuccess?: boolean;
  isFailure?: boolean;
  isCompleted?: boolean;
}): string {
  if (sc.isSuccess) return ":white_check_mark:";
  if (sc.isFailure) return ":x:";
  if (sc.isCompleted === false || sc.isCompleted === undefined) {
    return ":hourglass_flowing_sand:";
  }
  // isCompleted=true but neither success nor failure (e.g. Skipped).
  return ":heavy_minus_sign:";
}

/**
 * D-17 — Slack formatter for `test_run.completed`. Produces both `text`
 * (single-line notification preview / legacy fallback) and `attachments`
 * with `blocks` inside (so the message gets a left-edge color bar that
 * signals pass/fail/pending at a glance — green/red/yellow).
 *
 * Layout: header → run title + project → completion summary → divider →
 * Passed/Failed/Pending breakdown → footer (eventId + timestamp).
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
  const color = colorForOutcome({ failed, pending, completionPct });

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
        text: "Test run completed",
        emoji: false,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: runWithProject } },
    { type: "section", text: { type: "mrkdwn", text: summaryLine } },
  ];

  // Status breakdown — render each statusCount as its own row (matches
  // the in-app TestRunCasesSummary, which iterates statusCounts and
  // shows admin-defined status names directly). Emoji is picked from the
  // Status row's isSuccess / isFailure / isCompleted flags so we don't
  // hardcode names. Cap at 8 rows for legibility (Slack's section.fields
  // grid maxes at 10).
  const statusCounts = (data.statusCounts ?? []).filter((sc) => sc.count > 0);
  const statusFields = statusCounts.slice(0, 8).map((sc) => ({
    type: "mrkdwn" as const,
    text: `${emojiForStatus(sc)} *${sc.statusName}:*\n${sc.count}`,
  }));

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

  // Wrap in `attachments` (not top-level `blocks`) so Slack renders the
  // colored left-edge bar. `text` is duplicated at the top level for the
  // notification preview / legacy fallback.
  return {
    body: JSON.stringify({
      text,
      attachments: [{ color, blocks }],
    }),
    contentType: "application/json",
  };
}
