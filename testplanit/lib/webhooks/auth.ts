import type { Session } from "next-auth";

import { getEnhancedDb } from "~/lib/auth/utils";

/**
 * Server-side authorization for `WebhookConfig` mutations (CR-02).
 *
 * The schema's `@@deny('create, update, delete', true)` policy blocks ALL
 * client-side writes through ZenStack RPC. Server actions perform writes via
 * raw `db` (bypassing the policy) and use this helper to verify the
 * caller has the same authority that the prior `@@allow('create,update,delete', ...)`
 * clause encoded — namely:
 *
 *   1. System Admin (`User.access === "ADMIN"`)                        → always allowed
 *   2. Project creator (`project.creator == auth()`)                    → allowed for their project
 *   3. Per-project Project Admin role (SPECIFIC_ROLE)                   → allowed for that project
 *   4. Globally-PROJECTADMIN user assigned to the project               → allowed for that project
 *
 * Implementation strategy: query `Projects` through the policy-bound
 * (enhanced) client. The project read policy already gates by tenancy and
 * basic project access; we then layer on the admin-tier filter so that
 * regular project members (READ/WRITE access types without the admin role)
 * cannot reach the helper's `true` branch.
 *
 * This mirrors the previous `@@allow` policy on `WebhookConfig` so the
 * authorization surface is unchanged from a user's perspective — only the
 * write *path* moved from "ZenStack RPC" to "server action".
 */
export async function canManageWebhookConfig(
  session: Session,
  projectId: number
): Promise<boolean> {
  // System Admins always pass — `auth().access == 'ADMIN'` clause.
  if (session.user.access === "ADMIN") {
    return true;
  }

  const userId = session.user.id;
  if (!userId) return false;

  // Mirror the prior `@@allow('read', ...)` clause on WebhookConfig.
  // We query Projects (not WebhookConfig) so the helper works in the create
  // case where no WebhookConfig row exists yet.
  const enhancedDb = await getEnhancedDb(session);
  const project = await enhancedDb.projects.findFirst({
    where: {
      id: projectId,
      OR: [
        // Projects FK from `createdBy` (String) to User; the relation field is
        // `creator`. Match either side; the FK is cheaper to query.
        { createdBy: userId },
        {
          userPermissions: {
            some: {
              userId,
              accessType: "SPECIFIC_ROLE",
              role: { name: "Project Admin" },
            },
          },
        },
        // Global PROJECTADMIN users gain admin authority on any project they
        // are explicitly assigned to (`project.assignedUsers?[user == auth() && auth().access == 'PROJECTADMIN']`).
        ...(session.user.access === "PROJECTADMIN"
          ? [{ assignedUsers: { some: { userId } } }]
          : []),
      ],
    },
    select: { id: true },
  });

  return project !== null;
}
