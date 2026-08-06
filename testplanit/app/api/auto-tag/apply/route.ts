import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { updateAuditContext } from "~/lib/auditContext";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { baseDb } from "~/lib/db";
import { authOptions } from "~/server/auth";

const applySchema = z.object({
  suggestions: z
    .array(
      z.object({
        entityId: z.number(),
        entityType: z.enum(["repositoryCase", "testRun", "session"]),
        tagName: z.string().min(1).max(255),
      })
    )
    .min(1),
});

export const POST = withAuditContext(async (request: NextRequest) => {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  updateAuditContext({ userId: session.user.id });

  try {
    const body = await request.json();
    const parsed = applySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { suggestions } = parsed.data;

    // Deduplicate tag names
    const uniqueTagNames = [...new Set(suggestions.map((s) => s.tagName))];

    // Check which tags already exist before the transaction — case-insensitive
    // and active only. Tag identity is case-insensitive everywhere else in the
    // app (see app/api/admin/tags/create/route.ts); an exact `in` match here
    // let the LLM tagger create fresh "regression"/"Regression"-style
    // duplicates whenever it suggested a different casing than what already
    // existed.
    const existingTags = await baseDb.tags.findMany({
      where: {
        isDeleted: false,
        OR: uniqueTagNames.map((name) => ({
          name: { equals: name, mode: "insensitive" as const },
        })),
      },
      select: { id: true, name: true },
    });

    // Map each suggested name (whatever case the LLM produced) to the id of
    // the existing tag it case-insensitively matches, if any.
    const tagMap = new Map<string, number>();
    for (const suggestedName of uniqueTagNames) {
      const match = existingTags.find(
        (t) => t.name.toLowerCase() === suggestedName.toLowerCase()
      );
      if (match) tagMap.set(suggestedName, match.id);
    }

    // Upsert genuinely new tags outside the transaction (idempotent, safe
    // without tx). A case-variant may exist soft-deleted — restore that
    // instead of creating a duplicate, mirroring the admin/CLI tag flows.
    const newTagNames = uniqueTagNames.filter((n) => !tagMap.has(n));
    for (const name of newTagNames) {
      const deletedTag = await baseDb.tags.findFirst({
        where: { name: { equals: name, mode: "insensitive" }, isDeleted: true },
        select: { id: true },
      });
      const tag = deletedTag
        ? await baseDb.tags.update({
            where: { id: deletedTag.id },
            data: { isDeleted: false },
          })
        : await baseDb.tags.upsert({
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
    await auditedTransaction(async (tx) => {
      for (const [key, tagIds] of entityOps) {
        const [entityType, entityIdStr] = key.split(":");
        const entityId = Number(entityIdStr);
        const connectData = tagIds.map((id) => ({ id }));

        switch (entityType) {
          case "repositoryCase": {
            // Ensure the case exists so a missing entity still rolls back
            // the transaction (preserves "Record to update not found").
            const existingCase = await tx.repositoryCases.findUnique({
              where: { id: entityId },
              select: { id: true },
            });
            if (!existingCase) {
              throw new Error("Record to update not found");
            }
            await tx.repositoryCaseTag.createMany({
              data: tagIds.map((tagId) => ({
                caseId: entityId,
                tagId,
              })),
              skipDuplicates: true,
            });
            break;
          }
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
    });

    return NextResponse.json({
      applied: suggestions.length,
      tagsCreated: newTagNames.length,
      tagsReused: uniqueTagNames.length - newTagNames.length,
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
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to apply tags" },
      { status: 500 }
    );
  }
});
