import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, trackerLine, url } from "./_shared";

interface IssueUpdatedData {
  id: number;
  title: string;
  externalKey?: string | null;
  externalUrl?: string | null;
  diff?: {
    changedFields: string[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
}

const SLACK_MAX_DIFF_ROWS = 6;
const VALUE_MAX_LEN = 60;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function valueDisplay(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "string") return truncate(v, VALUE_MAX_LEN);
  return truncate(JSON.stringify(v), VALUE_MAX_LEN);
}

/**
 * Render `data.diff.changedFields` as compact "field: before → after" rows,
 * one per visual line. Informational event — no color bar. Caps at 6 rows
 * + "and N more" footer when overflow.
 */
export function formatIssueUpdatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as IssueUpdatedData;
  const changed = data.diff?.changedFields ?? [];
  const before = data.diff?.before ?? {};
  const after = data.diff?.after ?? {};
  // Link back to the issue in TestPlanIt (the issues page deep-links by id).
  const titleLink = `*<${url.issue(envelope.projectId, data.id)}|${data.title}>*`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Issue updated", emoji: false },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${titleLink}\nin ${projectNameOf(envelope)}`,
      },
    },
  ];

  const tracker = trackerLine(data.externalKey, data.externalUrl);
  if (tracker) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: tracker } });
  }

  if (changed.length > 0) {
    const rows = changed.slice(0, SLACK_MAX_DIFF_ROWS).map((field) => {
      const beforeVal = valueDisplay(before[field]);
      const afterVal = valueDisplay(after[field]);
      return `*${field}:* \`${beforeVal}\` → \`${afterVal}\``;
    });
    if (changed.length > SLACK_MAX_DIFF_ROWS) {
      rows.push(`_…and ${changed.length - SLACK_MAX_DIFF_ROWS} more changes_`);
    }
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: rows.join("\n") },
    });
  }

  return buildBody({
    text:
      changed.length > 0
        ? `Issue updated: ${data.title} (${changed.join(", ")})`
        : `Issue updated: ${data.title}`,
    blocks,
  });
}
