import { getCurrentTenantId } from "@/lib/multiTenantDb";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getDuplicateScanQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

const submitSchema = z.object({
  projectId: z.number(),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = submitSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const queue = getDuplicateScanQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 }
      );
    }

    // Prevent duplicate concurrent scans for the same project+tenant
    const tenantId = getCurrentTenantId();
    const existingJobs = await queue.getJobs(["active", "waiting"]);
    const existing = existingJobs.find(
      (j) =>
        j.data?.projectId === parsed.data.projectId &&
        j.data?.tenantId === tenantId
    );
    if (existing) {
      return NextResponse.json({ jobId: existing.id });
    }

    const job = await queue.add("scan-project", {
      projectId: parsed.data.projectId,
      userId: session.user.id,
      tenantId,
    });

    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    console.error("Duplicate scan submit error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
