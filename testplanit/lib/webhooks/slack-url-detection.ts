/**
 * Slack incoming-webhook URL hostname detector.
 *
 * Used by:
 *  - app/actions/webhook-config.ts createOutboundWebhook — auto-set
 *    adapterType: SLACK if URL hostname is hooks.slack.com, else
 *    GENERIC_HMAC.
 *  - app/[locale]/projects/settings/[projectId]/webhooks/webhook-outbound-form.tsx —
 *    show "(detected: Slack)" badge as the admin types the URL.
 *  - lib/webhooks/dispatch.ts — sanity check: if a SLACK-typed config
 *    has a non-Slack URL, log a warning (data drift; should never happen
 *    if the server actions are the only write path).
 *
 * Slack Enterprise Grid uses the same `hooks.slack.com` hostname per
 * current Slack docs — workspace-subdomained URLs (e.g.
 * `acme.slack.com/services/...`) are NOT incoming webhooks. We match
 * on the exact hostname.
 */
export const SLACK_WEBHOOK_HOSTNAME = "hooks.slack.com" as const;

export function isSlackWebhookUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase() === SLACK_WEBHOOK_HOSTNAME;
  } catch {
    return false;
  }
}
