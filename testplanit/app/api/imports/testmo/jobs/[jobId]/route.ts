import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import { serializeImportJob } from "~/services/imports/testmo/jobPresenter";
import type { TestmoImportJobPayload } from "~/services/imports/testmo/types";

const ACTIVE_STATUSES = new Set(["QUEUED", "RUNNING"]);

interface RouteContext {
  params: Promise<{
    jobId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await context.params;
    const { searchParams } = new URL(request.url);
    const includeDatasetsParam = searchParams.get("include") === "datasets";

    const job = await db.testmoImportJob.findUnique({
      where: { id: jobId },
      include: includeDatasetsParam ? { datasets: true } : undefined,
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (
      job.createdById !== session.user.id &&
      session.user.access !== "ADMIN"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shouldIncludeDatasets =
      includeDatasetsParam ||
      job.status === "COMPLETED" ||
      job.status === "READY";

    const jobWithDatasets =
      shouldIncludeDatasets && !includeDatasetsParam
        ? await db.testmoImportJob.findUnique({
            where: { id: jobId },
            include: { datasets: true },
          })
        : job;

    if (!jobWithDatasets) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const payload = serializeImportJob(jobWithDatasets, {
      includeDatasets: shouldIncludeDatasets,
    });

    return NextResponse.json({ job: payload });
  } catch (error) {
    console.error("Failed to fetch Testmo import job", error);
    return NextResponse.json(
      { error: "Failed to fetch Testmo import job" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = body?.action;

    const job = await db.testmoImportJob.findUnique({
      where: { id: jobId },
      include: { datasets: false },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (
      job.createdById !== session.user.id &&
      session.user.access !== "ADMIN"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (action === "retry") {
      // Allow retrying a failed or canceled job — reset to READY so the user
      // can reconfigure the mapping and start the import again.
      if (job.status !== "FAILED" && job.status !== "CANCELED") {
        return NextResponse.json(
          { error: "Only failed or canceled jobs can be retried" },
          { status: 400 }
        );
      }

      const updatedJob = await db.testmoImportJob.update({
        where: { id: jobId },
        data: {
          status: "READY",
          phase: "CONFIGURING",
          statusMessage: "Ready for reconfiguration",
          cancelRequested: false,
          currentEntity: null,
          processedCount: 0,
          errorCount: 0,
          skippedCount: 0,
          totalCount: 0,
          estimatedTimeRemaining: null,
          processingRate: null,
          lastImportStartedAt: null,
        },
      });

      const payload: TestmoImportJobPayload = serializeImportJob(updatedJob);
      return NextResponse.json({ job: payload });
    }

    if (action === "cancel") {
      if (!ACTIVE_STATUSES.has(job.status)) {
        const payload = serializeImportJob(job);
        return NextResponse.json({ job: payload }, { status: 200 });
      }

      if (job.cancelRequested) {
        const payload = serializeImportJob(job);
        return NextResponse.json({ job: payload }, { status: 200 });
      }

      const updatedJob = await db.testmoImportJob.update({
        where: { id: jobId },
        data: {
          cancelRequested: true,
          statusMessage: "Cancellation requested",
        },
      });

      const payload: TestmoImportJobPayload = serializeImportJob(updatedJob);
      return NextResponse.json({ job: payload });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    console.error("Failed to update Testmo import job", error);
    return NextResponse.json(
      { error: "Failed to update Testmo import job" },
      { status: 500 }
    );
  }
}
