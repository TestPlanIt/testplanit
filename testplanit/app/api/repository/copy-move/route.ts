import { getCurrentTenantId } from "@/lib/multiTenantPrisma";
import { enhance } from "@zenstackhq/runtime";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { prisma } from "~/lib/prisma";
import { getCopyMoveQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import { submitSchema } from "./schemas";

export async function POST(request: Request) {
  // 1. Auth
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate request body
  let body: ReturnType<typeof submitSchema.parse>;
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
  const queue = getCopyMoveQueue();
  if (!queue) {
    return NextResponse.json(
      { error: "Background job queue is not available" },
      { status: 503 },
    );
  }

  try {
    // 4. User fetch + enhance
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { role: { include: { rolePermissions: true } } },
    });

    const enhancedDb = enhance(db, { user: user ?? undefined });

    // 5. Source access check
    const sourceProject = await enhancedDb.projects.findFirst({
      where: { id: body.sourceProjectId },
    });
    if (!sourceProject) {
      return NextResponse.json(
        { error: "No access to source project" },
        { status: 403 },
      );
    }

    // 6. Target access check
    const targetProject = await enhancedDb.projects.findFirst({
      where: { id: body.targetProjectId },
    });
    if (!targetProject) {
      return NextResponse.json(
        { error: "No write access to target project" },
        { status: 403 },
      );
    }

    // 7. Move update check (move = soft-delete = update permission needed)
    if (body.operation === "move") {
      let hasSourceUpdateAccess = false;
      if (user?.access === "ADMIN") {
        hasSourceUpdateAccess = true;
      } else {
        const userPerms = user?.role?.rolePermissions?.find(
          (p: any) => p.area === "TestCaseRepository"
        );
        hasSourceUpdateAccess = userPerms?.canAddEdit ?? false;
      }
      if (!hasSourceUpdateAccess) {
        return NextResponse.json(
          {
            error:
              "No update access on source project for move operation (soft-delete requires edit permission)",
          },
          { status: 403 },
        );
      }
    }

    // 8. Admin/project-admin auto-assign templates
    if (body.autoAssignTemplates) {
      const canAutoAssign =
        user?.access === "ADMIN" || user?.access === "PROJECTADMIN";

      if (canAutoAssign) {
        // Fetch current target template assignments
        const targetTemplateAssignments =
          await enhancedDb.templateProjectAssignment.findMany({
            where: { projectId: body.targetProjectId },
          });

        const targetTemplateIdSet = new Set(
          targetTemplateAssignments.map(
            (a: { templateId: number }) => a.templateId,
          ),
        );

        // Fetch unique templateIds from source cases
        const sourceCases = await enhancedDb.repositoryCases.findMany({
          where: {
            id: { in: body.caseIds },
            projectId: body.sourceProjectId,
          },
          select: { templateId: true },
        });

        const uniqueSourceTemplateIds = [
          ...new Set(
            sourceCases.map((c: { templateId: number }) => c.templateId),
          ),
        ];

        const missingTemplateIds = uniqueSourceTemplateIds.filter(
          (id) => !targetTemplateIdSet.has(id),
        );

        // Create missing assignments (wrap each in try/catch — ZenStack may reject project admins without project access)
        for (const templateId of missingTemplateIds) {
          try {
            await enhancedDb.templateProjectAssignment.create({
              data: { templateId, projectId: body.targetProjectId },
            });
          } catch (err) {
            console.warn(
              "[copy-move/submit] auto-assign templateProjectAssignment failed, continuing:",
              err,
            );
          }
        }
      }
      // If user has neither ADMIN nor PROJECTADMIN access, skip silently
    }

    // 9. Resolve targetRepositoryId
    let resolvedTargetRepositoryId = body.targetRepositoryId;
    if (!resolvedTargetRepositoryId) {
      const targetRepository = await enhancedDb.repositories.findFirst({
        where: {
          projectId: body.targetProjectId,
          isActive: true,
          isDeleted: false,
        },
      });
      if (!targetRepository) {
        return NextResponse.json(
          { error: "No active repository found in target project" },
          { status: 400 },
        );
      }
      resolvedTargetRepositoryId = targetRepository.id;
    }

    // 10. Resolve targetDefaultWorkflowStateId
    let resolvedTargetDefaultWorkflowStateId =
      body.targetDefaultWorkflowStateId;
    if (!resolvedTargetDefaultWorkflowStateId) {
      const targetWorkflowAssignments =
        await enhancedDb.projectWorkflowAssignment.findMany({
          where: { projectId: body.targetProjectId },
          include: {
            workflow: { select: { id: true, isDefault: true } },
          },
        });

      const defaultWorkflow = targetWorkflowAssignments.find(
        (a: { workflow: { isDefault: boolean } }) => a.workflow.isDefault,
      );
      const fallbackWorkflow = targetWorkflowAssignments[0];

      const resolvedWorkflow = defaultWorkflow ?? fallbackWorkflow;
      if (!resolvedWorkflow) {
        return NextResponse.json(
          { error: "No default workflow state found in target project" },
          { status: 400 },
        );
      }
      resolvedTargetDefaultWorkflowStateId = resolvedWorkflow.workflow.id;
    }

    // 11. Resolve targetTemplateId
    let resolvedTargetTemplateId = body.targetTemplateId;
    if (!resolvedTargetTemplateId) {
      const targetTemplateAssignments =
        await enhancedDb.templateProjectAssignment.findMany({
          where: { projectId: body.targetProjectId },
        });

      if (!targetTemplateAssignments[0]) {
        return NextResponse.json(
          { error: "No template assignment found in target project" },
          { status: 400 },
        );
      }
      resolvedTargetTemplateId = targetTemplateAssignments[0].templateId;
    }

    // 12. Enqueue job
    const jobData = {
      operation: body.operation,
      caseIds: body.caseIds,
      sourceProjectId: body.sourceProjectId,
      targetProjectId: body.targetProjectId,
      targetRepositoryId: resolvedTargetRepositoryId,
      targetFolderId: body.targetFolderId,
      conflictResolution: body.conflictResolution,
      sharedStepGroupResolution: body.sharedStepGroupResolution,
      userId: session.user.id,
      targetTemplateId: resolvedTargetTemplateId,
      targetDefaultWorkflowStateId: resolvedTargetDefaultWorkflowStateId,
      tenantId: getCurrentTenantId(),
      folderTree: body.folderTree,
    };

    const job = await queue.add("copy-move", jobData);

    // 13. Return jobId
    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    console.error("[copy-move/submit] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
