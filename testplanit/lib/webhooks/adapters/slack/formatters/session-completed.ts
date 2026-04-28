import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { aggregateRunCounts } from "~/lib/services/testRunSummary-shared";
import {
  buildBody,
  colorForOutcome,
  emojiForStatus,
  projectNameOf,
  titleAndProject,
  url,
} from "./_shared";

/**
 * Session.completed payload mirrors test_run.completed where data exists.
 * The Phase 2 emitter ships a minimal payload (no getSessionSummary
 * equivalent yet — flagged in 02-CONTEXT for follow-up). statusCounts
 * may be absent; we render gracefully in that case.
 */
interface SessionCompletedData {
  sessionId: number;
  sessionName?: string;
  sessionTitle?: string; // legacy field name from earlier emitter draft
  projectId: number;
  totalCases?: number;
  statusCounts?: Array<{
    statusId: number | null;
    statusName: string;
    colorValue: string;
    count: number;
    isCompleted?: boolean;
    isSuccess?: boolean;
    isFailure?: boolean;
  }>;
}

export function formatSessionCompletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as SessionCompletedData;
  const sessionTitle = data.sessionName ?? data.sessionTitle ?? "(unnamed session)";
  const totalCases = data.totalCases ?? 0;
  const statusCounts = data.statusCounts ?? [];
  const { failed, pending, completionPct } = aggregateRunCounts({
    totalCases,
    statusCounts,
  });

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Session completed", emoji: false },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: titleAndProject(
          sessionTitle,
          projectNameOf(envelope),
          url.session(data.projectId, data.sessionId)
        ),
      },
    },
  ];

  // Summary line — only when totalCases is present and meaningful.
  if (totalCases > 0) {
    const caseLabel = totalCases === 1 ? "case" : "cases";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${completionPct}% complete* · ${totalCases} ${caseLabel}`,
      },
    });
  }

  // Status breakdown — same per-row pattern as test_run.completed.
  const filledRows = statusCounts.filter((sc) => sc.count > 0);
  if (filledRows.length > 0) {
    const statusLines = filledRows
      .slice(0, 10)
      .map((sc) => `${emojiForStatus(sc)} *${sc.statusName}:* ${sc.count}`)
      .join("\n");
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: statusLines } });
  }

  return buildBody({
    text: `Session completed: ${sessionTitle}`,
    color: colorForOutcome({ failed, pending, completionPct }),
    blocks,
  });
}

