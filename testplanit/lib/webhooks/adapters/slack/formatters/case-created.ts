import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

interface CaseCreatedData {
  id: number;
  title: string;
  description?: string | null;
}

const DESCRIPTION_MAX_LEN = 280;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * OUT-17 — `case.created` payload ships the full case structure on the
 * generic-HMAC adapter; Slack only renders a summary block.
 */
export function formatCaseCreatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as CaseCreatedData;
  const text = `Case created: ${data.title}`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Case created", emoji: false },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Title:*\n${data.title}` },
        { type: "mrkdwn", text: `*Project:*\n${envelope.projectName}` },
        {
          type: "mrkdwn",
          text: `*Actor:*\n${envelope.actorUserId ?? "system"}`,
        },
      ],
    },
  ];

  if (data.description) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Description:*\n${truncate(data.description, DESCRIPTION_MAX_LEN)}`,
      },
    });
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
