import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "~/lib/api-token-auth";
import { getServerAuthSession } from "~/server/auth";

/** Admin session or an admin's API token. */
export async function requireArchiveAdmin(
  request: NextRequest
): Promise<
  | { ok: true; userId: string; userEmail?: string; userName?: string }
  | { ok: false; response: NextResponse }
> {
  const session = await getServerAuthSession();
  const auth = await authenticateRequest(request, session);
  if (!auth.authenticated) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: auth.error, code: auth.errorCode },
        { status: auth.status }
      ),
    };
  }
  if (auth.user.access !== "ADMIN") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      ),
    };
  }
  return {
    ok: true,
    userId: auth.user.userId,
    userEmail: session?.user?.email ?? undefined,
    userName: session?.user?.name ?? undefined,
  };
}
