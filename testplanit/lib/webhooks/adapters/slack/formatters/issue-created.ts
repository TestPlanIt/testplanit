import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

interface IssueCreatedData {
  id: number;
  title: string;
  severity?: string | null;
  status?: string | null;
  externalKey?: string | null;
}

export function formatIssueCreatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as IssueCreatedData;
  const severityLabel = data.severity ? ` [${data.severity}]` : "";
  const text = `Issue created: ${data.title}${severityLabel}`;

  const fields: Array<Record<string, unknown>> = [
    { type: "mrkdwn", text: `*Title:*\n${data.title}` },
    { type: "mrkdwn", text: `*Project:*\n${envelope.projectName}` },
  ];

  if (data.severity) {
    fields.push({ type: "mrkdwn", text: `*Severity:*\n${data.severity}` });
  }
  if (data.status) {
    fields.push({ type: "mrkdwn", text: `*Status:*\n${data.status}` });
  }
  if (data.externalKey) {
    fields.push({
      type: "mrkdwn",
      text: `*External:*\n${data.externalKey}`,
    });
  }

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Issue created", emoji: false },
    },
    { type: "section", fields },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `eventId: \`${envelope.eventId}\` · ${envelope.eventTimestamp}`,
        },
      ],
    },
  ];

  return {
    body: JSON.stringify({ text, blocks }),
    contentType: "application/json",
  };
}
