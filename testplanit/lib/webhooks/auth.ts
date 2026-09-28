import type { Session } from "next-auth";

import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";

/**
 * Server-side authorization for `WebhookConfig` mutations (CR-02).
 *
 * The schema's `@@deny('create, update, delete', true)` policy blocks ALL
 * client-side writes through ZenStack RPC. Server actions perform writes via
 * raw `db` (bypassing the policy) and use this helper to verify the caller
 * is a project admin — the same authority the `WebhookConfig` read policy
 * and every other project-settings surface key off:
 *
 *   1. System Admin (`User.access === "ADMIN"`)                → always allowed
 *   2. Project creator                                          → their project
 *   3. Effective project role carrying Settings canAddEdit      → that project
 *   4. Globally-PROJECTADMIN user assigned to the project       → that project
 *
 * The ladder itself lives in lib/services/areaPermission.ts, reached through
 * `authorizeProjectAdminForProject`, so this helper cannot drift from the
 * settings pages' own gate.
 */
export async function canManageWebhookConfig(
  session: Session,
  projectId: number
): Promise<boolean> {
  if (session.user.access === "ADMIN") {
    return true;
  }
  if (!session.user.id) return false;

  return (await authorizeProjectAdminForProject(session, projectId)).ok;
}
