import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody } from "./_shared";

interface ScimGroupMemberAddedSummaryData {
  count: number;
  firstAt: string;
  lastAt: string;
  windowStart: string;
}

function formatRange(firstAt: string, lastAt: string): string {
  try {
    const first = new Date(firstAt);
    const last = new Date(lastAt);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) {
      return `${firstAt} → ${lastAt}`;
    }
    const ms = last.getTime() - first.getTime();
    if (ms < 1000) return "in under a second";
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `in ${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `in ${minutes}m`;
    const hours = Math.round(minutes / 60);
    return `in ${hours}h`;
  } catch {
    return `${firstAt} → ${lastAt}`;
  }
}

/**
 * scim.group.member_added.summary — rollup that replaces individual
 * .member_added events past the per-config threshold. Same shape as
 * the user-created summary.
 */
export function formatScimGroupMemberAddedSummaryBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as ScimGroupMemberAddedSummaryData;
  const range = formatRange(data.firstAt, data.lastAt);

  return buildBody({
    text: `SCIM bulk sync: ${data.count} group member additions`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `SCIM bulk sync — ${data.count} member additions`,
          emoji: false,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Your IdP added ${data.count} group memberships ${range}.\n_Further events in this 5-minute window fold silently. Bursts that cross into the next window will get their own summary._`,
        },
      },
    ],
  });
}
