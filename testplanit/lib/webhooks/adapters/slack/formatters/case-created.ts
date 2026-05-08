import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, titleAndProject, url } from "./_shared";

interface CaseCreatedData {
  id: number;
  title?: string;
  /** Emitter ships `name`; older drafts used `title`. Accept both. */
  name?: string;
  projectId: number;
  description?: string | null;
  stateName?: string | null;
  stateColor?: string | null;
}

const DESCRIPTION_MAX_LEN = 280;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * `case.created` payload ships the full case structure on the
 * generic-HMAC adapter; Slack only renders a summary block.
 * Informational event — no color bar.
 */
export function formatCaseCreatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as CaseCreatedData;
  const title = data.title ?? data.name ?? "(unnamed case)";

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Case created", emoji: false },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: titleAndProject(
          title,
          projectNameOf(envelope),
          url.case(data.projectId, data.id)
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

  if (data.description) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: truncate(data.description, DESCRIPTION_MAX_LEN),
      },
    });
  }

  return buildBody({
    text: `Case created: ${title}`,
    // Color bar = the case's workflow state color when present.
    color: data.stateColor ?? undefined,
    blocks,
  });
}
