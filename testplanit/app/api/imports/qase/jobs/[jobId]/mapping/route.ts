import type { JsonObject } from "@zenstackhq/orm";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { rawDb } from "~/lib/rawDb";
import { db } from "~/server/db";
import { buildQaseAnalysis } from "~/services/imports/qase/analysis";
import {
  buildDefaultQaseMapping,
  completeQaseMapping,
  normalizeQaseMapping,
  validateQaseMapping,
} from "~/services/imports/qase/mapping";
import { requireAdminSession, unauthorized } from "../../../shared";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

const notFound = () =>
  NextResponse.json({ error: "Job not found" }, { status: 404 });

const notMappable = () =>
  NextResponse.json(
    { error: "The job's data is not ready to be mapped" },
    { status: 400 }
  );

/** A job can be mapped while its fetched data is still staged. */
const isMappable = (job: { status: string; phase: string | null }) =>
  job.status === "READY" ||
  (job.status === "FAILED" && job.phase === "IMPORTING");

/** The records to map, what they can be mapped to, and the saved mapping. */
async function handleGET(_request: NextRequest, context: RouteContext) {
  if (!(await requireAdminSession())) {
    return unauthorized();
  }
  const { jobId } = await context.params;
  const job = await db.qaseImportJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      phase: true,
      projects: true,
      configuration: true,
    },
  });
  if (!job) {
    return notFound();
  }
  if (!isMappable(job)) {
    return notMappable();
  }
  const analysis = await buildQaseAnalysis(rawDb, job);
  const configuration = job.configuration
    ? completeQaseMapping(normalizeQaseMapping(job.configuration), analysis)
    : buildDefaultQaseMapping(analysis);
  return NextResponse.json({
    analysis,
    configuration,
    problems: validateQaseMapping(configuration, analysis),
  });
}

export const GET = withRequestRouting(handleGET);

/** Saves the mapping and reports what still stops the import. */
const handlePUT = withAuditContext(
  async (request: NextRequest, context: RouteContext) => {
    if (!(await requireAdminSession())) {
      return unauthorized();
    }
    const { jobId } = await context.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.configuration !== "object") {
      return NextResponse.json(
        { error: "A mapping is required" },
        { status: 400 }
      );
    }
    const job = await db.qaseImportJob.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, phase: true, projects: true },
    });
    if (!job) {
      return notFound();
    }
    if (!isMappable(job)) {
      return notMappable();
    }
    const configuration = normalizeQaseMapping(body.configuration);
    const analysis = await buildQaseAnalysis(rawDb, job);
    await db.qaseImportJob.update({
      where: { id: jobId },
      data: { configuration: configuration as unknown as JsonObject },
    });
    return NextResponse.json({
      configuration,
      problems: validateQaseMapping(configuration, analysis),
    });
  }
);

export const PUT = withRequestRouting(handlePUT);
