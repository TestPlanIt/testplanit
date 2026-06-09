import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { COLOR_YELLOW } from "./_shared";
import {
  buildScimBody,
  externalIdFooter,
  groupIdentityLine,
  scimDataOf,
} from "./_scim_shared";

interface ScimGroupMemberRemovedData {
  id: number;
  displayName: string | null;
  externalId: string | null;
  /** The removed members on this event (NOT the remaining membership). */
  members?: Array<{ value: string; display?: string | null }>;
}

const SAMPLE_MEMBER_CAP = 5;

/**
 * scim.group.member_removed — IdP removed one or more users from a group.
 * Yellow bar matching .deactivated treatment; this often signals access
 * being revoked.
 */
export function formatScimGroupMemberRemovedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = scimDataOf<ScimGroupMemberRemovedData>(envelope);
  const members = data.members ?? [];

  const sample = members
    .slice(0, SAMPLE_MEMBER_CAP)
    .map((m) => m.display ?? m.value)
    .join(", ");
  const overflow =
    members.length > SAMPLE_MEMBER_CAP
      ? ` _…and ${members.length - SAMPLE_MEMBER_CAP} more_`
      : "";
  const removed =
    members.length > 0
      ? `*Removed (${members.length}):* ${sample}${overflow}`
      : "_No member payload on event._";

  return buildScimBody({
    previewText: `SCIM group member removed: ${data.displayName ?? "?"}`,
    header: members.length > 1 ? "SCIM members removed" : "SCIM member removed",
    identityLine: groupIdentityLine(data),
    color: COLOR_YELLOW,
    extraBlocks: [{ type: "section", text: { type: "mrkdwn", text: removed } }],
    footer: externalIdFooter(data.externalId),
  });
}
