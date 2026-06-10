import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, COLOR_RED, projectNameOf } from "./_shared";

/**
 * `issue.deleted` payload (see event-emitters/issueEvents.ts):
 *   { id, name, title, projectId }
 * The issue row is gone, so the title is plain bold text (no deep link).
 * Red bar signals the destructive action. Mirrors case.deleted.
 */
interface IssueDeletedData {
  id: number;
  title?: string;
  name?: string;
  projectId: number;
}

export function formatIssueDeletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as IssueDeletedData;
  const title = data.title ?? data.name ?? `Issue #${data.id}`;

  return buildBody({
    text: `Issue deleted: ${title}`,
    color: COLOR_RED,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Issue deleted", emoji: false },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${title}*\nin ${projectNameOf(envelope)}`,
        },
      },
    ],
  });
}
