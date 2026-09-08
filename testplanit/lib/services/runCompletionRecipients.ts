/**
 * Who may complete a given test run — the recipient set for the
 * "ready to complete" notification.
 *
 * This must agree with the completion gate (lib/services/completionGate.ts)
 * and therefore with the UI, so it resolves the same ladder rather than
 * approximating it: the candidate pool is the project's effective membership,
 * and each candidate's effective role is looked up and tested for `canClose`.
 *
 * Note this is a wider net than the review-request fanout
 * (`NotificationService.resolveRoleHolderUserIds`), which deliberately covers
 * explicit grants only. A review names a role; "who can complete this" is a
 * permission question, and a project whose default access carries a canClose
 * role genuinely does grant it to everyone. That is also why the cap below
 * exists.
 */

import { ApplicationArea } from "~/zenstack/models";
import { baseDb } from "~/lib/db";
import { resolveEligibleRoleIds } from "~/lib/services/areaPermission";
import { resolveEffectiveProjectRolesForUsers } from "~/lib/services/effectiveRole";
import { getProjectEffectiveMemberIds } from "~/lib/services/projectMembers";

/**
 * Above this the notification stops being a signal. A project configured so
 * that its default role can close runs makes every active user a recipient;
 * one row each, per run, per transition, is not worth sending. Logged rather
 * than silently truncated.
 */
export const MAX_READY_TO_COMPLETE_RECIPIENTS = 100;

export async function resolveRunCompletionRecipients(
  projectId: number
): Promise<string[]> {
  const recipients = new Set<string>();

  // 1. Roles that carry canClose on TestRuns at all. Tiny table; when nothing
  //    carries it, the whole role-derived branch is empty by construction.
  const closerRoleIds = await resolveEligibleRoleIds(
    ApplicationArea.TestRuns,
    "canClose"
  );

  if (closerRoleIds.size > 0) {
    const candidates = await getProjectEffectiveMemberIds(projectId);
    if (candidates.length > 0) {
      const roleByUser = await resolveEffectiveProjectRolesForUsers(
        candidates,
        projectId,
        baseDb
      );
      for (const [userId, roleId] of roleByUser) {
        if (roleId != null && closerRoleIds.has(roleId)) {
          recipients.add(userId);
        }
      }
    }
  }

  // 2. The system-access override: ADMIN unconditionally, PROJECTADMIN unless
  //    this project denies them.
  const [admins, project] = await Promise.all([
    baseDb.user.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        access: { in: ["ADMIN", "PROJECTADMIN"] },
      },
      select: { id: true, access: true },
    }),
    baseDb.projects.findUnique({
      where: { id: projectId },
      select: { defaultAccessType: true },
    }),
  ]);

  const projectAdminIds = admins
    .filter((u) => u.access === "PROJECTADMIN")
    .map((u) => u.id);

  const deniedProjectAdminIds = new Set(
    projectAdminIds.length === 0
      ? []
      : (
          await baseDb.userProjectPermission.findMany({
            where: {
              projectId,
              userId: { in: projectAdminIds },
              accessType: "NO_ACCESS",
            },
            select: { userId: true },
          })
        ).map((r) => r.userId)
  );

  const projectDeniesByDefault = project?.defaultAccessType === "NO_ACCESS";

  for (const user of admins) {
    if (user.access === "ADMIN") {
      recipients.add(user.id);
    } else if (!projectDeniesByDefault && !deniedProjectAdminIds.has(user.id)) {
      recipients.add(user.id);
    }
  }

  if (recipients.size > MAX_READY_TO_COMPLETE_RECIPIENTS) {
    console.warn(
      `[runReadyToComplete] project ${projectId} resolved ${recipients.size} recipients (cap ${MAX_READY_TO_COMPLETE_RECIPIENTS}); skipping the notification. The project's default access grants canClose on Test Runs broadly.`
    );
    return [];
  }

  return Array.from(recipients);
}
