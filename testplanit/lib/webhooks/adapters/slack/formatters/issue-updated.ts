import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

interface IssueUpdatedData {
  id: number;
  title: string;
  diff?: {
    changedFields: string[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
}

const SLACK_MAX_DIFF_ROWS = 8;
const VALUE_MAX_LEN = 80;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function valueOrDash(v: unknown): string {
  if (v === undefined || v === null) return "—";
  return truncate(JSON.stringify(v), VALUE_MAX_LEN);
}

/**
 * OUT-18 — render `data.diff.changedFields` as "before → after" rows.
 * Falls back to a generic "issue updated" block when no diff is present.
 */
export function formatIssueUpdatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as IssueUpdatedData;
  const changed = data.diff?.changedFields ?? [];
  const before = data.diff?.before ?? {};
  const after = data.diff?.after ?? {};

  const text =
    changed.length > 0
      ? `Issue "${data.title}" updated (${changed.join(", ")})`
      : `Issue "${data.title}" updated`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Issue updated", emoji: false },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Title:*\n${data.title}` },
        { type: "mrkdwn", text: `*Project:*\n${envelope.projectName}` },
      ],
    },
  ];

  for (const field of changed.slice(0, SLACK_MAX_DIFF_ROWS)) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${field}:*\n\`${valueOrDash(before[field])}\` → \`${valueOrDash(after[field])}\``,
      },
    });
  }

  if (changed.length > SLACK_MAX_DIFF_ROWS) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `… and ${changed.length - SLACK_MAX_DIFF_ROWS} more changes`,
        },
      ],
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
