import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, titleAndProject, url } from "./_shared";

/**
 * `case.updated` payload (see lib/webhooks/event-emitters/caseEvents.ts):
 *   { id, projectId, name, changes: ResolvedChange[], diff }
 * The emitter resolves every foreign-key id and option-backed custom field to
 * a display name, so this formatter just renders the `changes` rows. The raw
 * `diff` is still on the payload for generic-HMAC consumers.
 */
interface ResolvedChange {
  label: string;
  from: string | null;
  to: string | null;
  color?: string | null;
}

interface CaseUpdatedData {
  id: number;
  projectId: number;
  name: string;
  changes?: ResolvedChange[];
}

const SLACK_MAX_ROWS = 8;

function row(c: ResolvedChange): string {
  return `*${c.label}:* \`${c.from ?? "—"}\` → \`${c.to ?? "—"}\``;
}

export function formatCaseUpdatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as CaseUpdatedData;
  const changes = data.changes ?? [];
  const title = data.name ?? "(unnamed case)";
  // Color bar = the workflow state's color when a state change is present.
  const color = changes.find((c) => c.color)?.color ?? undefined;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Case updated", emoji: false },
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

  if (changes.length > 0) {
    const rows = changes.slice(0, SLACK_MAX_ROWS).map(row);
    if (changes.length > SLACK_MAX_ROWS) {
      rows.push(`_…and ${changes.length - SLACK_MAX_ROWS} more changes_`);
    }
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: rows.join("\n") },
    });
  }

  return buildBody({
    text: `Case updated: ${title}`,
    color: color ?? undefined,
    blocks,
  });
}
