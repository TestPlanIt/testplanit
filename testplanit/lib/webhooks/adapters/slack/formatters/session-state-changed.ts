import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, titleAndProject, url } from "./_shared";

/**
 * `session.state_changed` payload (see event-emitters/sessionEvents.ts):
 *   { sessionId, sessionName, projectId, from:{stateName}, to:{stateName}, ... }
 * Compact transition log — no color bar (the emitter resolves stateName but
 * not a color). Mirrors test_run.state_changed.
 */
interface SessionStateChangedData {
  sessionId: number;
  sessionName: string;
  projectId: number;
  from?: { stateName?: string | null };
  to?: { stateName?: string | null; stateColor?: string | null };
}

export function formatSessionStateChangedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as SessionStateChangedData;
  const fromName = data.from?.stateName ?? "—";
  const toName = data.to?.stateName ?? "—";

  return buildBody({
    text: `Session state changed: ${data.sessionName}`,
    // Color bar = the workflow color of the state being transitioned TO.
    color: data.to?.stateColor ?? undefined,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Session state changed",
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
            url.session(data.projectId, data.sessionId)
          ),
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${fromName}*  →  *${toName}*` },
      },
    ],
  });
}
