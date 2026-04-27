import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

interface SessionCompletedData {
  sessionId: number;
  sessionTitle: string;
  totalCases?: number;
  completionRate?: number;
  statusCounts?: Array<{
    statusId: number | null;
    statusName: string;
    colorValue: string;
    count: number;
    isCompleted?: boolean;
  }>;
}

const SLACK_MAX_FIELDS = 8;

export function formatSessionCompletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as SessionCompletedData;
  const completionPct = Math.round((data.completionRate ?? 0) * 100);
  const text = `Session "${data.sessionTitle}" completed${data.totalCases != null ? ` (${data.totalCases} cases)` : ""}`;

  const statusCounts = data.statusCounts ?? [];
  const statusFields = statusCounts.slice(0, SLACK_MAX_FIELDS).map((sc) => ({
    type: "mrkdwn" as const,
    text: `*${sc.statusName}:*\n${sc.count}`,
  }));

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Session completed", emoji: false },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Session:*\n${data.sessionTitle}` },
        { type: "mrkdwn", text: `*Project:*\n${envelope.projectName}` },
        {
          type: "mrkdwn",
          text: `*Cases:*\n${data.totalCases ?? "—"}`,
        },
        { type: "mrkdwn", text: `*Completion:*\n${completionPct}%` },
      ],
    },
  ];

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
