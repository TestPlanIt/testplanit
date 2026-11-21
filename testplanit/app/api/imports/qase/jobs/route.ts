import type { JsonArray } from "@zenstackhq/orm";
import { NextRequest, NextResponse } from "next/server";
import { enqueueWithAuditContext } from "~/lib/auditContextEnqueue";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { getCurrentTenantId } from "~/lib/multiTenantDb";
import { getQaseImportQueue } from "~/lib/queues";
import { db } from "~/server/db";
import {
  JOB_PROCESS_QASE_IMPORT,
  listQaseProjects,
  serializeQaseImportJob,
} from "~/services/imports/qase/jobPresenter";
import { QaseClient } from "~/services/imports/qase/qaseClient";
import { encrypt } from "~/utils/encryption";
import {
  qaseErrorResponse,
  readConnection,
  requireAdminSession,
  unauthorized,
} from "../shared";

/** Creates a job for the chosen projects and queues the fetch from Qase. */
const handlePOST = withAuditContext(async (request: NextRequest) => {
  const session = await requireAdminSession();
  if (!session) {
    return unauthorized();
  }

  const body = await request.json().catch(() => null);
  const connection = readConnection(body);
  const projectCodes: unknown = body?.projectCodes;
  if (
    !connection ||
    !Array.isArray(projectCodes) ||
    projectCodes.length === 0 ||
    projectCodes.some((code) => typeof code !== "string")
  ) {
    return NextResponse.json(
      { error: "A Qase API token and at least one project are required" },
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

  try {
    const client = new QaseClient(connection);
    const selected = new Set(projectCodes as string[]);
    const projects = (await listQaseProjects(client)).filter((project) =>
      selected.has(project.code)
    );
    if (projects.length !== selected.size) {
      return NextResponse.json(
        { error: "A selected project was not found in Qase" },
        { status: 400 }
      );
    }

    const job = await db.qaseImportJob.create({
      data: {
        createdById: session.user.id,
        apiHost: client.host,
        apiToken: await encrypt(connection.token),
        projects: projects as unknown as JsonArray,
        phase: "FETCHING",
        statusMessage: "Queued",
      },
    });

    await enqueueWithAuditContext(queue, JOB_PROCESS_QASE_IMPORT, {
      jobId: job.id,
      mode: "fetch" as const,
      tenantId: getCurrentTenantId(),
    });

    return NextResponse.json(
      { job: serializeQaseImportJob(job) },
      { status: 201 }
    );
  } catch (error) {
    const response = qaseErrorResponse(error);
    if (response) {
      return response;
    }
    console.error("Failed to queue Qase import job", error);
    return NextResponse.json(
      { error: "Failed to queue Qase import job" },
      { status: 500 }
    );
  }
});

export const POST = withRequestRouting(handlePOST);

async function handleGET(request: NextRequest) {
  const session = await requireAdminSession();
  if (!session) {
    return unauthorized();
  }

  const limitParam = new URL(request.url).searchParams.get("limit");
  const limit = limitParam ? Math.min(Number(limitParam) || 10, 100) : 10;

  const jobs = await db.qaseImportJob.findMany({
    where: { createdById: session.user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ jobs: jobs.map(serializeQaseImportJob) });
}

export const GET = withRequestRouting(handleGET);
