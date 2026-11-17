"use server";

import { ApplicationArea } from "~/zenstack/models";
import {
  areaPermissionsFrom,
  resolveEffectiveProjectAccess,
} from "~/lib/services/areaPermission";
import { getServerAuthSession } from "~/server/auth";

export interface AlertProjectPermission {
  /** May create alerts in the project (Alerts Add/Edit, or project admin). */
  canCreate: boolean;
  /** May edit or delete any alert in the project and manage other people's subscriptions. */
  isProjectAdmin: boolean;
}

/**
 * The current user's alert permissions on each of `projectIds`, resolved
 * through the same ladder the policies use. The Alerts page asks once for
 * every project it shows instead of one hook per row.
 */
export async function getAlertProjectPermissions(
  projectIds: number[]
): Promise<Record<number, AlertProjectPermission>> {
  const session = await getServerAuthSession();
  const userId = session?.user?.id;
  const result: Record<number, AlertProjectPermission> = {};
  if (!userId) return result;

  const unique = [...new Set(projectIds.filter((id) => Number.isInteger(id)))];
  await Promise.all(
    unique.map(async (projectId) => {
      const access = await resolveEffectiveProjectAccess(userId, projectId);
      const isProjectAdmin =
        access.isSystemAdmin ||
        access.isProjectAdmin ||
        (access.isSystemProjectAdmin && !access.accessDenied);
      const area = areaPermissionsFrom(access, ApplicationArea.Alerts);
      result[projectId] = {
        canCreate: isProjectAdmin || area.canAddEdit,
        isProjectAdmin,
      };
    })
  );
  return result;
}
