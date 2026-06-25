import { JsonNull } from "@zenstackhq/orm";
import type { JsonValue } from "@zenstackhq/orm";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import type { TestmoImportJobUpdateArgs } from "~/zenstack/input";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import {
  normalizeMappingConfiguration,
  serializeMappingConfiguration,
} from "~/services/imports/testmo/configuration";
import { serializeImportJob } from "~/services/imports/testmo/jobPresenter";
import type {
  TestmoImportStatus,
  TestmoMappingConfiguration,
} from "~/services/imports/testmo/types";

interface RouteContext {
  params: Promise<{
    jobId: string;
  }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  // This endpoint is a Testmo-import preparation step (job configuration).
  // The consequential event is the import START -> COMPLETE pair audited at:
  //   - POST /api/imports/testmo/jobs/[jobId]/import (IMPORT_STARTED)
  //   - testmoImportWorker.ts:7079 (IMPORT_COMPLETED / BULK_CREATE)
  // Preparation state changes are not audit-relevant; matches the
  // lastActiveAt session-keep-alive precedent at lib/db.ts:693-701.
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

    if (
      job.createdById !== session.user.id &&
      session.user.access !== "ADMIN"
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (job.status !== "READY" && job.status !== "RUNNING") {
      return NextResponse.json(
        {
          error:
            "Configuration can only be saved while the job is in READY status.",
        },
        { status: 400 }
      );
    }

    const normalizedConfiguration: TestmoMappingConfiguration =
      normalizeMappingConfiguration(configuration);
    const serializedConfiguration = serializeMappingConfiguration(
      normalizedConfiguration
    ) as JsonValue;

    const updateData: TestmoImportJobUpdateArgs["data"] = {
      configuration: serializedConfiguration,
      statusMessage: "Mapping configuration saved",
      updatedAt: new Date(),
    };

    if (options !== undefined) {
      updateData.options =
        options === null
          ? JsonNull
          : (JSON.parse(JSON.stringify(options)) as JsonValue);
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

    // db is the policy-enhanced client; its update<T> generic instantiates too
    // deeply for tsc here (TS2589). updateData is already typed at its
    // declaration above, so the args cast only sidesteps the depth limit.
    const updatedJob = await db.testmoImportJob.update({
      where: { id: jobId },
      data: updateData,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

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
