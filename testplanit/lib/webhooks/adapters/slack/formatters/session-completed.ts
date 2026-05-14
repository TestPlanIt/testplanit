import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { toHumanReadable } from "~/utils/duration";
import {
  buildBody,
  COLOR_GREEN,
  COLOR_RED,
  COLOR_YELLOW,
  emojiForStatus,
  projectNameOf,
  titleAndProject,
  url,
} from "./_shared";

/**
 * Session.completed payload — mirrors what `SessionResultsSummary` renders
 * in-app: results (NOT cases), per-result status counts, total elapsed.
 * Sessions don't have a completion percent (exploratory testing has no
 * fixed "done at N cases" target), so we don't render one.
 */
interface SessionCompletedData {
  sessionId: number;
  sessionTitle?: string;
  /** Legacy field kept for back-compat with older payloads. */
  sessionName?: string;
  projectId: number;
  totalResults?: number;
  /** Sum of result.elapsed in SECONDS. */
  totalElapsed?: number | null;
  statusCounts?: Array<{
    statusId: number | null;
    statusName: string;
    colorValue?: string | null;
    count: number;
    isCompleted?: boolean;
    isSuccess?: boolean;
    isFailure?: boolean;
  }>;
}

/**
 * Color rule for a session: any failure → red; all-passed → green; mixed
 * with non-pass non-fail → yellow. Computed from result statuses.
 */
function colorForSession(
  statusCounts: SessionCompletedData["statusCounts"] = []
): string {
  let hasFailure = false;
  let hasNonPass = false;
  for (const sc of statusCounts) {
    if (sc.count <= 0) continue;
    if (sc.isFailure) hasFailure = true;
    else if (!sc.isSuccess) hasNonPass = true;
  }
  if (hasFailure) return COLOR_RED;
  if (hasNonPass) return COLOR_YELLOW;
  return COLOR_GREEN;
}

export function formatSessionCompletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as SessionCompletedData;
  const sessionTitle =
    data.sessionTitle ?? data.sessionName ?? "(unnamed session)";
  const totalResults = data.totalResults ?? 0;
  const elapsedSeconds = data.totalElapsed ?? 0;
  const elapsedDisplay =
    elapsedSeconds > 0
      ? toHumanReadable(elapsedSeconds, { isSeconds: true })
      : null;
  const statusCounts = (data.statusCounts ?? []).filter((sc) => sc.count > 0);

  // Summary line: "N results · 12 minutes". When the session has zero
  // recorded results we still emit the header + title and skip the
  // summary line entirely.
  const summaryParts: string[] = [];
  if (totalResults > 0) {
    summaryParts.push(
      `${totalResults} ${totalResults === 1 ? "result" : "results"}`
    );
  }
  if (elapsedDisplay) summaryParts.push(elapsedDisplay);
  const summaryLine = summaryParts.length > 0 ? summaryParts.join(" · ") : null;

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

  if (summaryLine) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: summaryLine },
    });
  }

  // Status breakdown — same per-row pattern as test_run.completed.
  if (statusCounts.length > 0) {
    const statusLines = statusCounts
      .slice(0, 10)
      .map((sc) => `${emojiForStatus(sc)} *${sc.statusName}:* ${sc.count}`)
      .join("\n");
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: statusLines },
    });
  }

  return buildBody({
    text: `Session completed: ${sessionTitle}`,
    color: colorForSession(statusCounts),
    blocks,
  });
}
