import { getCurrentTenantId } from "@/lib/multiTenantPrisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAutoTagQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

const submitSchema = z.object({
  entityIds: z.array(z.number()).min(1),
  entityType: z.enum(["repositoryCase", "testRun", "session"]),
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
        { status: 400 },
      );
    }

    const queue = getAutoTagQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 },
      );
    }

    const job = await queue.add("analyze-tags", {
      ...parsed.data,
      userId: session.user.id,
      tenantId: getCurrentTenantId(),
    });

    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    console.error("Auto-tag submit error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
