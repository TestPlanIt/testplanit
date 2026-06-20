import type { AdapterType } from "~/zenstack/models";
import type {
  FormattedHttpRequest,
  OutboundEnvelope,
  OutboundWebhookAdapter,
} from "./types";
import { formatGenericBlocks, SLACK_FORMATTERS } from "./slack/formatters";

/**
 * Slack incoming-webhook adapter.
 *
 * Wire format: POST {webhook URL} with body {text, blocks} per Slack Block Kit.
 * Authentication: the URL itself is the credential — no signing function is
 * defined (sign is intentionally absent). Anyone with the URL can post. The
 * admin form makes this sensitivity explicit.
 *
 * Per-event formatters live in ./slack/formatters/ — one file per event.
 * Events not registered in SLACK_FORMATTERS fall through to
 * formatGenericBlocks (a readable diagnostic block).
 */
export const slackAdapter: OutboundWebhookAdapter = {
  adapterType: "SLACK" satisfies AdapterType,
  // sign is intentionally absent — destructively explicit (URL is the credential).
  format(envelope: OutboundEnvelope): FormattedHttpRequest {
    const formatter =
      SLACK_FORMATTERS[envelope.eventName] ?? formatGenericBlocks;
    return formatter(envelope);
  },
};
