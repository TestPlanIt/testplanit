import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { prisma } from "~/lib/prisma";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { getServerAuthSession } from "~/server/auth";

/**
 * Admin tag-create endpoint with atomic soft-delete detection.
 *
 * Replaces the previous client-side pattern (pre-load all tags via
 * `useFindManyTags`, scan locally for case-insensitive duplicates,
 * then `useCreateTags`). At enterprise scale (10k+ tags) the pre-load
 * is expensive (memory + bandwidth + first-open latency) and races the
 * submit click — the user can submit before the cache resolves and the
 * P2002 path masks the soft-deleted-tag detection.
 *
 *   - 201 + { data: <new tag> }                     happy path
 *   - 409 + { code: "RESTORE_REQUIRED", tagId, name }
 *                                                   soft-deleted tag with
 *                                                   this name (case-insensitive
 *                                                   match) exists; client
 *                                                   shows the restore option
 *                                                   directly off this body
 *   - 409 + { code: "EXISTS_ACTIVE", name }         active tag with this
 *                                                   name exists
 *   - 400                                           validation error
 *   - 401 / 403                                     non-admin caller
 *
 * Note on case sensitivity: the existing client-side check is
 * case-insensitive, but the DB unique constraint on `Tags.name` is
 * case-sensitive. We preserve the case-insensitive UX by querying with
 * `mode: "insensitive"`. (A real fix would be a case-insensitive DB
 * constraint via citext or a generated lower-name column; out of scope
 * here.)
 */

const createSchema = z.object({
  name: z.string().min(1),
});

// Wrapped in withAuditContext so the audit entry emitted by the prisma.tags
// create hook carries the actor: the wrapper seeds the ALS frame and the
// NextAuth session callback (fired by getServerAuthSession below) enriches it
// with userId/userEmail/userName. Without the frame that enrichment is a no-op.
export const POST = withAuditContext(async (req: NextRequest) => {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof createSchema>;
  try {
    const raw = await req.json();
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }
    body = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Detection step (case-insensitive match per existing UX).
  const existing = await prisma.tags.findFirst({
    where: { name: { equals: body.name, mode: "insensitive" } },
    select: { id: true, name: true, isDeleted: true },
  });

  if (existing) {
    if (existing.isDeleted) {
      return NextResponse.json(
        {
          code: "RESTORE_REQUIRED",
          tagId: existing.id,
          name: existing.name,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { code: "EXISTS_ACTIVE", name: existing.name },
      { status: 409 }
    );
  }

  try {
    const newTag = await prisma.tags.create({
      data: { name: body.name },
      select: { id: true, name: true },
    });
    return NextResponse.json({ data: newTag }, { status: 201 });
  } catch (err) {
    // Race: another request created a case-variant of this name between
    // detection and create (DB constraint is case-sensitive, so two
    // requests with "Foo" and "foo" can both pass detection). Fall back
    // to the same detection logic.
    if (isUniqueConstraintError(err)) {
      const racing = await prisma.tags.findFirst({
        where: { name: { equals: body.name, mode: "insensitive" } },
        select: { id: true, name: true, isDeleted: true },
      });
      if (racing?.isDeleted) {
        return NextResponse.json(
          {
            code: "RESTORE_REQUIRED",
            tagId: racing.id,
            name: racing.name,
          },
          { status: 409 }
        );
      }
      if (racing) {
        return NextResponse.json(
          { code: "EXISTS_ACTIVE", name: racing.name },
          { status: 409 }
        );
      }
    }
    console.error("[admin/tags/create] error:", err);
    return NextResponse.json(
      { error: "Failed to create tag" },
      { status: 500 }
    );
  }
});
