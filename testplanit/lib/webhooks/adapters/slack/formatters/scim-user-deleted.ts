import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { COLOR_RED } from "./_shared";
import {
  buildScimBody,
  externalIdFooter,
  scimDataOf,
  userIdentityLine,
} from "./_scim_shared";

interface ScimUserDeletedData {
  id: string;
  name?: string | null;
  email?: string | null;
  userName?: string | null;
  scimExternalId: string | null;
}

/**
 * scim.user.deleted — IdP issued a DELETE /Users/{id}. In TestPlanIt
 * this is a soft-delete tombstone, not a destructive operation, but
 * the user vanishes from active rosters. Red bar to differentiate
 * from deactivation.
 */
export function formatScimUserDeletedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = scimDataOf<ScimUserDeletedData>(envelope);
  return buildScimBody({
    previewText: `SCIM user removed: ${data.name ?? data.userName ?? data.email ?? data.id}`,
    header: "SCIM user removed",
    identityLine: userIdentityLine(data, { link: false }),
    color: COLOR_RED,
    footer: externalIdFooter(data.scimExternalId),
  });
}
