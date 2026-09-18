import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getEnhancedDb } from "~/lib/auth/utils";
import { removableStalePinsWhere } from "~/lib/services/impact/stalePinRules";
import { isAccessPolicyError } from "~/lib/utils/errors";
import { authOptions } from "~/server/auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({
  projectConfigId: z.coerce.number().int().positive(),
});

/**
 * POST /api/code-repositories/[id]/stale-pins/remove
 * Soft-delete every pin the last stale check flagged on one Impact
 * connection, except pins whose badge was dismissed and pins that
 * repository markers own. The access policy on the pins decides who may
 * remove them, so rows the caller cannot update are left in place.
 * Gate order: 401 -> 400 -> 404 (config) -> 403 (policy) -> 200.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // params.id is the repository id (for URL consistency); the config is the unit of work.
  await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "projectConfigId is required" },
      { status: 400 }
    );
  }
  const { projectConfigId: configId } = parsed.data;

  try {
    const db = await getEnhancedDb(session);
    const config = await db.projectCodeRepositoryConfig.findFirst({
      where: { id: configId, purpose: "IMPACT" },
      select: { id: true },
    });
    if (!config) {
      return NextResponse.json(
        { error: "Configuration not found" },
        { status: 404 }
      );
    }

    const result = await db.repositoryCaseCodePin.updateMany({
      where: removableStalePinsWhere(configId),
      data: { isDeleted: true, deletedAt: new Date() },
    });

    return NextResponse.json({ removed: result.count });
  } catch (error) {
    if (isAccessPolicyError(error)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error("[POST stale-pins/remove]:", error);
    return NextResponse.json(
      { error: "Failed to remove stale pins" },
      { status: 500 }
    );
  }
}
