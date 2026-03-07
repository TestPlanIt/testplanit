import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "~/server/auth";
import { prisma } from "~/lib/prisma";

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

    const result = await prisma.$transaction(async (tx) => {
      // Upsert all tags upfront (findOrCreate pattern)
      const tagMap = new Map<string, number>();

      for (const name of uniqueTagNames) {
        const tag = await tx.tags.upsert({
          where: { name },
          create: { name },
          update: {}, // no-op if exists
        });
        tagMap.set(name, tag.id);
      }

      // Connect tags to entities
      for (const suggestion of suggestions) {
        const tagId = tagMap.get(suggestion.tagName)!;

        switch (suggestion.entityType) {
          case "repositoryCase":
            await tx.repositoryCases.update({
              where: { id: suggestion.entityId },
              data: { tags: { connect: { id: tagId } } },
            });
            break;
          case "testRun":
            await tx.testRuns.update({
              where: { id: suggestion.entityId },
              data: { tags: { connect: { id: tagId } } },
            });
            break;
          case "session":
            await tx.sessions.update({
              where: { id: suggestion.entityId },
              data: { tags: { connect: { id: tagId } } },
            });
            break;
        }
      }

      return tagMap;
    });

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
