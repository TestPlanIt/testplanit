import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, COLOR_GREEN, projectNameOf } from "./_shared";

interface WebhookTestData {
  source?: string;
  message?: string;
}

/**
 * Synthetic `webhook.test` event — produced by the "Send test event"
 * button (the sendTestOutboundWebhook server action). Confirms full
 * pipeline health to the destination, so it gets a green color bar.
 */
export function formatWebhookTestBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as WebhookTestData;
  const message = data.message ?? "Webhook pipeline is healthy";

  return buildBody({
    text: `TestPlanIt webhook test: ${message}`,
    color: COLOR_GREEN,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Webhook test", emoji: false },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${message}\nin ${projectNameOf(envelope)}`,
        },
      },
    ],
  });
}
