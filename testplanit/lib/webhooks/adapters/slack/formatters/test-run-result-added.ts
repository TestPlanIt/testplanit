import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
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

interface TestRunResultAddedData {
  runId: number;
  runTitle: string;
  projectId: number;
  caseId: number | null;
  caseName: string | null;
  resultId: number;
  statusId: number | null;
  statusName: string | null;
  statusColor?: string | null;
  isCompleted?: boolean;
  isSuccess?: boolean;
  isFailure?: boolean;
  attempt?: number;
}

/**
 * `test_run.result_added` is volume-warned (per-case execution). Compact
 * format, color bar driven by the result's pass/fail flags so an admin
 * scanning a busy channel can see at a glance which results need attention.
 */
export function formatTestRunResultAddedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as TestRunResultAddedData;
  const statusName = data.statusName ?? "—";
  const caseName = data.caseName ?? `Case #${data.caseId ?? "?"}`;
  const attemptSuffix =
    data.attempt && data.attempt > 1 ? ` (attempt ${data.attempt})` : "";

  // Color bar = the result Status's own color when present (admin can
  // tune it per project), else fall back to the canonical green/red/
  // yellow rule using the schema flags so the bar still signals
  // pass/fail meaningfully.
  const color =
    data.statusColor ??
    (data.isSuccess ? COLOR_GREEN : data.isFailure ? COLOR_RED : COLOR_YELLOW);

  return buildBody({
    text: `Result: ${statusName} — ${caseName}`,
    color,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Test result added", emoji: false },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: titleAndProject(
            data.runTitle,
            projectNameOf(envelope),
            url.testRun(data.projectId, data.runId)
          ),
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emojiForStatus(data)} *${statusName}* — ${caseName}${attemptSuffix}`,
        },
      },
    ],
  });
}
