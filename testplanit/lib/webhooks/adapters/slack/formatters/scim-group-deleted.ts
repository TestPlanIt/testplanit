import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { COLOR_RED } from "./_shared";
import {
  buildScimBody,
  externalIdFooter,
  groupIdentityLine,
  scimDataOf,
} from "./_scim_shared";

interface ScimGroupDeletedData {
  id: number;
  displayName?: string | null;
  externalId: string | null;
}

/**
 * scim.group.deleted — IdP issued a DELETE /Groups/{id}. Soft-delete
 * tombstone in TestPlanIt. Red bar mirrors .user.deleted.
 */
export function formatScimGroupDeletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = scimDataOf<ScimGroupDeletedData>(envelope);
  return buildScimBody({
    previewText: `SCIM group removed: ${data.displayName ?? data.id}`,
    header: "SCIM group removed",
    identityLine: groupIdentityLine(data, { link: false }),
    color: COLOR_RED,
    footer: externalIdFooter(data.externalId),
  });
}
