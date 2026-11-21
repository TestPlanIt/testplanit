import { NextRequest, NextResponse } from "next/server";
import { enqueueWithAuditContext } from "~/lib/auditContextEnqueue";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { getCurrentTenantId } from "~/lib/multiTenantDb";
import { getQaseImportQueue } from "~/lib/queues";
import { rawDb } from "~/lib/rawDb";
import { db } from "~/server/db";
import { buildQaseAnalysis } from "~/services/imports/qase/analysis";
import {
  JOB_PROCESS_QASE_IMPORT,
  serializeQaseImportJob,
} from "~/services/imports/qase/jobPresenter";
import {
  normalizeQaseMapping,
  validateQaseMapping,
} from "~/services/imports/qase/mapping";
import { requireAdminSession, unauthorized } from "../../../shared";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

/** Starts writing the fetched data into TestPlanIt with the saved mapping. */
const handlePOST = withAuditContext(
  async (_request: NextRequest, context: RouteContext) => {
    if (!(await requireAdminSession())) {
      return unauthorized();
    }
    const { jobId } = await context.params;
    const job = await db.qaseImportJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        projects: true,
        configuration: true,
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (job.status !== "READY") {
      return NextResponse.json(
        { error: "The job's data is not ready to be imported" },
        { status: 400 }
      );
    }
    if (!job.configuration) {
      return NextResponse.json(
        { error: "Save the mapping first", code: "mapping_missing" },
        { status: 400 }
      );
    }
    const problems = validateQaseMapping(
      normalizeQaseMapping(job.configuration),
      await buildQaseAnalysis(rawDb, job)
    );
    if (problems.length > 0) {
      return NextResponse.json(
        {
          error: "The mapping is not complete",
          code: "mapping_incomplete",
          problems,
        },
        { status: 400 }
      );
    }
    const queue = getQaseImportQueue();
    if (!queue) {
      return NextResponse.json(
        {
          error: "The import queue is not available",
          code: "queue_unavailable",
        },
        { status: 503 }
      );
    }
    const updated = await db.qaseImportJob.update({
      where: { id: jobId },
      data: {
        status: "QUEUED",
        phase: "IMPORTING",
        statusMessage: "Queued",
        cancelRequested: false,
        error: null,
        processedCount: 0,
        totalCount: 0,
        entityProgress: {},
        activityLog: [],
      },
    });
    await enqueueWithAuditContext(queue, JOB_PROCESS_QASE_IMPORT, {
      jobId,
      mode: "import" as const,
      tenantId: getCurrentTenantId(),
    });
    return NextResponse.json({ job: serializeQaseImportJob(updated) });
  }
);

export const POST = withRequestRouting(handlePOST);
