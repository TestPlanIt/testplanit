import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf } from "./_shared";

const ENVELOPE_DUMP_MAX_LEN = 1500;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * Fallback formatter for any event name not present in SLACK_FORMATTERS.
 * No color bar (informational; we don't know the outcome semantics).
 * Surfaces the eventName + truncated JSON dump so admins can diagnose
 * unmapped events without a schema-aware formatter.
 */
export function formatGenericBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  return buildBody({
    text: `${envelope.eventName} received`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: envelope.eventName, emoji: false },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${envelope.eventName}*\nin ${projectNameOf(envelope)}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `\`\`\`${truncate(JSON.stringify(envelope.data, null, 2), ENVELOPE_DUMP_MAX_LEN)}\`\`\``,
        },
      },
    ],
  });
}
