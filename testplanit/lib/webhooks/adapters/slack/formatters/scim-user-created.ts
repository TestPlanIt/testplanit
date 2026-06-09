import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import {
  buildScimBody,
  externalIdFooter,
  scimDataOf,
  userIdentityLine,
} from "./_scim_shared";

interface ScimUserCreatedData {
  id: string;
  name: string | null;
  email: string | null;
  userName: string | null;
  active: boolean;
  scimExternalId: string | null;
}

/**
 * scim.user.created — IdP provisioned a user into TestPlanIt. Informational
 * (no color bar); fires often during first-sync but absorbed by
 * coalescing past the threshold.
 */
export function formatScimUserCreatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = scimDataOf<ScimUserCreatedData>(envelope);
  return buildScimBody({
    previewText: `SCIM user created: ${data.name ?? data.userName ?? data.email ?? "?"}`,
    header: "SCIM user created",
    identityLine: userIdentityLine(data),
    footer: externalIdFooter(data.scimExternalId),
  });
}
