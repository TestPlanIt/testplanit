/**
 * enhanceWithAudit — returns the access-policy-enforced ORM client bound to the
 * acting user (v3: `policyClient.$setAuth(user)` via getAuthDb).
 *
 * Actor attribution for trigger-based CDC (the `app.audit_context` GUC) is now
 * injected by the ORM side-effects plugin (lib/zenstack-plugins/sideEffectsPlugin),
 * which sets the GUC inside the write transaction — so callers no longer wrap
 * writes here. Kept as a named seam so the RPC route + bulk import/copy-move
 * routes don't change; it is a thin alias for getAuthDb.
 */
import { type UserForAuth } from "~/lib/authContext";
import { getAuthDb } from "~/lib/zenstack";

export async function enhanceWithAudit(user: UserForAuth | null | undefined) {
  return await getAuthDb(user ?? undefined);
}
