import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import { prisma } from "~/lib/prisma";
import {
  computeWorstOfStatus,
  type RollupStatus,
} from "~/lib/services/iterationRollup";
import { captureAuditEvent } from "~/lib/services/auditLog";
import {
  redactValues,
  type ParameterSchemaEntry,
} from "~/lib/services/parameterRedaction";
import { authOptions } from "~/server/auth";

/**
 * Phase 3 Wave 5 (Task 13) — Bulk-apply-status endpoint for parameterized
 * test-run-case iterations.
 *
 * POST /api/repository/test-runs/[runId]/cases/[caseId]/iterations/bulk-skip
 *
 * (The route name is preserved for back-compat; the action is now
 * "apply any status" rather than the previously-hardcoded Skipped.)
 *
 * The caller picks the status to apply via `statusId` in the body. The
 * server validates that the status is a Test-Run-scoped status enabled
 * for the project; rejects otherwise. For each iteration:
 *   1. Writes a new TestRunResults row tied to that iteration with the
 *      chosen statusId.
 *   2. Updates the iteration's statusId / isCompleted / completedAt.
 *
 * After the per-iteration writes, recomputes the case-level rollup and
 * counters ONCE using the shared `lib/services/iterationRollup.ts` helper.
 * Emits an ITERATION_BULK_SKIPPED audit event per touched iteration after
 * commit (action name preserved for audit-log consumer compatibility).
 *
 * Atomicity: all writes happen inside a single `prisma.$transaction`.
 */

const bodySchema = z.object({
  iterationIds: z.array(z.number().int().positive()).min(1).max(5000),
  statusId: z.number().int().positive(),
  reason: z.string().max(500).optional(),
});

async function resolveCanReadSensitive(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
  if (!u) return false;
  if (u.access === "ADMIN") return true;
  const perms = u.role?.rolePermissions ?? [];
  return Array.isArray(perms)
    ? perms.some(
        (p: { canReadSensitive?: boolean }) => p?.canReadSensitive === true,
      )
    : false;
}

function parseAuditSchema(value: unknown): ParameterSchemaEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ParameterSchemaEntry[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).name === "string"
    ) {
      const e = entry as Record<string, unknown>;
      out.push({
        name: String(e.name),
        sensitive: e.sensitive === true,
      });
    }
  }
  return out;
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: Promise<{ runId: string; caseId: string }>;
  },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { runId: runIdParam, caseId: caseIdParam } = await params;
    const runId = parseInt(runIdParam, 10);
    const caseId = parseInt(caseIdParam, 10);
    if (isNaN(runId) || isNaN(caseId)) {
      return NextResponse.json(
        { error: "Invalid path parameter" },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: z.treeifyError(parsed.error) },
        { status: 400 },
      );
    }

    const db = await getEnhancedDb(session);

    // Verify the run-case exists and the viewer can see it via enhanced DB.
    const runCase = await db.testRunCases.findFirst({
      where: {
        id: caseId,
        testRunId: runId,
        testRun: { isDeleted: false },
      },
      select: {
        id: true,
        testRun: {
          select: { projectId: true },
        },
      },
    });
    if (!runCase) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Validate the chosen status is a Test-Run-scoped status enabled for
    // the project. Statuses are admin-configured per Workflow; we don't
    // hardcode any systemName here.
    const chosenStatus = await prisma.status.findFirst({
      where: {
        id: parsed.data.statusId,
        isEnabled: true,
        isDeleted: false,
        projects: { some: { projectId: runCase.testRun.projectId } },
        scope: { some: { scope: { name: "Test Run" } } },
      },
      select: { id: true },
    });
    if (!chosenStatus) {
      return NextResponse.json(
        { error: "Status not available for this project" },
        { status: 422 },
      );
    }
    const appliedStatusId = chosenStatus.id;

    // Pull the snapshot's parameter schema once so audit metadata can be
    // redacted against the viewer's permission.
    const snapshot = await db.testRunCaseDataSetSnapshot.findFirst({
      where: { testRunCaseId: caseId, isDeleted: false },
      select: { parametersJson: true },
    });
    const auditSchema = parseAuditSchema(snapshot?.parametersJson);
    const viewerCanReadSensitive = await resolveCanReadSensitive(
      session.user.id,
    );

    // Carry executedById; the user is already validated by getEnhancedDb.
    const executedById = session.user.id;

    // Per-iteration audit payload collected inside the transaction; emitted
    // after commit (best-effort, never blocks the response).
    type AuditPayload = {
      iterationId: number;
      rowIndex: number;
      redactedValues: Record<string, unknown>;
    };
    const auditPayloads: AuditPayload[] = [];

    const skippedCount = await prisma.$transaction(async (tx) => {
      // Load and validate ownership of every requested iteration.
      const iterations = await tx.testRunCaseIteration.findMany({
        where: {
          id: { in: parsed.data.iterationIds },
          testRunCaseId: caseId,
          isDeleted: false,
        },
        select: {
          id: true,
          rowIndex: true,
          valuesJson: true,
        },
      });
      if (iterations.length === 0) return 0;

      // 1. Per-iteration writes.
      for (const iter of iterations) {
        await tx.testRunResults.create({
          data: {
            testRunId: runId,
            testRunCaseId: caseId,
            iterationId: iter.id,
            statusId: appliedStatusId,
            notes: parsed.data.reason
              ? (parsed.data.reason as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
            evidence: {},
            executedById,
            attempt: 1,
            testRunCaseVersion: 1,
          },
        });

        await tx.testRunCaseIteration.update({
          where: { id: iter.id },
          data: {
            statusId: appliedStatusId,
            isCompleted: true,
            completedAt: new Date(),
          },
        });

        auditPayloads.push({
          iterationId: iter.id,
          rowIndex: iter.rowIndex,
          redactedValues: redactValues(
            (iter.valuesJson as Record<string, unknown>) ?? {},
            auditSchema,
            viewerCanReadSensitive,
          ),
        });
      }

      // 2. Rollup recompute ONCE for the case (after all per-iter writes).
      const allIterations = await tx.testRunCaseIteration.findMany({
        where: { testRunCaseId: caseId, isDeleted: false },
        select: {
          statusId: true,
          status: {
            select: {
              id: true,
              systemName: true,
              isSuccess: true,
              isFailure: true,
              isCompleted: true,
            },
          },
        },
      });
      const allStatuses = await tx.status.findMany({
        where: { isDeleted: false },
        select: {
          id: true,
          systemName: true,
          isSuccess: true,
          isFailure: true,
          isCompleted: true,
          order: true,
        },
      });
      const statusMap = new Map<number, RollupStatus>(
        allStatuses.map((s) => [
          s.id,
          {
            id: s.id,
            systemName: s.systemName,
            isSuccess: s.isSuccess,
            isFailure: s.isFailure,
            isCompleted: s.isCompleted,
            order: s.order,
          },
        ]),
      );
      const rollupStatusId = computeWorstOfStatus(
        allIterations.map((it) => ({ statusId: it.statusId })),
        statusMap,
      );

      const passedCount = allIterations.filter(
        (it) => it.status?.isSuccess === true,
      ).length;
      const failedCount = allIterations.filter(
        (it) => it.status?.isFailure === true,
      ).length;

      await tx.testRunCases.update({
        where: { id: caseId },
        data: {
          statusId: rollupStatusId ?? appliedStatusId,
          passedIterations: passedCount,
          failedIterations: failedCount,
        },
      });

      return iterations.length;
    });

    // Post-commit audit emission — best-effort, never blocks the response.
    for (const payload of auditPayloads) {
      captureAuditEvent({
        action: "ITERATION_BULK_SKIPPED",
        entityType: "TestRunCaseIteration",
        entityId: String(payload.iterationId),
        projectId: runCase.testRun.projectId,
        userId: session.user.id,
        metadata: {
          rowIndex: payload.rowIndex,
          redactedValues: payload.redactedValues,
          reason: parsed.data.reason ?? null,
          testRunCaseId: caseId,
          testRunId: runId,
          statusId: appliedStatusId,
        },
      }).catch(() => {
        // Audit is best-effort.
      });
    }

    return NextResponse.json({ ok: true, skippedCount });
  } catch (err) {
    console.error("[iteration bulk-skip POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
