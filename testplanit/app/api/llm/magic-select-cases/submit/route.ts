import { getCurrentTenantId } from "@/lib/multiTenantPrisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getMagicSelectQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

const submitSchema = z.object({
  projectId: z.number(),
  testRunMetadata: z.object({
    name: z.string().min(1),
    description: z.unknown().nullable(),
    docs: z.unknown().nullable(),
    linkedIssueIds: z.array(z.number()),
    tags: z.array(z.string()).optional(),
  }),
  clarification: z.string().optional(),
  excludeCaseIds: z.array(z.number()).optional(),
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

    const queue = getMagicSelectQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 },
      );
    }

    const job = await queue.add("select-cases", {
      ...parsed.data,
      userId: session.user.id,
      tenantId: getCurrentTenantId(),
    });

    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    console.error("Magic select submit error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
