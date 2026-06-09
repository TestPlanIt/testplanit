import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import {
  buildScimBody,
  externalIdFooter,
  scimDataOf,
  userIdentityLine,
} from "./_scim_shared";

interface ScimUserActivatedData {
  id: string;
  name: string | null;
  email: string | null;
  userName: string | null;
  scimExternalId: string | null;
}

/**
 * scim.user.activated — `active` flipped false → true. Informational
 * additive event; no color bar (same treatment as .created).
 */
export function formatScimUserActivatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = scimDataOf<ScimUserActivatedData>(envelope);
  return buildScimBody({
    previewText: `SCIM user reactivated: ${data.name ?? data.userName ?? "?"}`,
    header: "SCIM user reactivated",
    identityLine: userIdentityLine(data),
    footer: externalIdFooter(data.scimExternalId),
  });
}
