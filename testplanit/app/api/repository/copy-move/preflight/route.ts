import { getAuthDb } from "~/lib/zenstack";
import { RepositoryCaseSource } from "~/zenstack/models";
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
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    // Fetch full user for access decisions and enhance
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { role: { include: { rolePermissions: true } } },
    });

    const isAdmin = user?.access === "ADMIN";

    // Pick the read client up-front: admins use raw prisma so reads are
    // deterministic — the policy layer has been observed to return no rows
    // under heavy parallel load even though @@allow('all', auth().access ==
    // 'ADMIN') is unconditional. Non-admin requests stay on the enhanced
    // client so per-model policies (which can be stricter than the
    // project-level policy alone) are enforced.
    const reader = isAdmin
      ? prisma
      : (getAuthDb(user ?? undefined) as unknown as typeof prisma);

    // Project access checks
    const sourceProject = await reader.projects.findFirst({
      where: isAdmin
        ? { id: body.sourceProjectId, isDeleted: false }
        : { id: body.sourceProjectId },
      select: { id: true },
    });
    if (!sourceProject) {
      return NextResponse.json(
        { error: "No access to source project" },
        { status: 403 }
      );
    }
    const targetProject = await reader.projects.findFirst({
      where: isAdmin
        ? { id: body.targetProjectId, isDeleted: false }
        : { id: body.targetProjectId },
      select: { id: true },
    });
    if (!targetProject) {
      return NextResponse.json(
        { error: "No write access to target project" },
        { status: 403 }
      );
    }

    const sourceCaseSelect = {
      id: true,
      name: true,
      className: true,
      source: true,
      templateId: true,
      stateId: true,
    } as const;
    const sourceCases = await reader.repositoryCases.findMany({
      where: {
        id: { in: body.caseIds },
        projectId: body.sourceProjectId,
        isDeleted: false,
      },
      select: sourceCaseSelect,
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
      await reader.templateProjectAssignment.findMany({
        where: { projectId: body.targetProjectId },
        include: { template: { select: { id: true, templateName: true } } },
      });

    const targetTemplateIds = new Set(
      targetTemplateAssignments.map((a: { templateId: number }) => a.templateId)
    );

    const missingTemplateIds = uniqueSourceTemplateIds.filter(
      (id) => !targetTemplateIds.has(id)
    );

    // Fetch actual template names for missing IDs
    const missingTemplateRecords =
      missingTemplateIds.length > 0
        ? await reader.templates.findMany({
            where: { id: { in: missingTemplateIds } },
            select: { id: true, templateName: true },
          })
        : [];
    const templateNameMap = new Map(
      missingTemplateRecords.map((t: { id: number; templateName: string }) => [
        t.id,
        t.templateName,
      ])
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
      ...new Set(sourceCases.map((c: { stateId: number }) => c.stateId)),
    ];

    const targetWorkflowAssignments =
      await reader.projectWorkflowAssignment.findMany({
        where: { projectId: body.targetProjectId },
        include: {
          workflow: { select: { id: true, name: true, isDefault: true } },
        },
      });

    const targetWorkflows = targetWorkflowAssignments.map(
      (a: { workflow: { id: number; name: string; isDefault: boolean } }) =>
        a.workflow
    );

    const targetWorkflowByName = new Map<
      string,
      { id: number; name: string; isDefault: boolean }
    >();
    for (const wf of targetWorkflows) {
      targetWorkflowByName.set(wf.name.toLowerCase(), wf);
    }

    const defaultTargetWorkflow = targetWorkflows.find(
      (wf: { isDefault: boolean }) => wf.isDefault
    ) ??
      targetWorkflows[0] ?? { id: 0, name: "Unknown", isDefault: true };

    // We need source state names — fetch from the source project's workflow assignments
    const sourceWorkflowAssignments =
      await reader.projectWorkflowAssignment.findMany({
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

    const sourceNames = sourceCases.map((c: any) => ({
      name: c.name as string,
      className: c.className as string | null,
      source: c.source as RepositoryCaseSource,
    }));

    const collisionCases = await reader.repositoryCases.findMany({
      where: {
        projectId: body.targetProjectId,
        isDeleted: false,
        // A move within the same project would otherwise self-collide: the
        // sources match themselves on (name, className, source). Exclude
        // them so we only flag real conflicts with other cases. Copy keeps
        // them included because the unique constraint really would block.
        ...(body.operation === "move" ? { id: { notIn: body.caseIds } } : {}),
        OR: sourceNames.map((n) => ({
          name: n.name,
          // Match NULL className explicitly — omitting the filter would
          // match any className and flag unrelated cases as collisions.
          className: n.className === null ? { equals: null } : n.className,
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
      })
    );

    // ─── Resolve target repository ────────────────────────────────────────────

    const targetRepository = await reader.repositories.findFirst({
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
      { status: 500 }
    );
  }
}
