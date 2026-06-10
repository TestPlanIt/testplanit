import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, titleAndProject, url } from "./_shared";

/**
 * `session.result_added` payload (see event-emitters/sessionEvents.ts):
 *   { sessionId, sessionName, resultId, statusId, statusName, isCompleted, ... }
 * The payload carries no projectId, so the deep link uses envelope.projectId.
 * The emitter already resolves statusName.
 */
interface SessionResultAddedData {
  sessionId: number;
  sessionName: string;
  statusName?: string | null;
}

export function formatSessionResultAddedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as SessionResultAddedData;
  const statusName = data.statusName ?? "—";

  return buildBody({
    text: `Session result added: ${statusName}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Session result added",
          emoji: false,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: titleAndProject(
            data.sessionName,
            projectNameOf(envelope),
            url.session(envelope.projectId, data.sessionId)
          ),
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Status:* ${statusName}` },
      },
    ],
  });
}
