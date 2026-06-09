import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import {
  buildScimBody,
  externalIdFooter,
  groupIdentityLine,
  scimDataOf,
} from "./_scim_shared";

interface ScimGroupUpdatedData {
  id: number;
  displayName: string | null;
  externalId: string | null;
  diff?: {
    changedFields: string[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  after?: {
    displayName?: string | null;
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
 * scim.group.updated — non-membership group attribute change (usually
 * a rename). Member add/remove route to dedicated formatters; the
 * "members" field, if it appears here, is filtered out.
 */
export function formatScimGroupUpdatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = scimDataOf<ScimGroupUpdatedData>(envelope);
  const ident = groupIdentityLine({
    id: data.id,
    displayName: data.after?.displayName ?? data.displayName,
  });
  const changed = (data.diff?.changedFields ?? []).filter(
    (f) => f !== "members"
  );
  const before = data.diff?.before ?? {};
  const after = data.diff?.after ?? {};

  const extras: Array<Record<string, unknown>> = [];
  if (changed.length > 0) {
    const rows = changed.slice(0, SLACK_MAX_DIFF_ROWS).map((field) => {
      const beforeVal = valueDisplay(before[field]);
      const afterVal = valueDisplay(after[field]);
      return `*${field}:* \`${beforeVal}\` → \`${afterVal}\``;
    });
    if (changed.length > SLACK_MAX_DIFF_ROWS) {
      rows.push(`_…and ${changed.length - SLACK_MAX_DIFF_ROWS} more changes_`);
    }
    extras.push({ type: "divider" });
    extras.push({
      type: "section",
      text: { type: "mrkdwn", text: rows.join("\n") },
    });
  }

  return buildScimBody({
    previewText:
      changed.length > 0
        ? `SCIM group updated: ${data.displayName ?? "?"} (${changed.join(", ")})`
        : `SCIM group updated: ${data.displayName ?? "?"}`,
    header: "SCIM group updated",
    identityLine: ident,
    extraBlocks: extras,
    footer: externalIdFooter(data.externalId),
  });
}
