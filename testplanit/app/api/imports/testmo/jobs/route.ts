import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import {
  getTestmoImportQueue,
  TESTMO_IMPORT_QUEUE_NAME,
} from "~/lib/queues";
import { serializeImportJob } from "~/services/imports/testmo/jobPresenter";
import type { TestmoImportJobPayload } from "~/services/imports/testmo/types";
import { JOB_PROCESS_TESTMO_IMPORT } from "~/services/imports/testmo/constants";

const bucketName = process.env.AWS_BUCKET_NAME;

function getQueue() {
  const queue = getTestmoImportQueue();
  if (!queue) {
    throw new Error(
      `BullMQ queue "${TESTMO_IMPORT_QUEUE_NAME}" is not available (Valkey connection missing).`
    );
  }
  return queue;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!bucketName) {
      return NextResponse.json(
        { error: "Storage bucket is not configured" },
        { status: 500 }
      );
    }

    const { key, fileName, fileSizeBytes } = await request.json();

    if (!key || typeof key !== "string") {
      return NextResponse.json(
        { error: "S3 object key is required" },
        { status: 400 }
      );
    }

    if (!fileName || typeof fileName !== "string") {
      return NextResponse.json(
        { error: "File name is required" },
        { status: 400 }
      );
    }

    let originalFileSize: bigint | null = null;
    if (typeof fileSizeBytes === "number" && Number.isFinite(fileSizeBytes)) {
      originalFileSize = BigInt(Math.max(0, Math.floor(fileSizeBytes)));
    }

    const testmoImportQueue = getQueue();

    const jobRecord = await db.testmoImportJob.create({
      data: {
        createdById: session.user.id,
        storageKey: key,
        storageBucket: bucketName,
        originalFileName: fileName,
        originalFileSize,
        statusMessage: "Queued for analysis",
        phase: "ANALYZING",
      },
    });

    await testmoImportQueue.add(JOB_PROCESS_TESTMO_IMPORT, {
      jobId: jobRecord.id,
      mode: "analyze",
    });

    const payload = serializeImportJob(jobRecord);

    return NextResponse.json({ job: payload }, { status: 201 });
  } catch (error) {
    console.error("Failed to queue Testmo import job", error);
    return NextResponse.json(
      { error: "Failed to queue Testmo import job" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(Number(limitParam) || 10, 100) : 10;

    const jobs = await db.testmoImportJob.findMany({
      where: { createdById: session.user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const payload: TestmoImportJobPayload[] = jobs.map((job) =>
      serializeImportJob(job)
    );

    return NextResponse.json({ jobs: payload });
  } catch (error) {
    console.error("Failed to list Testmo import jobs", error);
    return NextResponse.json(
      { error: "Failed to list Testmo import jobs" },
      { status: 500 }
    );
  }
}
