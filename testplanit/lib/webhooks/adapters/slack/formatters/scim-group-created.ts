import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import {
  buildScimBody,
  externalIdFooter,
  groupIdentityLine,
  scimDataOf,
} from "./_scim_shared";

interface ScimGroupCreatedData {
  id: number;
  displayName: string | null;
  externalId: string | null;
  members?: Array<{ value: string; display?: string | null }>;
}

const SAMPLE_MEMBER_CAP = 5;

/**
 * scim.group.created — IdP provisioned a group. Show the display name +
 * a small sample of initial members; full member list available in
 * /admin/groups deep-link.
 */
export function formatScimGroupCreatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = scimDataOf<ScimGroupCreatedData>(envelope);
  const members = data.members ?? [];

  const extras: Array<Record<string, unknown>> = [];
  if (members.length > 0) {
    const sample = members
      .slice(0, SAMPLE_MEMBER_CAP)
      .map((m) => m.display ?? m.value)
      .join(", ");
    const overflow =
      members.length > SAMPLE_MEMBER_CAP
        ? ` _…and ${members.length - SAMPLE_MEMBER_CAP} more_`
        : "";
    extras.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Initial members (${members.length}):* ${sample}${overflow}`,
      },
    });
  }

  return buildScimBody({
    previewText: `SCIM group created: ${data.displayName ?? "?"}`,
    header: "SCIM group created",
    identityLine: groupIdentityLine(data),
    extraBlocks: extras,
    footer: externalIdFooter(data.externalId),
  });
}
