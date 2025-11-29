import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";
import { buildMappingAnalysis } from "~/services/imports/testmo/mappingAnalysis";
import type { TestmoMappingAnalysis } from "~/services/imports/testmo/types";

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

    const job = await db.testmoImportJob.findUnique({
      where: { id: jobId },
      include: { datasets: true },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.createdById !== session.user.id && session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (job.status !== "READY" && job.status !== "RUNNING" && job.status !== "COMPLETED") {
      return NextResponse.json(
        { error: "Analysis is only available after the export has been analyzed" },
        { status: 400 }
      );
    }

    let analysis: TestmoMappingAnalysis | null = null;

    const jobAnalysis = job.analysis as unknown;
    if (
      jobAnalysis &&
      typeof jobAnalysis === "object" &&
      !Array.isArray(jobAnalysis)
    ) {
      analysis = jobAnalysis as TestmoMappingAnalysis;
    }

    const hasConfigurationData = Boolean(
      analysis?.ambiguousEntities?.configurations &&
        analysis?.existingEntities?.configurationCategories &&
        analysis?.existingEntities?.configurationVariants &&
        analysis?.existingEntities?.configurations
    );

    const needsRecompute =
      !analysis ||
      !analysis.ambiguousEntities ||
      !analysis.existingEntities ||
      !hasConfigurationData;

    if (needsRecompute) {
      const computedAnalysis = await buildMappingAnalysis(job);
      const serializableAnalysis = JSON.parse(
        JSON.stringify(computedAnalysis)
      );

      await db.testmoImportJob.update({
        where: { id: jobId },
        data: {
          analysis: serializableAnalysis,
          analysisGeneratedAt: new Date(),
        },
      });

      analysis = computedAnalysis;
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error("Failed to build Testmo mapping analysis", error);
    return NextResponse.json(
      { error: "Failed to build Testmo mapping analysis" },
      { status: 500 }
    );
  }
}
