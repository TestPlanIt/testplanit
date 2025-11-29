import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
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

    if (job.createdById !== session.user.id && session.user.access !== "ADMIN") {
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

    if (action !== "cancel") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }

    const job = await db.testmoImportJob.findUnique({
      where: { id: jobId },
      include: { datasets: false },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.createdById !== session.user.id && session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
  } catch (error) {
    console.error("Failed to update Testmo import job", error);
    return NextResponse.json(
      { error: "Failed to update Testmo import job" },
      { status: 500 }
    );
  }
}
