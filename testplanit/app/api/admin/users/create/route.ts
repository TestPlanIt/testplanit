import { hash } from "bcrypt";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { prisma } from "~/lib/prisma";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { getServerAuthSession } from "~/server/auth";

/**
 * Admin user-create endpoint with atomic soft-delete detection.
 *
 * The auto-generated `useCreateUser` ZenStack hook plus a client-side
 * `findFirst({where: {email, isDeleted: true}})` follow-up is racy under
 * heavy load (P2002 → state update → render is multi-step) and was the
 * root cause of the "Admin can restore soft-deleted user" E2E flake.
 *
 * This endpoint collapses detection + create into one server call:
 *   - 201 + { data: <new user> }                    happy path
 *   - 409 + { code: "RESTORE_REQUIRED", userId, name, email }
 *                                                   soft-deleted user with
 *                                                   this email exists; client
 *                                                   shows the restore dialog
 *                                                   directly off this body
 *   - 409 + { code: "EXISTS_ACTIVE", email }        active user with this
 *                                                   email exists
 *   - 400                                           validation error
 *   - 401 / 403                                     non-admin caller
 *
 * Mirrors `/api/auth/signup`'s atomic create-user-with-preferences
 * transaction so the resulting user record is never half-created.
 *
 * Project / group assignments stay client-side (separate calls after
 * 201) — they're independent associations, not part of "create a user".
 */

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(4),
  access: z.enum(["NONE", "USER", "PROJECTADMIN", "ADMIN"]).default("USER"),
  roleId: z.number().int(),
  isActive: z.boolean().default(true),
  isApi: z.boolean().default(false),
  // ISO string OR null OR undefined. Null means "verified now"; undefined
  // means "leave the column unset and follow registration-settings rules".
  emailVerified: z.string().datetime().nullable().optional(),
});

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

  // Detection step: is there already a user (active or soft-deleted) with
  // this email? Doing this *before* the create avoids relying on a P2002
  // round-trip and lets us return RESTORE_REQUIRED with the user info the
  // client needs to populate its restore dialog in one shot.
  const existing = await prisma.user.findUnique({
    where: { email: body.email },
    select: { id: true, name: true, email: true, isDeleted: true },
  });

  if (existing) {
    if (existing.isDeleted) {
      return NextResponse.json(
        {
          code: "RESTORE_REQUIRED",
          userId: existing.id,
          name: existing.name,
          email: existing.email,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { code: "EXISTS_ACTIVE", email: existing.email },
      { status: 409 }
    );
  }

  const hashedPassword = await hash(body.password, 10);

  // Create user + default preferences in one transaction (mirrors
  // /api/auth/signup so we get the same all-or-nothing guarantee).
  try {
    const newUser = await auditedTransaction(async (tx) => {
      return tx.user.create({
        data: {
          name: body.name,
          email: body.email,
          password: hashedPassword,
          access: body.access,
          roleId: body.roleId,
          isActive: body.isActive,
          isApi: body.isApi,
          isDeleted: false,
          authMethod: "INTERNAL",
          // emailVerified: explicit null from caller means "set to now"
          // (admin-created users are pre-verified by default in the UI);
          // explicit ISO string means use that value; undefined means leave
          // null so the verification flow can run.
          emailVerified:
            body.emailVerified === null
              ? new Date()
              : body.emailVerified !== undefined
                ? new Date(body.emailVerified)
                : null,
          userPreferences: {
            create: {
              itemsPerPage: "P10",
              dateFormat: "MM_DD_YYYY_DASH",
              timeFormat: "HH_MM_A",
              theme: "Light",
              locale: "en_US",
            },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          access: true,
          roleId: true,
          isActive: true,
          isApi: true,
          createdAt: true,
        },
      });
    });

    return NextResponse.json({ data: newUser }, { status: 201 });
  } catch (err: any) {
    // Race: another request created the same email between detection and
    // create. Fall back to the same detection logic so the client still
    // gets a structured RESTORE_REQUIRED / EXISTS_ACTIVE response.
    if (isUniqueConstraintError(err)) {
      const racing = await prisma.user.findUnique({
        where: { email: body.email },
        select: { id: true, name: true, email: true, isDeleted: true },
      });
      if (racing?.isDeleted) {
        return NextResponse.json(
          {
            code: "RESTORE_REQUIRED",
            userId: racing.id,
            name: racing.name,
            email: racing.email,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { code: "EXISTS_ACTIVE", email: body.email },
        { status: 409 }
      );
    }
    console.error("[admin/users/create] error:", err);
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
});
