import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";
import {
  authenticateApiTokenForMethod,
  extractBearerToken,
} from "~/lib/api-token-auth";
import { enrichFromApiAuth } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";
import { ProjectAccessType } from "~/zenstack/models";

/**
 * Session-or-token authorization for a project-scoped API route.
 *
 * Mirrors the ZenStack RPC handler the MCP server already calls: session
 * first, then a Bearer token whose `mode:read` scope is enforced against the
 * request method, so a read-only token can't reach a write route. Project
 * access then follows the same ladder the RPC policies encode.
 *
 * Extracted from the bulk-create route when the issue-key resolve route
 * needed the identical policy; both reach it through the same MCP token.
 */

export interface ProjectApiActor {
  userId: string;
  userName?: string;
  userEmail?: string;
  access?: string | null;
  scopes?: string[];
}

export type ProjectApiAuthResult =
  | {
      ok: true;
      actor: ProjectApiActor;
      project: { id: number; name: string };
    }
  | { ok: false; status: number; body: { error: string; code?: string } };

export async function authorizeProjectApiRequest(
  request: NextRequest,
  projectId: number
): Promise<ProjectApiAuthResult> {
  const session = await getServerSession(authOptions);
  let userId: string | undefined = session?.user?.id;
  let userName: string | undefined = session?.user?.name ?? undefined;
  let userEmail: string | undefined = session?.user?.email ?? undefined;
  let userAccess: string | null | undefined = session?.user?.access;
  let tokenScopes: string[] | undefined;

  if (!userId) {
    const token = extractBearerToken(request);
    if (!token) {
      return { ok: false, status: 401, body: { error: "Unauthorized" } };
    }
    const apiAuth = await authenticateApiTokenForMethod(request);
    if (!apiAuth.authenticated) {
      return {
        ok: false,
        status: apiAuth.errorCode === "READ_ONLY_TOKEN" ? 403 : 401,
        body: {
          error: apiAuth.error ?? "Unauthorized",
          ...(apiAuth.errorCode ? { code: apiAuth.errorCode } : {}),
        },
      };
    }
    userId = apiAuth.userId;
    userAccess = apiAuth.access;
    tokenScopes = apiAuth.scopes;
    const user = await baseDb.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });
    userName = user?.name ?? undefined;
    userEmail = user?.email ?? undefined;
  }

  if (!userId) {
    return { ok: false, status: 401, body: { error: "Unauthorized" } };
  }

  // Attribute downstream audit hooks to the authenticated actor.
  enrichFromApiAuth({ userId, userEmail, userName, scopes: tokenScopes });

  const isAdmin = userAccess === "ADMIN";
  const isProjectAdmin = userAccess === "PROJECTADMIN";
  const projectAccessWhere = isAdmin
    ? { id: projectId, isDeleted: false }
    : {
        id: projectId,
        isDeleted: false,
        OR: [
          {
            userPermissions: {
              some: {
                userId,
                accessType: { not: ProjectAccessType.NO_ACCESS },
              },
            },
          },
          {
            groupPermissions: {
              some: {
                group: { assignedUsers: { some: { userId } } },
                accessType: { not: ProjectAccessType.NO_ACCESS },
              },
            },
          },
          { defaultAccessType: ProjectAccessType.GLOBAL_ROLE },
          ...(isProjectAdmin ? [{ assignedUsers: { some: { userId } } }] : []),
        ],
      };

  const project = await baseDb.projects.findFirst({
    where: projectAccessWhere,
    select: { id: true, name: true },
  });
  if (!project) {
    return {
      ok: false,
      status: 404,
      body: { error: "Project not found or access denied" },
    };
  }

  return {
    ok: true,
    actor: {
      userId,
      userName,
      userEmail,
      access: userAccess,
      scopes: tokenScopes,
    },
    project,
  };
}
