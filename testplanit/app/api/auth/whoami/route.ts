/**
 * GET /api/auth/whoami — identity probe (SRV-04)
 *
 * Resolves the caller's identity from a session cookie OR a Bearer API token,
 * then returns the canonical 6-field shape consumed by the MCP server's
 * `validateToken` bootstrap probe and the `whoami` MCP tool.
 *
 * The endpoint is justified outside the "ZenStack hooks first" preference
 * because no ZenStack hook resolves "the current user from a Bearer token" —
 * the caller does not know its own user id (it only holds the token).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  authenticateApiToken,
  isMcpClient,
  isReadOnly,
} from "~/lib/api-token-auth";
import {
  enrichFromApiAuth,
  withAuditContext,
} from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";

export const GET = withAuditContext(async (request: NextRequest) => {
  try {
    const session = await getServerAuthSession();
    let userId: string | undefined = session?.user?.id;
    let scopes: string[] = [];

    if (!userId) {
      const apiAuth = await authenticateApiToken(request);
      if (!apiAuth.authenticated) {
        return NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        );
      }
      userId = apiAuth.userId;
      scopes = apiAuth.scopes ?? [];
      enrichFromApiAuth({
        userId: apiAuth.userId!,
        scopes: apiAuth.scopes,
      });
    }

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      scopes,
      readOnly: isReadOnly(scopes),
      isAgent: isMcpClient(scopes),
    });
  } catch (error: any) {
    console.error("Error fetching whoami:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
});
