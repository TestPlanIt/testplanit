import { getCurrentTenantId } from "@/lib/multiTenantPrisma";
import { enhance } from "@zenstackhq/runtime";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "~/lib/prisma";
import { convertMatch } from "~/lib/services/stepSequenceConversionService";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";

const editedStepSchema = z.object({
  step: z.string().nullable(),
  expectedResult: z.string().nullable(),
});

const convertSchema = z.object({
  matchId: z.number().int().positive(),
  sharedStepGroupName: z.string().min(1).max(255).trim(),
  affectedCaseIds: z.array(z.number().int().positive()).min(1).max(500),
  editedSteps: z.array(editedStepSchema).optional(),
});

export async function POST(request: Request) {
  // 1. Auth
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate request body
  let body: z.output<typeof convertSchema>;
  try {
    const raw = await request.json();
    const parsed = convertSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    // 3. User fetch + enhance for access control
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { role: { include: { rolePermissions: true } } },
    });

    getCurrentTenantId();
    const enhancedDb = enhance(db, { user: user ?? undefined });

    // 4. Load match via enhanced DB (ZenStack policy enforces read access)
    const match = await enhancedDb.stepSequenceMatch.findUnique({
      where: { id: body.matchId },
    });
    if (!match) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    // 5. Security check (CRITICAL): validate all affectedCaseIds belong to the match's project
    const cases = await enhancedDb.repositoryCases.findMany({
      where: {
        id: { in: body.affectedCaseIds },
        projectId: match.projectId,
        isDeleted: false,
      },
      select: { id: true },
    });

    if (cases.length !== body.affectedCaseIds.length) {
      return NextResponse.json(
        { error: "One or more case IDs do not belong to this project" },
        { status: 403 },
      );
    }

    // 6. Write permission check: ensure user has access to the project
    // ZenStack policies on projects.findFirst enforce this
    const project = await enhancedDb.projects.findFirst({
      where: { id: match.projectId },
    });
    if (!project) {
      return NextResponse.json(
        { error: "No access to project" },
        { status: 403 },
      );
    }

    // 7. Perform atomic conversion
    const result = await convertMatch(
      body.matchId,
      body.sharedStepGroupName,
      body.affectedCaseIds,
      session.user.id,
      body.editedSteps,
    );

    // 8. Return result with sharedStepGroupId for UI linking (CONV-05)
    return NextResponse.json({
      sharedStepGroupId: result.sharedStepGroupId,
      convertedCaseIds: result.convertedCaseIds,
      skippedCaseIds: result.skippedCaseIds,
    });
  } catch (error) {
    console.error("[step-scan/convert] error:", error);
    return NextResponse.json(
      {
        error: "Conversion failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
