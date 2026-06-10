import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, titleAndProject, url } from "./_shared";

/**
 * `session.created` payload (see event-emitters/sessionEvents.ts):
 *   { sessionId, sessionName, stateId, stateName, isCompleted, projectId }
 * Informational event — no color bar. The emitter already resolves stateName.
 */
interface SessionCreatedData {
  sessionId: number;
  sessionName: string;
  projectId: number;
  stateName?: string | null;
  stateColor?: string | null;
}

export function formatSessionCreatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as SessionCreatedData;
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Session created", emoji: false },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: titleAndProject(
          data.sessionName,
          projectNameOf(envelope),
          url.session(data.projectId, data.sessionId)
        ),
      },
    },
  ];
  if (data.stateName) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*State:* ${data.stateName}` },
    });
  }
  return buildBody({
    text: `Session created: ${data.sessionName}`,
    // Color bar = the session's workflow state color, mirroring case.created.
    color: data.stateColor ?? undefined,
    blocks,
  });
}
