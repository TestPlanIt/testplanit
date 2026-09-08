import { getAuthDb } from "~/lib/zenstack";
import { RepositoryCaseSource } from "~/zenstack/models";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";
import {
  createCaseStateMapper,
  createGatedStateResolver,
  findActiveRepository,
  getCasesWorkflowAssignments,
  getWorkflowNamesByIds,
} from "~/lib/services/workflowStateMapping";
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
    const user = await baseDb.user.findUnique({
      where: { id: session.user.id },
      include: { role: { include: { rolePermissions: true } } },
    });

    const isAdmin = user?.access === "ADMIN";

    // Pick the read client up-front: admins use raw baseDb so reads are
    // deterministic — the policy layer has been observed to return no rows
    // under heavy parallel load even though @@allow('all', auth().access ==
    // 'ADMIN') is unconditional. Non-admin requests stay on the enhanced
    // client so per-model policies (which can be stricter than the
    // project-level policy alone) are enforced.
    const reader = isAdmin
      ? baseDb
      : ((await getAuthDb(user ?? undefined)) as unknown as typeof baseDb);

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

    // Move update-access check (move = soft-delete via isDeleted: true = needs update permission)
    // Since the worker uses raw baseDb, we verify the user's role permits canAddEdit on TestCaseRepository.
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

    // ─── Same-project move: nothing to preview ────────────────────────────────
    // Moving cases between folders of one project only changes where the rows
    // live. They keep their name, template and state, so there is no template
    // mismatch to report, no workflow state to remap, and nothing for a case
    // to collide with (its identity tuple is unchanged, and it cannot
    // conflict with itself). The target repository/template/state context is
    // omitted — a relocation reads none of it.
    if (
      body.operation === "move" &&
      body.sourceProjectId === body.targetProjectId
    ) {
      const response: PreflightResponse = {
        hasSourceReadAccess: true,
        hasTargetWriteAccess: true,
        hasSourceUpdateAccess,
        templateMismatch: false,
        missingTemplates: [],
        canAutoAssignTemplates:
          user?.access === "ADMIN" || user?.access === "PROJECTADMIN",
        workflowMappings: [],
        unmappedStates: [],
        collisions: [],
      };
      return NextResponse.json(response);
    }

    const sourceCases = await reader.repositoryCases.findMany({
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

    // The same resolver the worker executes with, so this preview cannot
    // drift from the outcome: keep exact states, else match by name, else the
    // target default — then run the result through the review gate, since
    // every row this operation writes is created fresh in the target project.
    const targetStates = await getCasesWorkflowAssignments(
      reader as any,
      body.targetProjectId
    );
    const sourceStateNames = await getWorkflowNamesByIds(
      reader as any,
      uniqueSourceStateIds
    );
    const mapper = createCaseStateMapper(targetStates, sourceStateNames);
    const resolveGatedState = createGatedStateResolver(
      reader as any,
      body.targetProjectId
    );

    const workflowMappings: PreflightResponse["workflowMappings"] = [];
    const unmappedStates: PreflightResponse["unmappedStates"] = [];

    for (const stateId of uniqueSourceStateIds) {
      const sourceStateName =
        sourceStateNames.get(stateId) ?? `State ${stateId}`;
      const mapped = mapper.map(stateId);
      if (!mapped) {
        // Target project has no CASES states at all — the submit route
        // rejects this before a job is enqueued.
        unmappedStates.push({ id: stateId, name: sourceStateName });
        continue;
      }
      const finalStateId = await resolveGatedState(mapped.stateId);
      const isDefaultFallback =
        mapped.via === "default" || finalStateId !== mapped.stateId;
      workflowMappings.push({
        sourceStateId: stateId,
        sourceStateName,
        targetStateId: finalStateId,
        targetStateName: mapper.targetName(finalStateId) ?? sourceStateName,
        isDefaultFallback,
      });
      if (isDefaultFallback) {
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

    // ─── Resolve target repository / template / default state ─────────────────
    // All optional: when one cannot be resolved it is omitted and the submit
    // route reports the failure with a proper error.

    const targetRepository = await findActiveRepository(
      reader as any,
      body.targetProjectId
    );
    const targetRepositoryId = targetRepository?.id;

    // First target template assignment, or the first source template as a
    // fallback (valid when the templates all match).
    const targetTemplateId =
      targetTemplateAssignments[0]?.templateId ?? uniqueSourceTemplateIds[0];

    const targetDefaultWorkflowStateId = mapper.defaultStateId;

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
