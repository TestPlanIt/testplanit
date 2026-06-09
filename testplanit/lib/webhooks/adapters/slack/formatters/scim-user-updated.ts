import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import {
  buildScimBody,
  externalIdFooter,
  scimDataOf,
  userIdentityLine,
} from "./_scim_shared";

interface ScimUserUpdatedData {
  id: string;
  name: string | null;
  email: string | null;
  userName: string | null;
  scimExternalId: string | null;
  diff?: {
    changedFields: string[];
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  };
  after?: {
    name?: string | null;
    email?: string | null;
    scimUserName?: string | null;
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
 * scim.user.updated — non-activation user attribute change. Render
 * `diff.changedFields` as compact `field: before → after` rows. The
 * isActive flip events route to dedicated activated/deactivated
 * formatters; this one excludes them by filter when present.
 */
export function formatScimUserUpdatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = scimDataOf<ScimUserUpdatedData>(envelope);
  const ident = userIdentityLine({
    id: data.id,
    name: data.after?.name ?? data.name,
    email: data.after?.email ?? data.email,
    userName: data.after?.scimUserName ?? data.userName,
  });
  const changed = (data.diff?.changedFields ?? []).filter(
    (f) => f !== "isActive"
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
        ? `SCIM user updated: ${data.name ?? data.userName ?? "?"} (${changed.join(", ")})`
        : `SCIM user updated: ${data.name ?? data.userName ?? "?"}`,
    header: "SCIM user updated",
    identityLine: ident,
    extraBlocks: extras,
    footer: externalIdFooter(data.scimExternalId),
  });
}
