import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApplicationArea } from "~/zenstack/models";
import { checkApiRateLimit } from "~/lib/api-rate-limit";
import { authenticateRequest, hasBearerToken } from "~/lib/api-token-auth";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { requestExecution } from "~/lib/execution/requestExecution";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { getServerAuthSession } from "~/server/auth";

const bodySchema = z.object({
  caseIds: z.array(z.number().int().positive()).min(1).max(500),
  targetId: z.number().int().positive(),
  ref: z.string().trim().min(1).max(255).optional(),
  runId: z.number().int().positive().optional(),
  runName: z.string().trim().min(1).max(255).optional(),
  inputs: z.record(z.string(), z.string().max(1000)).optional(),
});

/**
 * POST /api/projects/{projectId}/execute-cases
 * Body: { caseIds, targetId, ref?, runId?, runName?, inputs? }
 *
 * Ad-hoc execution of one or more automated cases. With `runId` the cases
 * are added to that open run (unless its composition is locked); without it
 * a new run holding just those cases is created. Then the same dispatch as
 * the run-level execute route.
 */
export const POST = withAuditContext(
  async (
    request: NextRequest,
    { params }: { params: Promise<{ projectId: string }> }
  ) => {
    const { projectId: projectIdRaw } = await params;
    const projectId = Number.parseInt(projectIdRaw, 10);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return NextResponse.json(
        { error: "Invalid project id" },
        { status: 400 }
      );
    }

    const session = await getServerAuthSession();
    const auth = await authenticateRequest(request, session);
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    if (hasBearerToken(request)) {
      const limit = await checkApiRateLimit();
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Rate limit exceeded" },
          { status: 429 }
        );
      }
    }

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch (err) {
      return NextResponse.json(
        {
          error: "Invalid input",
          details: err instanceof z.ZodError ? z.treeifyError(err) : undefined,
        },
        { status: 400 }
      );
    }

    const canEdit = await userCanAddEditArea(
      auth.user.userId,
      projectId,
      ApplicationArea.TestRuns,
      auth.user.access
    );
    if (!canEdit) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const caseIds = Array.from(new Set(body.caseIds));
    const cases = await baseDb.repositoryCases.findMany({
      where: { id: { in: caseIds }, projectId, isDeleted: false },
      select: { id: true, name: true, automated: true },
    });
    if (cases.length !== caseIds.length) {
      return NextResponse.json(
        {
          error: "One or more cases were not found in this project",
          code: "CASES_NOT_FOUND",
        },
        { status: 404 }
      );
    }
    const manual = cases.filter((c) => !c.automated);
    if (manual.length > 0) {
      return NextResponse.json(
        {
          error: "Only automated cases can be executed",
          code: "CASES_NOT_AUTOMATED",
          caseIds: manual.map((c) => c.id),
        },
        { status: 400 }
      );
    }

    let runId: number;
    let createdRun = false;
    if (body.runId) {
      const run = await baseDb.testRuns.findFirst({
        where: { id: body.runId, projectId, isDeleted: false },
        select: {
          id: true,
          isCompleted: true,
          compositionLockedAt: true,
          testCases: {
            where: { isDeleted: false, repositoryCaseId: { in: caseIds } },
            select: { repositoryCaseId: true },
          },
        },
      });
      if (!run) {
        return NextResponse.json(
          { error: "Test run not found" },
          { status: 404 }
        );
      }
      if (run.isCompleted) {
        return NextResponse.json(
          { error: "Test run is completed", code: "RUN_COMPLETED" },
          { status: 409 }
        );
      }
      const present = new Set(run.testCases.map((c) => c.repositoryCaseId));
      const missing = caseIds.filter((id) => !present.has(id));
      if (missing.length > 0) {
        if (run.compositionLockedAt) {
          return NextResponse.json(
            {
              error: "The run's composition is locked; the cases are not in it",
              code: "RUN_LOCKED",
              caseIds: missing,
            },
            { status: 409 }
          );
        }
        await auditedTransaction(async (tx) => {
          const last = await tx.testRunCases.aggregate({
            _max: { order: true },
            where: { testRunId: run.id },
          });
          let order = (last._max.order ?? -1) + 1;
          for (const id of missing) {
            await tx.testRunCases.upsert({
              where: {
                testRunId_repositoryCaseId: {
                  testRunId: run.id,
                  repositoryCaseId: id,
                },
              },
              update: { isDeleted: false },
              create: {
                testRunId: run.id,
                repositoryCaseId: id,
                order: order++,
              },
            });
          }
        });
      }
      runId = run.id;
    } else {
      const state = await baseDb.workflows.findFirst({
        where: {
          isEnabled: true,
          isDeleted: false,
          scope: "RUNS",
          projects: { some: { projectId } },
        },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      if (!state) {
        return NextResponse.json(
          {
            error: "The project has no run workflow state",
            code: "NO_RUN_STATE",
          },
          { status: 409 }
        );
      }
      const byId = new Map(cases.map((c) => [c.id, c]));
      const first = byId.get(caseIds[0])?.name ?? "case";
      const name =
        body.runName ??
        (caseIds.length === 1
          ? `Automated: ${first}`
          : `Automated: ${first} (+${caseIds.length - 1})`);
      const run = await auditedTransaction((tx) =>
        tx.testRuns.create({
          data: {
            name: name.slice(0, 255),
            projectId,
            stateId: state.id,
            createdById: auth.user.userId,
            testRunType: "REGULAR",
            testCases: {
              create: caseIds.map((id, index) => ({
                repositoryCaseId: id,
                order: index,
              })),
            },
          },
          select: { id: true },
        })
      );
      runId = run.id;
      createdRun = true;
    }

    const result = await requestExecution({
      runId,
      projectId,
      requestedById: auth.user.userId,
      targetId: body.targetId,
      ref: body.ref,
      caseIds,
      inputs: body.inputs,
      adHoc: true,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code, runId, createdRun },
        { status: result.status }
      );
    }
    return NextResponse.json(
      {
        runId,
        createdRun,
        executionId: result.execution.id,
        status: result.execution.status,
        selectionCount: result.execution.selectionCount,
      },
      { status: 202 }
    );
  }
);
