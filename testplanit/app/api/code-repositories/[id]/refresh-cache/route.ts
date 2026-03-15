import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import {
  refreshRepoCache,
  refreshRepoCacheContentsOnly
} from "~/lib/services/repoCacheRefreshService";
import { authOptions } from "~/server/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { access: true },
    });

    if (
      !user?.access ||
      !["ADMIN", "PROJECTADMIN"].includes(user.access)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // params.id is the repository id (for URL consistency), but we operate on the config
    await params; // consume params to avoid Next.js warning

    const body = await req.json();
    const { projectConfigId, step = "all" } = body;

    if (!projectConfigId) {
      return NextResponse.json(
        { error: "projectConfigId is required" },
        { status: 400 }
      );
    }

    const configId = parseInt(projectConfigId);

    if (step === "contents-only") {
      const result = await refreshRepoCacheContentsOnly(
        configId,
        prisma as any
      );
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }
      return NextResponse.json(result);
    }

    // step === "list-only" is no longer a separate code path — we always do a
    // full refresh via the shared service.  The "list-only" step was only used
    // by the UI as an intermediate preview, and the shared service always
    // fetches both list + contents in one pass (matching step=all behavior).
    const result = await refreshRepoCache(configId, prisma as any);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.error === "File caching is disabled for this project" ? 400 : 500 }
      );
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("[POST refresh-cache]:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
