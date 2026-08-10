"use server";

import { ApplicationArea, ProjectAccessType } from "~/zenstack/models";
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  areaPermissionsFrom,
  hasProjectAccess,
  resolveEffectiveProjectAccess,
  type AreaPermissions,
} from "~/lib/services/areaPermission";
import { authorizeProjectAdminForProject } from "~/lib/integrations/importAuthorization";
import { getServerAuthSession } from "~/server/auth";

// Define the input schema using Zod
const PermissionCheckSchema = z.object({
  userId: z.string().min(1),
  projectId: z.int().positive(),
  area: z.nativeEnum(ApplicationArea).optional(),
  checkAccessOnly: z.boolean().optional(), // New flag to only check if user has project access
});

export async function POST(request: Request) {
  // CR-02 fix: require an authenticated caller and refuse to disclose
  // another user's effective role unless the caller is a system ADMIN.
  // The endpoint returns a user's effective project role + access type;
  // without this gate, anyone reachable to the route could iterate
  // (userId, projectId) pairs to enumerate the org's role assignments.
  // The two in-tree callers (`useProjectPermissions`,
  // `useEffectiveRoleOnProject`) only ever pass their own `session.user.id`
  // for `userId`, so this restriction is invisible to them in normal use.
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validationResult = PermissionCheckSchema.safeParse(data);

  if (!validationResult.success) {
    return NextResponse.json(
      {
        error: "Invalid input",
        details: z.treeifyError(validationResult.error),
      },
      { status: 400 }
    );
  }

  const { userId, projectId, area, checkAccessOnly } = validationResult.data;

  const callerIsAdmin = session.user.access === "ADMIN";
  if (!callerIsAdmin && session.user.id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // The precedence ladder itself lives in lib/services/areaPermission.ts so
    // that server-side gates enforcing what this endpoint reports (e.g. the
    // completion gate in app/api/model/[...path]/route.ts) resolve access the
    // same way by construction rather than by a second hand-written copy.
    const resolution = await resolveEffectiveProjectAccess(userId, projectId);

    if (!resolution.resolved) {
      return NextResponse.json(
        { error: "User or project not found" },
        { status: 404 }
      );
    }

    const {
      isSystemAdmin,
      isSystemProjectAdmin,
      effectiveRole,
      userAccessType,
      groupAccessType,
      projectDefaultAccessType,
    } = resolution;

    const resultData: AreaPermissions | Record<string, AreaPermissions> = area
      ? areaPermissionsFrom(resolution, area)
      : Object.fromEntries(
          Object.values(ApplicationArea).map((enumArea) => [
            enumArea,
            areaPermissionsFrom(resolution, enumArea),
          ])
        );

    // Numeric effective-role id for UI gating predicates that need the role
    // pointer (e.g. review action panel role-holder match). Null for system
    // admins (they don't hold a project role) and for access-denied users.
    const effectiveRoleId = effectiveRole?.id ?? null;

    // 4. Return Result
    // If checkAccessOnly is true, just return whether the user has access
    if (checkAccessOnly) {
      return NextResponse.json({
        hasAccess: hasProjectAccess(resolution),
        effectiveRole: isSystemAdmin
          ? "System Admin"
          : isSystemProjectAdmin
            ? "System Project Admin"
            : effectiveRole?.name || null,
        effectiveRoleId,
        accessType: isSystemAdmin
          ? "SYSTEM_ADMIN"
          : isSystemProjectAdmin
            ? "SYSTEM_PROJECTADMIN"
            : userAccessType ||
              groupAccessType ||
              (projectDefaultAccessType === ProjectAccessType.GLOBAL_ROLE
                ? "GLOBAL_ROLE"
                : projectDefaultAccessType === ProjectAccessType.SPECIFIC_ROLE
                  ? "SPECIFIC_ROLE"
                  : "NO_ACCESS"),
      });
    }

    // Otherwise return the detailed permissions
    const isProjectAdminResult = await authorizeProjectAdminForProject(
      session,
      projectId
    );

    return NextResponse.json({
      hasAccess: hasProjectAccess(resolution),
      effectiveRole: isSystemAdmin
        ? "System Admin"
        : isSystemProjectAdmin
          ? "System Project Admin"
          : effectiveRole?.name || null,
      effectiveRoleId,
      permissions: resultData,
      isProjectAdmin: isProjectAdminResult.ok,
    });
  } catch (error) {
    console.error("Error fetching permissions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
