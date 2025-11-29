import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { db } from "~/server/db";

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

    if (!jobId || typeof jobId !== "string") {
      return NextResponse.json(
        { error: "Invalid job id" },
        { status: 400 }
      );
    }

    const datasets = await db.testmoImportDataset.findMany({
      where: {
        jobId,
        job: {
          createdById: session.user.id,
        },
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        rowCount: true,
        sampleRowCount: true,
        truncated: true,
      },
    });

    return NextResponse.json({ datasets });
  } catch (error) {
    console.error("Failed to list Testmo dataset summaries", error);
    return NextResponse.json(
      { error: "Failed to list Testmo dataset summaries" },
      { status: 500 }
    );
  }
}
