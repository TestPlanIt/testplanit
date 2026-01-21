import { NextRequest, NextResponse } from "next/server";
import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";
import { z } from "zod/v4";

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
  isActive: z.boolean().optional(),
  isApi: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  image: z.string().nullable().optional(),
  access: z.enum(["NONE", "USER", "PROJECTADMIN", "ADMIN"]).optional(),
  roleId: z.number().int().optional(),
  userPreferences: z
    .object({
      theme: z.enum(["Light", "Dark", "System", "Green", "Orange", "Purple"]).optional(),
      locale: z.enum(["en_US", "es_ES", "fr_FR"]).optional(),
      itemsPerPage: z.enum(["P10", "P25", "P50", "P100", "P250"]).optional(),
      dateFormat: z.enum([
        "MM_DD_YYYY_SLASH",
        "MM_DD_YYYY_DASH",
        "DD_MM_YYYY_SLASH",
        "DD_MM_YYYY_DASH",
        "YYYY_MM_DD",
        "MMM_D_YYYY",
        "D_MMM_YYYY",
      ]).optional(),
      timeFormat: z.enum(["HH_MM", "HH_MM_A", "HH_MM_Z", "HH_MM_Z_A"]).optional(),
      timezone: z.string().optional(),
      notificationMode: z.enum([
        "NONE",
        "USE_GLOBAL",
        "IN_APP",
        "IN_APP_EMAIL_IMMEDIATE",
        "IN_APP_EMAIL_DAILY",
      ]).optional(),
      emailNotifications: z.boolean().optional(),
      inAppNotifications: z.boolean().optional(),
    })
    .optional(),
});

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await getServerAuthSession();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    // Build the update operations
    const userUpdate: any = {};
    if (validatedData.name !== undefined) {
      userUpdate.name = validatedData.name;
    }
    if (validatedData.email !== undefined) {
      userUpdate.email = validatedData.email;
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
    const updatedUser = await prisma.$transaction(async (tx) => {
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
                validatedData.userPreferences.dateFormat ||
                "MM_DD_YYYY_DASH",
              timeFormat: validatedData.userPreferences.timeFormat || "HH_MM_A",
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

    return NextResponse.json({ data: updatedUser }, { status: 200 });
  } catch (error: any) {
    console.error("[User Update API] Error updating user:", error);

    // Handle Prisma unique constraint violation
    if (error.code === "P2002") {
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
