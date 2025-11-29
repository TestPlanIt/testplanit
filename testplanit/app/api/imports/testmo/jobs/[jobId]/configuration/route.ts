import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import type { TestmoImportStatus } from "~/services/imports/testmo/types";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import { serializeImportJob } from "~/services/imports/testmo/jobPresenter";
import {
  normalizeMappingConfiguration,
  serializeMappingConfiguration,
} from "~/services/imports/testmo/configuration";
import type { TestmoMappingConfiguration } from "~/services/imports/testmo/types";

interface RouteContext {
  params: Promise<{
    jobId: string;
  }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await context.params;
    const { configuration, options } = await request.json();

    if (!configuration || typeof configuration !== "object") {
      return NextResponse.json(
        { error: "Configuration payload is required" },
        { status: 400 }
      );
    }

    const job = await db.testmoImportJob.findUnique({ where: { id: jobId } });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.createdById !== session.user.id && session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (job.status !== "READY" && job.status !== "RUNNING") {
      return NextResponse.json(
        { error: "Configuration can only be saved while the job is in READY status." },
        { status: 400 }
      );
    }

    const normalizedConfiguration: TestmoMappingConfiguration =
      normalizeMappingConfiguration(configuration);
    const serializedConfiguration = serializeMappingConfiguration(
      normalizedConfiguration
    ) as Prisma.InputJsonValue;

    const updateData: Prisma.TestmoImportJobUpdateInput = {
      configuration: serializedConfiguration,
      statusMessage: "Mapping configuration saved",
      updatedAt: new Date(),
    };

    if (options !== undefined) {
      updateData.options =
        options === null
          ? Prisma.JsonNull
          : (JSON.parse(JSON.stringify(options)) as Prisma.InputJsonValue);
    }

    const currentStatus = job.status as TestmoImportStatus;

    if (currentStatus === "COMPLETED") {
      updateData.status = "READY";
      updateData.phase = "CONFIGURING";
      updateData.statusMessage =
        "Analysis complete. Configure mapping to continue.";
    } else if (!job.phase) {
      updateData.phase = "CONFIGURING";
    }

    const updatedJob = await db.testmoImportJob.update({
      where: { id: jobId },
      data: updateData,
    });

    const payload = serializeImportJob(updatedJob);

    return NextResponse.json({ job: payload });
  } catch (error) {
    console.error("Failed to save Testmo import configuration", error);
    return NextResponse.json(
      { error: "Failed to save Testmo import configuration" },
      { status: 500 }
    );
  }
}
