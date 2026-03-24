import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "~/lib/prisma";
import { authOptions } from "~/server/auth";

const querySchema = z.object({
  projectId: z.coerce.number(),
  cursor: z.coerce.number().optional(),
  limit: z.coerce.number().min(1).default(25),
});

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      projectId: url.searchParams.get("projectId"),
      cursor: url.searchParams.get("cursor") || undefined,
      limit: url.searchParams.get("limit") || undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { projectId, cursor, limit } = parsed.data;
    const take = limit + 1; // Fetch one extra for nextCursor detection

    const items = await prisma.duplicateScanResult.findMany({
      where: { projectId, isDeleted: false, status: "PENDING" },
      orderBy: { score: "desc" },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        caseA: { select: { id: true, name: true, source: true, automated: true } },
        caseB: { select: { id: true, name: true, source: true, automated: true } },
      },
    });

    const nextCursor = items.length === take ? items[limit].id : null;

    return NextResponse.json({
      items: items.slice(0, limit),
      nextCursor,
    });
  } catch (error) {
    console.error("Duplicate scan candidates error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
