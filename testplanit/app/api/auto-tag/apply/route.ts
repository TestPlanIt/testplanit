import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "~/lib/prisma";
import { authOptions } from "~/server/auth";

const applySchema = z.object({
  suggestions: z
    .array(
      z.object({
        entityId: z.number(),
        entityType: z.enum(["repositoryCase", "testRun", "session"]),
        tagName: z.string().min(1).max(255),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const parsed = applySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { suggestions } = parsed.data;

    // Deduplicate tag names
    const uniqueTagNames = [...new Set(suggestions.map((s) => s.tagName))];

    // Check which tags already exist before the transaction
    const existingTags = await prisma.tags.findMany({
      where: { name: { in: uniqueTagNames } },
      select: { id: true, name: true },
    });
    const existingTagNames = new Set(existingTags.map((t) => t.name));

    // Upsert all tags outside the transaction (idempotent, safe without tx)
    const tagMap = new Map<string, number>();
    for (const tag of existingTags) {
      tagMap.set(tag.name, tag.id);
    }
    const newTagNames = uniqueTagNames.filter((n) => !existingTagNames.has(n));
    for (const name of newTagNames) {
      const tag = await prisma.tags.upsert({
        where: { name },
        create: { name },
        update: {},
      });
      tagMap.set(name, tag.id);
    }

    // Group tag connections by entity to minimize queries
    const entityOps = new Map<string, number[]>();
    for (const suggestion of suggestions) {
      const key = `${suggestion.entityType}:${suggestion.entityId}`;
      const tagId = tagMap.get(suggestion.tagName)!;
      const ids = entityOps.get(key) ?? [];
      ids.push(tagId);
      entityOps.set(key, ids);
    }

    // Connect tags to entities in a single transaction with extended timeout
    await prisma.$transaction(
      async (tx) => {
        for (const [key, tagIds] of entityOps) {
          const [entityType, entityIdStr] = key.split(":");
          const entityId = Number(entityIdStr);
          const connectData = tagIds.map((id) => ({ id }));

          switch (entityType) {
            case "repositoryCase":
              await tx.repositoryCases.update({
                where: { id: entityId },
                data: { tags: { connect: connectData } },
              });
              break;
            case "testRun":
              await tx.testRuns.update({
                where: { id: entityId },
                data: { tags: { connect: connectData } },
              });
              break;
            case "session":
              await tx.sessions.update({
                where: { id: entityId },
                data: { tags: { connect: connectData } },
              });
              break;
          }
        }
      },
      { timeout: 30000 },
    );

    const tagsCreated = uniqueTagNames.filter(
      (name) => !existingTagNames.has(name),
    ).length;

    return NextResponse.json({
      applied: suggestions.length,
      tagsCreated,
      tagsReused: uniqueTagNames.length - tagsCreated,
    });
  } catch (error: any) {
    console.error("Auto-tag apply error:", error);

    // Entity not found during update causes transaction rollback
    const message = error?.message || "";
    if (
      message.includes("Record to update not found") ||
      message.includes("not found")
    ) {
      return NextResponse.json(
        { error: "One or more entities not found" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Failed to apply tags" },
      { status: 500 },
    );
  }
}
