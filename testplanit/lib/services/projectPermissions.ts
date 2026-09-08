import type { ApplicationArea } from "~/zenstack/models";
import { baseDb } from "~/lib/db";
import { resolveEffectiveProjectRoleId } from "~/lib/services/effectiveRole";

/**
 * Does `user` have `canAddEdit` for `area` on `project`?
 *
 * Builds on the canonical effective-role ladder
 * (`resolveEffectiveProjectRoleId`, the single source of truth also used by
 * `/api/get-user-permissions`) and layers the same system-role short-circuits:
 * system ADMIN gets full permissions everywhere; system PROJECTADMIN gets full
 * permissions on any project they can access (i.e. that resolves to a role —
 * explicit NO_ACCESS resolves to null and is denied).
 *
 * Read-only; the caller is responsible for having authenticated the user.
 */
export async function userCanAddEditArea(
  userId: string,
  projectId: number,
  area: ApplicationArea,
  userAccess: string | null | undefined
): Promise<boolean> {
  if (userAccess === "ADMIN") return true;

  const roleId = await resolveEffectiveProjectRoleId(userId, projectId, baseDb);
  // NO_ACCESS (or no resolvable role) → no edit access, even for PROJECTADMIN.
  if (roleId == null) return false;
  // System PROJECTADMINs have full permissions on projects they can access.
  if (userAccess === "PROJECTADMIN") return true;

  const role = await baseDb.roles.findUnique({
    where: { id: roleId },
    select: {
      rolePermissions: { where: { area }, select: { canAddEdit: true } },
    },
  });
  return role?.rolePermissions[0]?.canAddEdit ?? false;
}
