import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

interface WebhookTestData {
  source?: string;
  message?: string;
}

/**
 * Synthetic `webhook.test` event — produced by the "Send test event" button
 * (Plan 02-06's sendTestOutboundWebhook server action). Confirms full
 * pipeline health to the destination. Distinct from the inbound webhook
 * self-loop in Phase 1 (`__synthetic__` issue.key).
 */
export function formatWebhookTestBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as WebhookTestData;
  const source = data.source ?? "TestPlanIt";
  const message = data.message ?? "Webhook pipeline is healthy";
  const text = `${source} webhook test: ${message}`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "TestPlanIt webhook test",
        emoji: false,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:white_check_mark: ${message}`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Project:*\n${envelope.projectName}` },
        { type: "mrkdwn", text: `*Source:*\n${source}` },
      ],
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
