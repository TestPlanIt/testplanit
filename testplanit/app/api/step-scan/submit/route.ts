import { getCurrentTenantId } from "@/lib/multiTenantPrisma";
import { enhance } from "@zenstackhq/runtime";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "~/lib/prisma";
import { getStepScanQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import { type StepScanJobData } from "~/workers/stepSequenceScanWorker";

const submitSchema = z.object({
  projectId: z.number().int().positive(),
  folderId: z.number().int().positive().optional(),
  minSteps: z.number().int().min(2).max(20).default(3),
});

export async function POST(request: Request) {
  // 1. Auth
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate request body
  let body: z.output<typeof submitSchema>;
  try {
    const raw = await request.json();
    const parsed = submitSchema.safeParse(raw);
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

  // 3. Queue check
  const queue = getStepScanQueue();
  if (!queue) {
    return NextResponse.json(
      { error: "Background job queue is not available" },
      { status: 503 },
    );
  }

  try {
    // 4. User fetch + enhance for access control
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { role: { include: { rolePermissions: true } } },
    });

    const enhancedDb = enhance(db, { user: user ?? undefined });

    // 5. Project access check (ZenStack policy handles permission)
    const project = await enhancedDb.projects.findFirst({
      where: { id: body.projectId },
    });
    if (!project) {
      return NextResponse.json(
        { error: "No access to project" },
        { status: 403 },
      );
    }

    // 6. If folderId provided: validate it belongs to the project
    if (body.folderId !== undefined) {
      const folder = await enhancedDb.repositoryFolders.findFirst({
        where: { id: body.folderId, projectId: body.projectId, isDeleted: false },
      });
      if (!folder) {
        return NextResponse.json(
          { error: "Folder not found in project" },
          { status: 404 },
        );
      }
    }

    // 7. Enqueue the step-scan job
    const jobData: StepScanJobData = {
      projectId: body.projectId,
      folderId: body.folderId,
      minSteps: body.minSteps,
      userId: session.user.id,
      tenantId: getCurrentTenantId(),
    };

    const job = await queue.add("step-scan", jobData);

    // 8. Return jobId with 202 Accepted
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  } catch (error) {
    console.error("[step-scan/submit] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
