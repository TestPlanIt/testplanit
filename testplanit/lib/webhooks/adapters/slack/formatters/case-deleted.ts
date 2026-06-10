import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, COLOR_RED, projectNameOf } from "./_shared";

/**
 * `case.deleted` payload (see lib/webhooks/event-emitters/caseEvents.ts):
 *   { id, name, projectId }
 * The case row is gone, so the title is plain bold text (no deep link — it
 * would 404). Red bar signals the destructive action.
 */
interface CaseDeletedData {
  id: number;
  name?: string;
  projectId: number;
}

export function formatCaseDeletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as CaseDeletedData;
  const title = data.name ?? `Case #${data.id}`;

  return buildBody({
    text: `Case deleted: ${title}`,
    color: COLOR_RED,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Case deleted", emoji: false },
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
