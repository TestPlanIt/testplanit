import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

const ENVELOPE_DUMP_MAX_LEN = 2000;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * D-17 — fallback formatter for any event name not present in
 * SLACK_FORMATTERS. Produces a readable Block Kit message that includes
 * the eventName + a JSON dump of the envelope so admins can diagnose new
 * event types without a schema-aware formatter.
 */
export function formatGenericBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const text = `${envelope.eventName} received`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: envelope.eventName,
        emoji: false,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Event:*\n${envelope.eventName}` },
        { type: "mrkdwn", text: `*Project:*\n${envelope.projectName}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `\`\`\`${truncate(JSON.stringify(envelope, null, 2), ENVELOPE_DUMP_MAX_LEN)}\`\`\``,
      },
    },
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
