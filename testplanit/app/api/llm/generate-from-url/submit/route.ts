import { getCurrentTenantId } from "@/lib/multiTenantPrisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { getGenerateFromUrlQueue } from "~/lib/queues";
import { authOptions } from "~/server/auth";

const submitSchema = z.object({
  projectId: z.number(),
  url: z.string().url(),
  options: z
    .object({
      followLinks: z.boolean().default(false),
      maxDepth: z.number().int().min(1).max(5).default(2),
      maxPages: z.number().int().min(1).max(50).default(10),
    })
    .default({ followLinks: false, maxDepth: 2, maxPages: 10 }),
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

    const queue = getGenerateFromUrlQueue();
    if (!queue) {
      return NextResponse.json(
        { error: "Background job queue is not available" },
        { status: 503 },
      );
    }

    const job = await queue.add("generate-from-url", {
      ...parsed.data,
      userId: session.user.id,
      tenantId: getCurrentTenantId(),
    });

    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    console.error("Generate from URL submit error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
