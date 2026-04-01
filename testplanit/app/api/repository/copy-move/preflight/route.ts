import { enhance } from "@zenstackhq/runtime";
import { RepositoryCaseSource } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { prisma } from "~/lib/prisma";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import { preflightSchema, type PreflightResponse } from "../schemas";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ReturnType<typeof preflightSchema.parse>;
  try {
    const raw = await request.json();
    const parsed = preflightSchema.safeParse(raw);
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
    // Fetch full user for enhance
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { role: { include: { rolePermissions: true } } },
    });

    const enhancedDb = enhance(db, { user: user ?? undefined });

    // Source access check
    const sourceProject = await enhancedDb.projects.findFirst({
      where: { id: body.sourceProjectId },
    });
    if (!sourceProject) {
      return NextResponse.json(
        { error: "No access to source project" },
        { status: 403 },
      );
    }

    // Target access check
    const targetProject = await enhancedDb.projects.findFirst({
      where: { id: body.targetProjectId },
    });
    if (!targetProject) {
      return NextResponse.json(
        { error: "No write access to target project" },
        { status: 403 },
      );
    }

    // Fetch source cases first (needed for move check and compat analysis)
    // Note: findMany uses ZenStack read policy — if user can't read, no cases returned
    const sourceCases = await enhancedDb.repositoryCases.findMany({
      where: {
        id: { in: body.caseIds },
        projectId: body.sourceProjectId,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        className: true,
        source: true,
        templateId: true,
        stateId: true,
      },
    });

    // Move update-access check (move = soft-delete via isDeleted: true = needs update permission)
    // Since the worker uses raw prisma, we verify the user's role permits canAddEdit on TestCaseRepository.
    // Admin users always have access.
    let hasSourceUpdateAccess = true;
    if (body.operation === "move") {
      if (user?.access === "ADMIN") {
        hasSourceUpdateAccess = true;
      } else {
        const userPerms = user?.role?.rolePermissions?.find(
          (p: any) => p.area === "TestCaseRepository"
        );
        hasSourceUpdateAccess = userPerms?.canAddEdit ?? false;
      }
    }

    // ─── Template compatibility ────────────────────────────────────────────────

    const uniqueSourceTemplateIds = [
      ...new Set(sourceCases.map((c: { templateId: number }) => c.templateId)),
    ];

    const targetTemplateAssignments =
      await enhancedDb.templateProjectAssignment.findMany({
        where: { projectId: body.targetProjectId },
        include: { template: { select: { id: true, templateName: true } } },
      });

    const targetTemplateIds = new Set(
      targetTemplateAssignments.map(
        (a: { templateId: number }) => a.templateId,
      ),
    );

    const missingTemplateIds = uniqueSourceTemplateIds.filter(
      (id) => !targetTemplateIds.has(id),
    );

    // Fetch actual template names for missing IDs
    const missingTemplateRecords = missingTemplateIds.length > 0
      ? await enhancedDb.templates.findMany({
          where: { id: { in: missingTemplateIds } },
          select: { id: true, templateName: true },
        })
      : [];
    const templateNameMap = new Map(
      missingTemplateRecords.map((t: { id: number; templateName: string }) => [t.id, t.templateName]),
    );
    const missingTemplates = missingTemplateIds.map((id: number) => ({
      id,
      name: templateNameMap.get(id) ?? `Template ${id}`,
    }));

    const templateMismatch = missingTemplates.length > 0;
    const canAutoAssignTemplates =
      user?.access === "ADMIN" || user?.access === "PROJECTADMIN";

    // ─── Workflow state mapping ───────────────────────────────────────────────

    const uniqueSourceStateIds = [
      ...new Set(
        sourceCases.map((c: { stateId: number }) => c.stateId),
      ),
    ];

    const targetWorkflowAssignments =
      await enhancedDb.projectWorkflowAssignment.findMany({
        where: { projectId: body.targetProjectId },
        include: {
          workflow: { select: { id: true, name: true, isDefault: true } },
        },
      });

    const targetWorkflows = targetWorkflowAssignments.map(
      (a: { workflow: { id: number; name: string; isDefault: boolean } }) =>
        a.workflow,
    );

    const targetWorkflowByName = new Map<
      string,
      { id: number; name: string; isDefault: boolean }
    >();
    for (const wf of targetWorkflows) {
      targetWorkflowByName.set(wf.name.toLowerCase(), wf);
    }

    const defaultTargetWorkflow = targetWorkflows.find(
      (wf: { isDefault: boolean }) => wf.isDefault,
    ) ?? targetWorkflows[0] ?? { id: 0, name: "Unknown", isDefault: true };

    // We need source state names — fetch from the source project's workflow assignments
    const sourceWorkflowAssignments =
      await enhancedDb.projectWorkflowAssignment.findMany({
        where: { projectId: body.sourceProjectId },
        include: {
          workflow: { select: { id: true, name: true, isDefault: true } },
        },
      });

    const sourceWorkflowById = new Map<
      number,
      { id: number; name: string; isDefault: boolean }
    >();
    for (const a of sourceWorkflowAssignments) {
      sourceWorkflowById.set(a.workflow.id, a.workflow);
    }

    const workflowMappings: PreflightResponse["workflowMappings"] = [];
    const unmappedStates: PreflightResponse["unmappedStates"] = [];

    for (const stateId of uniqueSourceStateIds) {
      const sourceState = sourceWorkflowById.get(stateId);
      const sourceStateName = sourceState?.name ?? `State ${stateId}`;

      const nameMatch = targetWorkflowByName.get(sourceStateName.toLowerCase());
      if (nameMatch) {
        workflowMappings.push({
          sourceStateId: stateId,
          sourceStateName,
          targetStateId: nameMatch.id,
          targetStateName: nameMatch.name,
          isDefaultFallback: false,
        });
      } else {
        workflowMappings.push({
          sourceStateId: stateId,
          sourceStateName,
          targetStateId: defaultTargetWorkflow.id,
          targetStateName: defaultTargetWorkflow.name,
          isDefaultFallback: true,
        });
        unmappedStates.push({ id: stateId, name: sourceStateName });
      }
    }

    // ─── Collision detection ──────────────────────────────────────────────────

    const sourceNames = sourceCases.map(
      (c: any) => ({
        name: c.name as string,
        className: c.className as string | null,
        source: c.source as RepositoryCaseSource,
      }),
    );

    // Use prisma directly for collision detection — access is already verified above
    // and ZenStack's enhanced DB can have issues matching null fields in OR clauses
    const collisionCases = await prisma.repositoryCases.findMany({
      where: {
        projectId: body.targetProjectId,
        isDeleted: false,
        OR: sourceNames.map((n) => ({
          name: n.name,
          ...(n.className === null ? {} : { className: n.className }),
          source: n.source,
        })),
      },
      select: { id: true, name: true, className: true, source: true },
    });

    const collisions: PreflightResponse["collisions"] = collisionCases.map(
      (c: {
        id: number;
        name: string;
        className: string | null;
        source: string;
      }) => ({
        caseId: c.id,
        caseName: c.name,
        className: c.className,
        source: c.source,
      }),
    );

    // ─── Resolve target repository ────────────────────────────────────────────

    const targetRepository = await enhancedDb.repositories.findFirst({
      where: {
        projectId: body.targetProjectId,
        isActive: true,
        isDeleted: false,
      },
    });

    const targetRepositoryId = targetRepository?.id ?? 0;

    // ─── Resolve target template ID ───────────────────────────────────────────
    // Use first target template assignment, or first source template if all match

    const targetTemplateId =
      targetTemplateAssignments[0]?.templateId ??
      uniqueSourceTemplateIds[0] ??
      0;

    // ─── Resolve target default workflow state ID ─────────────────────────────

    const targetDefaultWorkflowStateId = defaultTargetWorkflow.id;

    const response: PreflightResponse = {
      hasSourceReadAccess: true,
      hasTargetWriteAccess: true,
      hasSourceUpdateAccess,
      templateMismatch,
      missingTemplates,
      canAutoAssignTemplates,
      workflowMappings,
      unmappedStates,
      collisions,
      targetRepositoryId,
      targetDefaultWorkflowStateId,
      targetTemplateId,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[preflight] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
