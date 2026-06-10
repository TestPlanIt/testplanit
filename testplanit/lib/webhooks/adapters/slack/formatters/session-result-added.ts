import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import {
  buildBody,
  COLOR_GREEN,
  COLOR_RED,
  COLOR_YELLOW,
  emojiForStatus,
  projectNameOf,
  titleAndProject,
  url,
} from "./_shared";

/**
 * `session.result_added` payload (see event-emitters/sessionEvents.ts):
 *   { sessionId, sessionName, resultId, statusId, statusName, statusColor,
 *     isCompleted, isSuccess, isFailure, ... }
 * The payload carries no projectId, so the deep link uses envelope.projectId.
 * Color bar = the result Status's own color, falling back to the canonical
 * green/red/yellow rule from the status flags. Mirrors test_run.result_added.
 */
interface SessionResultAddedData {
  sessionId: number;
  sessionName: string;
  statusName?: string | null;
  statusColor?: string | null;
  isCompleted?: boolean;
  isSuccess?: boolean;
  isFailure?: boolean;
}

export function formatSessionResultAddedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as SessionResultAddedData;
  const statusName = data.statusName ?? "—";
  const color =
    data.statusColor ??
    (data.isSuccess ? COLOR_GREEN : data.isFailure ? COLOR_RED : COLOR_YELLOW);

  return buildBody({
    text: `Session result added: ${statusName}`,
    color,
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
        text: {
          type: "mrkdwn",
          text: `${emojiForStatus(data)} *${statusName}*`,
        },
      },
    ],
  });
}
