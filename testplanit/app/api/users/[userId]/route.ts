import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import {
  Access,
  DateFormat,
  ItemsPerPage,
  Locale,
  NotificationMode,
  Theme,
  TimeFormat,
} from "~/zenstack/models";
import { updateAuditContext } from "~/lib/auditContext";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { getServerAuthSession } from "~/server/auth";
import { invalidateSessionUserCache } from "~/lib/session-cache";

/**
 * Dedicated user update API endpoint that bypasses ZenStack access control.
 *
 * ZenStack 2.21+ has a breaking change where access policy evaluation fails
 * for nested update operations (e.g., updating User + UserPreferences together).
 * This endpoint uses Prisma directly to avoid that issue.
 *
 * Security: This endpoint requires authentication and enforces:
 * - Users can only update themselves OR
 * - Admin users can update any user
 */

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  emailVerified: z.date().or(z.string().datetime()).optional(),
  isActive: z.boolean().optional(),
  isApi: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  image: z.string().nullable().optional(),
  access: z.enum(Access).optional(),
  roleId: z.number().int().optional(),
  userPreferences: z
    .object({
      theme: z.enum(Theme).optional(),
      locale: z.enum(Locale).optional(),
      itemsPerPage: z.enum(ItemsPerPage).optional(),
      dateFormat: z.enum(DateFormat).optional(),
      timeFormat: z.enum(TimeFormat).optional(),
      timezone: z.string().optional(),
      notificationMode: z.enum(NotificationMode).optional(),
      emailNotifications: z.boolean().optional(),
      inAppNotifications: z.boolean().optional(),
    })
    .optional(),
});

export const PATCH = withAuditContext(
  async (
    req: NextRequest,
    context: { params: Promise<{ userId: string }> }
  ) => {
    try {
      const session = await getServerAuthSession();

      if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      updateAuditContext({ userId: session.user.id });

      const params = await context.params;
      const { userId } = params;

      // Check authorization: user can update themselves OR admin can update anyone
      if (session.user.id !== userId && session.user.access !== "ADMIN") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const body = await req.json();
      const validatedData = updateUserSchema.parse(body);

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
        include: { userPreferences: true },
      });

      if (!existingUser) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // SCIM-managed users have IdP-owned identity fields. Reject attempts to
      // mutate them via this endpoint; the SCIM service writes via raw prisma
      // and bypasses this guard. Schema @deny rules cover the enhanced-client
      // paths; this guard covers this dedicated REST endpoint.
      const isScimManaged = existingUser.scimGivenName !== null;
      if (isScimManaged) {
        const lockedFields = ["name", "email", "isActive"] as const;
        const attempted = lockedFields.filter(
          (f) => (validatedData as Record<string, unknown>)[f] !== undefined
        );
        if (attempted.length > 0) {
          return NextResponse.json(
            {
              error: `Cannot update SCIM-managed fields: ${attempted.join(", ")}. Manage these fields from your identity provider.`,
            },
            { status: 403 }
          );
        }
      }

      // Build the update operations
      const userUpdate: any = {};
      if (validatedData.name !== undefined) {
        userUpdate.name = validatedData.name;
      }
      if (validatedData.email !== undefined) {
        userUpdate.email = validatedData.email;
      }
      // Only admins can update emailVerified - regular users must use the email verification flow
      if (validatedData.emailVerified !== undefined) {
        if (session.user.access !== "ADMIN") {
          return NextResponse.json(
            { error: "Only admins can update email verification status" },
            { status: 403 }
          );
        }
        userUpdate.emailVerified =
          validatedData.emailVerified instanceof Date
            ? validatedData.emailVerified
            : new Date(validatedData.emailVerified);
      }
      if (validatedData.isActive !== undefined) {
        userUpdate.isActive = validatedData.isActive;
      }
      if (validatedData.isApi !== undefined) {
        userUpdate.isApi = validatedData.isApi;
      }
      if (validatedData.isDeleted !== undefined) {
        userUpdate.isDeleted = validatedData.isDeleted;
      }
      if (validatedData.image !== undefined) {
        userUpdate.image = validatedData.image;
      }
      if (validatedData.access !== undefined) {
        userUpdate.access = validatedData.access;
      }
      if (validatedData.roleId !== undefined) {
        userUpdate.roleId = validatedData.roleId;
      }

      // Update user and preferences in a transaction
      const updatedUser = await auditedTransaction(async (tx) => {
        // Update user basic fields if any
        if (Object.keys(userUpdate).length > 0) {
          await tx.user.update({
            where: { id: userId },
            data: userUpdate,
          });
        }

        // Update preferences if provided
        if (validatedData.userPreferences) {
          // Filter out undefined values to avoid Prisma type errors
          const prefsData = Object.fromEntries(
            Object.entries(validatedData.userPreferences).filter(
              ([_, value]) => value !== undefined
            )
          );

          if (existingUser.userPreferences) {
            // Update existing preferences
            await tx.userPreferences.update({
              where: { userId: userId },
              data: prefsData as any,
            });
          } else {
            // Create preferences if they don't exist
            await tx.userPreferences.create({
              data: {
                userId: userId,
                ...validatedData.userPreferences,
                // Set defaults for required fields not in the update
                theme: validatedData.userPreferences.theme || "Light",
                locale: validatedData.userPreferences.locale || "en_US",
                itemsPerPage:
                  validatedData.userPreferences.itemsPerPage || "P10",
                dateFormat:
                  validatedData.userPreferences.dateFormat || "MM_DD_YYYY_DASH",
                timeFormat:
                  validatedData.userPreferences.timeFormat || "HH_MM_A",
                timezone: validatedData.userPreferences.timezone || "Etc/UTC",
              },
            });
          }
        }

        // Fetch the updated user with preferences
        return await tx.user.findUnique({
          where: { id: userId },
          include: { userPreferences: true },
        });
      });

      // Invalidate session cache so header/menu reflect changes immediately
      await invalidateSessionUserCache(userId);

      return NextResponse.json({ data: updatedUser }, { status: 200 });
    } catch (error: any) {
      console.error("[User Update API] Error updating user:", error);

      // Handle unique constraint violation
      if (isUniqueConstraintError(error)) {
        return NextResponse.json(
          { error: "Email already exists" },
          { status: 400 }
        );
      }

      // Handle validation errors
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Invalid input", details: error.issues },
          { status: 400 }
        );
      }

      return NextResponse.json(
        { error: "Failed to update user" },
        { status: 500 }
      );
    }
  }
);
