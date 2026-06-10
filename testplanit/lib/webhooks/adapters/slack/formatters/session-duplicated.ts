import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, titleAndProject, url } from "./_shared";

/**
 * `session.duplicated` payload (see event-emitters/sessionEvents.ts):
 *   { newSessionId, sourceSessionId, sessionName, projectId }
 * Informational event — no color bar.
 */
interface SessionDuplicatedData {
  newSessionId: number;
  sourceSessionId: number;
  sessionName?: string | null;
  projectId: number;
}

export function formatSessionDuplicatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as SessionDuplicatedData;
  const title = data.sessionName ?? `Session #${data.newSessionId}`;
  const sourceUrl = url.session(data.projectId, data.sourceSessionId);

  return buildBody({
    text: `Session duplicated: ${title}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Session duplicated", emoji: false },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: titleAndProject(
            title,
            projectNameOf(envelope),
            url.session(data.projectId, data.newSessionId)
          ),
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Duplicated from <${sourceUrl}|#${data.sourceSessionId}>`,
        },
      },
    ],
  });
}
