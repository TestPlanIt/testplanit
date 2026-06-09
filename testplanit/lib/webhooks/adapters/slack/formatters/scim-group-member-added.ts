import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import {
  buildScimBody,
  externalIdFooter,
  groupIdentityLine,
  scimDataOf,
} from "./_scim_shared";

interface ScimGroupMemberAddedData {
  id: number;
  displayName: string | null;
  externalId: string | null;
  /** The added members on this event (NOT the full membership). */
  members?: Array<{ value: string; display?: string | null }>;
}

const SAMPLE_MEMBER_CAP = 5;

/**
 * scim.group.member_added — IdP added one or more users to a group.
 * Informational; coalesces past the threshold via the .summary type.
 */
export function formatScimGroupMemberAddedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = scimDataOf<ScimGroupMemberAddedData>(envelope);
  const members = data.members ?? [];

  const sample = members
    .slice(0, SAMPLE_MEMBER_CAP)
    .map((m) => m.display ?? m.value)
    .join(", ");
  const overflow =
    members.length > SAMPLE_MEMBER_CAP
      ? ` _…and ${members.length - SAMPLE_MEMBER_CAP} more_`
      : "";
  const added =
    members.length > 0
      ? `*Added (${members.length}):* ${sample}${overflow}`
      : "_No member payload on event._";

  return buildScimBody({
    previewText: `SCIM group member added: ${data.displayName ?? "?"}`,
    header: members.length > 1 ? "SCIM members added" : "SCIM member added",
    identityLine: groupIdentityLine(data),
    extraBlocks: [{ type: "section", text: { type: "mrkdwn", text: added } }],
    footer: externalIdFooter(data.externalId),
  });
}
