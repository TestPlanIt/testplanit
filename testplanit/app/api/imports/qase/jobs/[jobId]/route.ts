import { NextRequest, NextResponse } from "next/server";
import { enqueueWithAuditContext } from "~/lib/auditContextEnqueue";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { getCurrentTenantId } from "~/lib/multiTenantDb";
import { getQaseImportQueue } from "~/lib/queues";
import { db } from "~/server/db";
import {
  JOB_PROCESS_QASE_IMPORT,
  serializeQaseImportJob,
} from "~/services/imports/qase/jobPresenter";
import { requireAdminSession, unauthorized } from "../../shared";

const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

const notFound = () =>
  NextResponse.json({ error: "Job not found" }, { status: 404 });

async function handleGET(_request: NextRequest, context: RouteContext) {
  if (!(await requireAdminSession())) {
    return unauthorized();
  }
  const { jobId } = await context.params;
  const job = await db.qaseImportJob.findUnique({ where: { id: jobId } });
  return job
    ? NextResponse.json({ job: serializeQaseImportJob(job) })
    : notFound();
}

export const GET = withRequestRouting(handleGET);

const handlePOST = withAuditContext(
  async (request: NextRequest, context: RouteContext) => {
    if (!(await requireAdminSession())) {
      return unauthorized();
    }
    const { jobId } = await context.params;
    const body = await request.json().catch(() => null);
    const action: unknown = body?.action;

    const job = await db.qaseImportJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        phase: true,
        cancelRequested: true,
        apiToken: true,
      },
    });
    if (!job) {
      return notFound();
    }

    if (action === "cancel") {
      if (!ACTIVE_STATUSES.has(job.status)) {
        return NextResponse.json(
          { error: "Only a queued or running job can be canceled" },
          { status: 400 }
        );
      }
      const updated = await db.qaseImportJob.update({
        where: { id: jobId },
        data: {
          cancelRequested: true,
          statusMessage: "Cancellation requested",
        },
      });
      return NextResponse.json({ job: serializeQaseImportJob(updated) });
    }

    if (action === "retry") {
      if (job.status !== "FAILED" || !job.apiToken) {
        return NextResponse.json(
          { error: "Only a failed job can be retried" },
          { status: 400 }
        );
      }
      const queue = getQaseImportQueue();
      if (!queue) {
        return NextResponse.json(
          { error: "The import queue is not available" },
          { status: 503 }
        );
      }
      // A failed import continues from what it already created.
      const mode =
        job.phase === "IMPORTING" ? ("import" as const) : ("fetch" as const);
      const updated = await db.qaseImportJob.update({
        where: { id: jobId },
        data: {
          status: "QUEUED",
          phase: job.phase === "IMPORTING" ? "IMPORTING" : "FETCHING",
          statusMessage: "Queued",
          cancelRequested: false,
          error: null,
          ...(mode === "fetch" ? { fetchProgress: {} } : {}),
        },
      });
      await enqueueWithAuditContext(queue, JOB_PROCESS_QASE_IMPORT, {
        jobId,
        mode,
        tenantId: getCurrentTenantId(),
      });
      return NextResponse.json({ job: serializeQaseImportJob(updated) });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }
);

export const POST = withRequestRouting(handlePOST);

/** Removes a finished job with its staged data and stored token. */
const handleDELETE = withAuditContext(
  async (_request: NextRequest, context: RouteContext) => {
    if (!(await requireAdminSession())) {
      return unauthorized();
    }
    const { jobId } = await context.params;
    const job = await db.qaseImportJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (!job) {
      return notFound();
    }
    if (ACTIVE_STATUSES.has(job.status)) {
      return NextResponse.json(
        { error: "Cancel the job before deleting it" },
        { status: 400 }
      );
    }
    await db.qaseImportJob.delete({ where: { id: jobId } });
    return NextResponse.json({ deleted: true });
  }
);

export const DELETE = withRequestRouting(handleDELETE);
