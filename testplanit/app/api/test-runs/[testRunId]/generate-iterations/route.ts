import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { getEnhancedDb } from "~/lib/auth/utils";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { getIterationGenerationQueue } from "~/lib/queues";
import {
  classifyBand,
  computePreflight,
  readCardinalityThresholds,
  type PreflightCaseInput,
} from "~/lib/services/iterationCardinality";
import { materializeIterations } from "~/lib/services/iterationFanOut";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { authOptions } from "~/server/auth";

/**
 * POST /api/test-runs/[testRunId]/generate-iterations
 *
 * Called by AddTestRunModal immediately after the run is created via the
 * ZenStack hook. Computes the iteration cardinality for the run and
 * materializes the snapshot + iteration rows in one of three modes:
 *
 *   - sync (count ≤ asyncCap, default 500): runs `materializeIterations`
 *     inside a single prisma.$transaction synchronously; returns
 *     `{ async: false, iterationCount, perCase }`.
 *
 *   - async (asyncCap < count ≤ hardCap, default 501..5000): enqueues a
 *     BullMQ iteration-generation job and returns
 *     `{ async: true, jobId, iterationCount, perCase }`. The worker
 *     wraps the same transaction with a 5-minute timeout. The client
 *     polls `/api/test-runs/iterations/status/[jobId]` for progress.
 *
 *   - hardRefuse (count > hardCap): returns 422 with a structured
 *     `{ refused: true, iterationCount, perCase, cap }` payload so the
 *     UI can surface the hard-refuse dialog.
 *
 * Soft-confirm gating is the CLIENT's responsibility — the server never
 * blocks on softConfirm; the modal must intercept the chip classification
 * and prompt the user before invoking this endpoint. The server's only
 * refusal is hardRefuse.
 *
 * Access enforcement: getEnhancedDb(session) confirms the caller can read
 * the run's TestRunCases. The run-existence check is the gate; if the
 * caller cannot read the run they get 404 (we deliberately don't reveal
 * "run exists but you can't see it").
 *
 * Idempotency: this endpoint trusts the caller (the modal) to invoke it
 * exactly once per newly-created run. A second call would create duplicate
 * snapshots + iteration rows. Wave 2 callers (re-generation flows) must
 * gate on `TestRunCases.totalIterations > 0` before re-invoking.
 */

export const POST = withAuditContext(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ testRunId: string }> }
  ) => {
    try {
      const session = await getServerSession(authOptions);
      if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const { testRunId: runIdParam } = await params;
      const testRunId = parseInt(runIdParam, 10);
      if (Number.isNaN(testRunId) || testRunId <= 0) {
        return NextResponse.json(
          { error: "Invalid test run id" },
          { status: 400 }
        );
      }

      const db = await getEnhancedDb(session);

      // Verify run exists AND caller has read access. We need projectId for
      // the cardinality query and configId presence for the fan-out factor.
      const run = await db.testRuns.findFirst({
        where: { id: testRunId },
        select: { id: true, projectId: true, configId: true },
      });
      if (!run) {
        return NextResponse.json(
          { error: "Test run not found" },
          { status: 404 }
        );
      }

      // Resolve the run's cases. We need RepositoryCase.id, name, and
      // hasParameters; plus the dataset row count per case to compute the
      // preflight contribution. configCount for THIS run is exactly 1 (each
      // configId in the modal already creates a separate TestRun row, so
      // fan-out per run is rowCount × 1).
      const runCases: Array<{
        repositoryCaseId: number;
        repositoryCase: {
          id: number;
          name: string;
          hasParameters: boolean;
          ownedDataSets: Array<{
            _count: { rows: number };
          }>;
        };
      }> = await db.testRunCases.findMany({
        where: { testRunId, isDeleted: false },
        select: {
          repositoryCaseId: true,
          repositoryCase: {
            select: {
              id: true,
              name: true,
              hasParameters: true,
              ownedDataSets: {
                where: { isDeleted: false, projectId: run.projectId },
                select: {
                  _count: {
                    select: { rows: { where: { isDeleted: false } } },
                  },
                },
                take: 1,
              },
            },
          },
        },
      });

      const inputs: PreflightCaseInput[] = runCases.map((rc) => ({
        caseId: rc.repositoryCase.id,
        caseTitle: rc.repositoryCase.name,
        hasParameters: rc.repositoryCase.hasParameters,
        rowCount: rc.repositoryCase.ownedDataSets[0]?._count.rows ?? 0,
      }));

      const thresholds = readCardinalityThresholds();
      const preflight = computePreflight(inputs, 1, thresholds);
      const iterationCount = preflight.total;
      const classification = classifyBand(iterationCount, thresholds);

      // Hard refuse — return 422 with the actionable breakdown.
      if (classification === "hardRefuse") {
        return NextResponse.json(
          {
            refused: true,
            async: false,
            iterationCount,
            perCase: preflight.perCase,
            cap: thresholds.hardCap,
            thresholds,
          },
          { status: 422 }
        );
      }

      // Sync path — fan out inline. Audit emission piggy-backs the same
      // transaction so we don't audit a fan-out that rolled back.
      if (classification === "sync") {
        const result = await auditedTransaction(async (tx) => {
          return materializeIterations(testRunId, tx);
        });

        // Best-effort audit (BULK_CREATE on TestRunCaseIteration). The
        // dedicated ITERATION_RESULT_RECORDED action is reserved for actual
        // result writes (Task 6), not generation events.
        captureAuditEvent({
          action: "BULK_CREATE",
          entityType: "TestRunCaseIteration",
          entityId: String(testRunId),
          projectId: run.projectId,
          metadata: {
            testRunId,
            iterationCount: result.iterationCount,
            parameterizedRunCaseCount: result.parameterizedRunCaseCount,
            async: false,
          },
        }).catch(() => {
          // Audit is best-effort — never block the API response on it.
        });

        return NextResponse.json({
          async: false,
          iterationCount: result.iterationCount,
          parameterizedRunCaseCount: result.parameterizedRunCaseCount,
          perCase: preflight.perCase,
        });
      }

      // Async path (async or softConfirm bands) — enqueue.
      const queue = getIterationGenerationQueue();
      if (!queue) {
        return NextResponse.json(
          { error: "Background job queue is not available" },
          { status: 503 }
        );
      }

      const tenantId = getCurrentTenantId();
      const job = await queue.add("generate", {
        testRunId,
        userId: session.user.id,
        tenantId,
      });

      captureAuditEvent({
        action: "BULK_CREATE",
        entityType: "TestRunCaseIteration",
        entityId: String(testRunId),
        projectId: run.projectId,
        metadata: {
          testRunId,
          iterationCount,
          async: true,
          jobId: job.id,
          classification,
        },
      }).catch(() => {});

      return NextResponse.json({
        async: true,
        jobId: job.id,
        iterationCount,
        perCase: preflight.perCase,
      });
    } catch (err) {
      console.error("[generate-iterations]", err);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  }
);
