import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import {
  getTestmoImportQueue,
  TESTMO_IMPORT_QUEUE_NAME,
} from "~/lib/queues";
import { JOB_PROCESS_TESTMO_IMPORT } from "~/services/imports/testmo/constants";
import { serializeImportJob } from "~/services/imports/testmo/jobPresenter";

interface RouteContext {
  params: Promise<{
    jobId: string;
  }>;
}

function getQueue() {
  const queue = getTestmoImportQueue();
  if (!queue) {
    throw new Error(
      `BullMQ queue "${TESTMO_IMPORT_QUEUE_NAME}" is not available (Valkey connection missing).`
    );
  }
  return queue;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await context.params;
    const { options } = await request.json().catch(() => ({ options: undefined }));

    const job = await db.testmoImportJob.findUnique({ where: { id: jobId } });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.createdById !== session.user.id && session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (job.status !== "READY") {
      return NextResponse.json(
        { error: "Background import can only be started when the job is ready." },
        { status: 400 }
      );
    }

    if (!job.configuration) {
      return NextResponse.json(
        { error: "Please configure mapping before starting the background import." },
        { status: 400 }
      );
    }

    const testmoImportQueue = getQueue();

    const queuedJob = await testmoImportQueue.add(
      JOB_PROCESS_TESTMO_IMPORT,
      {
        jobId,
        mode: "import",
      },
      {
        removeOnComplete: false,
        removeOnFail: false,
      }
    );

    const updateData: Prisma.TestmoImportJobUpdateInput = {
      status: "RUNNING",
      phase: "IMPORTING",
      statusMessage: "Background import queued",
      lastImportStartedAt: new Date(),
      processedCount: 0,
      errorCount: 0,
      skippedCount: 0,
      totalCount: job.totalCount ?? 0,
      activityLog: [] as Prisma.JsonArray,
      entityProgress: {} as Prisma.JsonObject,
    };

    if (options !== undefined) {
      updateData.options =
        options === null
          ? Prisma.JsonNull
          : (JSON.parse(JSON.stringify(options)) as Prisma.InputJsonValue);
    }

    const updatedJob = await db.testmoImportJob.update({
      where: { id: jobId },
      data: updateData,
    });

    const payload = serializeImportJob(updatedJob);

    return NextResponse.json({ job: payload, queueJobId: queuedJob.id });
  } catch (error) {
    console.error("Failed to enqueue Testmo background import", error);
    return NextResponse.json(
      { error: "Failed to enqueue background import" },
      { status: 500 }
    );
  }
}
