import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { COLOR_YELLOW } from "./_shared";
import {
  buildScimBody,
  externalIdFooter,
  scimDataOf,
  userIdentityLine,
} from "./_scim_shared";

interface ScimUserDeactivatedData {
  id: string;
  name: string | null;
  email: string | null;
  userName: string | null;
  scimExternalId: string | null;
}

/**
 * scim.user.deactivated — `active` flipped true → false. Reversible
 * state change; yellow bar so admins clock it but it isn't alarming.
 * Most common cause: IdP disabled the user (offboarding, leave, etc).
 */
export function formatScimUserDeactivatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = scimDataOf<ScimUserDeactivatedData>(envelope);
  return buildScimBody({
    previewText: `SCIM user deactivated: ${data.name ?? data.userName ?? "?"}`,
    header: "SCIM user deactivated",
    identityLine: userIdentityLine(data),
    color: COLOR_YELLOW,
    footer: externalIdFooter(data.scimExternalId),
  });
}
