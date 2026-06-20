import { ApplicationArea, Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

import { getEnhancedDb } from "~/lib/auth/utils";
import { updateAuditContext } from "~/lib/auditContext";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import {
  buildIterationOverrideSchema,
  type OverrideParameterSchemaEntry,
} from "~/lib/schemas/iterationOverrideSchema";
import { captureAuditEvent } from "~/lib/services/auditLog";
import {
  redactValues,
  type ParameterSchemaEntry,
} from "~/lib/services/parameterRedaction";
import { authOptions } from "~/server/auth";

/**
 * Phase 3 Wave 5 (Task 12) — Iteration values override endpoint.
 *
 * PATCH /api/repository/test-runs/[runId]/cases/[caseId]/iterations/[iterId]/values
 *
 * Updates `TestRunCaseIteration.valuesJson` for a single iteration. The
 * snapshot (`TestRunCaseDataSetSnapshot.rowsJson`) is NEVER modified — it
 * remains the immutable audit trail of the iteration's original input.
 *
 * Audit emission is post-commit, fire-and-forget. Both `before` (the
 * snapshot row) and `after` (the new values) are redacted at the audit
 * boundary against the viewer's `canReadSensitive` permission.
 */

const bodySchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

/**
 * Resolves whether the viewer can read sensitive parameter values on this
 * iteration's redacted snapshot rows. Test-run-result restricted fields
 * live under the `TestRunResultRestrictedFields` ApplicationArea — gate the
 * `canReadSensitive` check on that area only so a role with the grant on,
 * for example, `TestCaseRestrictedFields` does not also unlock iteration
 * values. System admins always pass.
 */
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
        (p: { area?: ApplicationArea; canReadSensitive?: boolean }) =>
          p?.area === ApplicationArea.TestRunResultRestrictedFields &&
          p?.canReadSensitive === true
      )
    : false;
}

function parseSnapshotParameters(
  value: unknown
): OverrideParameterSchemaEntry[] {
  if (!Array.isArray(value)) return [];
  const out: OverrideParameterSchemaEntry[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as Record<string, unknown>).name === "string"
    ) {
      const e = entry as Record<string, unknown>;
      const type = e.type;
      if (
        type !== "STRING" &&
        type !== "INTEGER" &&
        type !== "BOOLEAN" &&
        type !== "SELECT"
      ) {
        continue;
      }
      out.push({
        name: String(e.name),
        type,
        required: e.required !== false,
        sensitive: e.sensitive === true,
        allowedValues: Array.isArray(e.allowedValuesJson)
          ? (e.allowedValuesJson as unknown[])
              .filter((v) => typeof v === "string")
              .map((v) => v as string)
          : Array.isArray(e.allowedValues)
            ? (e.allowedValues as unknown[])
                .filter((v) => typeof v === "string")
                .map((v) => v as string)
            : null,
      });
    }
  }
  return out;
}

function toAuditSchema(
  entries: OverrideParameterSchemaEntry[]
): ParameterSchemaEntry[] {
  return entries.map((e) => ({
    name: e.name,
    sensitive: e.sensitive === true,
  }));
}

export const PATCH = withAuditContext(
  async (
    req: NextRequest,
    {
      params,
    }: {
      params: Promise<{ runId: string; caseId: string; iterId: string }>;
    }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      updateAuditContext({ userId: session.user.id });

      const {
        runId: runIdParam,
        caseId: caseIdParam,
        iterId: iterIdParam,
      } = await params;
      const runId = parseInt(runIdParam, 10);
      const caseId = parseInt(caseIdParam, 10);
      const iterationId = parseInt(iterIdParam, 10);
      if (isNaN(runId) || isNaN(caseId) || isNaN(iterationId)) {
        return NextResponse.json(
          { error: "Invalid path parameter" },
          { status: 400 }
        );
      }

      const body = await req.json().catch(() => null);
      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid input", details: z.treeifyError(parsed.error) },
          { status: 400 }
        );
      }

      const db = await getEnhancedDb(session);

      // Access control: enhanced DB enforces the project-level read policy on
      // TestRunCaseIteration. We additionally verify the iteration belongs to
      // the path's caseId + runId — a leak across cases would return 404, not
      // a wrong-iteration update.
      const iteration = await db.testRunCaseIteration.findFirst({
        where: {
          id: iterationId,
          testRunCaseId: caseId,
          isDeleted: false,
          testRunCase: {
            testRunId: runId,
            testRun: { isDeleted: false },
          },
        },
        select: {
          id: true,
          rowIndex: true,
          valuesJson: true,
          dataSetSnapshotId: true,
          testRunCase: {
            select: {
              testRun: {
                select: { projectId: true },
              },
            },
          },
        },
      });
      if (!iteration) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      // Resolve the snapshot — parametersJson defines the validation contract.
      // Snapshot is required: an iteration without a snapshot can't validate.
      const snapshot = iteration.dataSetSnapshotId
        ? await db.testRunCaseDataSetSnapshot.findFirst({
            where: { id: iteration.dataSetSnapshotId, isDeleted: false },
            select: { parametersJson: true, rowsJson: true },
          })
        : null;
      if (!snapshot) {
        return NextResponse.json(
          { error: "Iteration snapshot missing" },
          { status: 422 }
        );
      }

      const paramSchema = parseSnapshotParameters(snapshot.parametersJson);
      const zodSchema = buildIterationOverrideSchema(paramSchema);
      const valuesParsed = zodSchema.safeParse(parsed.data.values);
      if (!valuesParsed.success) {
        return NextResponse.json(
          {
            error: "Invalid values",
            details: z.treeifyError(valuesParsed.error),
          },
          { status: 400 }
        );
      }

      const beforeValues =
        (iteration.valuesJson as Record<string, unknown>) ?? {};
      const snapshotRows = Array.isArray(snapshot.rowsJson)
        ? (snapshot.rowsJson as Array<Record<string, unknown>>)
        : [];
      const snapshotRow = snapshotRows[iteration.rowIndex] ?? {};

      // Merge: preserve any keys not in the payload (defensive against
      // partial updates from older clients).
      const afterValues: Record<string, unknown> = {
        ...beforeValues,
        ...valuesParsed.data,
      };

      await auditedTransaction(async (tx) => {
        await tx.testRunCaseIteration.update({
          where: { id: iterationId },
          data: {
            valuesJson: afterValues as unknown as Prisma.InputJsonValue,
          },
        });
        // PARAM-07: snapshot is immutable. Never touch
        // TestRunCaseDataSetSnapshot.rowsJson here.
      });

      // Post-commit audit emission. Best-effort — never block the response.
      const viewerCanReadSensitive = await resolveCanReadSensitive(
        session.user.id
      );
      const auditSchema = toAuditSchema(paramSchema);
      captureAuditEvent({
        action: "ITERATION_VALUES_OVERRIDDEN",
        entityType: "TestRunCaseIteration",
        entityId: String(iterationId),
        projectId: iteration.testRunCase.testRun.projectId,
        userId: session.user.id,
        metadata: {
          rowIndex: iteration.rowIndex,
          before: redactValues(
            snapshotRow,
            auditSchema,
            viewerCanReadSensitive
          ),
          after: redactValues(afterValues, auditSchema, viewerCanReadSensitive),
          testRunCaseId: caseId,
          testRunId: runId,
        },
      }).catch(() => {
        // Audit is best-effort.
      });

      return NextResponse.json({
        ok: true,
        iteration: { id: iterationId, valuesJson: afterValues },
      });
    } catch (err) {
      console.error("[iteration values PATCH]", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }
);
