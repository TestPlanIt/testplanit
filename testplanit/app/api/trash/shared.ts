import { NextRequest, NextResponse } from "next/server";
import { authenticateApiTokenForMethod } from "~/lib/api-token-auth";
import { enrichFromApiAuth } from "~/lib/auditContextWrappers";
import { getServerAuthSession } from "~/server/auth";

export interface TrashActor {
  id: string;
  isAdmin: boolean;
}

/**
 * Session or API-token authentication for the user-scoped Trash routes. Unlike
 * /api/admin/trash any signed-in user may call these; the service scopes every
 * query to what that user deleted.
 */
export async function checkTrashAuth(
  request: NextRequest
): Promise<{ error?: NextResponse; actor?: TrashActor }> {
  const session = await getServerAuthSession();
  if (session?.user?.id) {
    return {
      actor: {
        id: session.user.id,
        isAdmin: session.user.access === "ADMIN",
      },
    };
  }

  const apiAuth = await authenticateApiTokenForMethod(request);
  if (!apiAuth.authenticated || !apiAuth.userId) {
    return {
      error: NextResponse.json(
        { error: apiAuth.error ?? "Unauthorized", code: apiAuth.errorCode },
        { status: apiAuth.errorCode === "READ_ONLY_TOKEN" ? 403 : 401 }
      ),
    };
  }
  // Attribute the restore's audit rows (CDC GUC actor) to the token owner.
  enrichFromApiAuth({
    userId: apiAuth.userId,
    userName: apiAuth.userName,
    userEmail: apiAuth.userEmail,
    scopes: apiAuth.scopes,
  });
  return {
    actor: { id: apiAuth.userId, isAdmin: apiAuth.access === "ADMIN" },
  };
}
