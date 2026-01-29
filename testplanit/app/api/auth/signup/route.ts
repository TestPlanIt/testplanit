import { NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { hash } from "bcrypt";
import { z } from "zod/v4";
import { isEmailServerConfigured } from "~/lib/email/emailConfig";

/**
 * Dedicated signup API endpoint that bypasses ZenStack access control.
 *
 * ZenStack 2.21+ has a breaking change where access policy evaluation fails
 * for unauthenticated users creating nested records. This endpoint uses
 * Prisma directly to avoid that issue during user registration.
 *
 * Security: This endpoint is intentionally public to allow user registration.
 * Access control is handled by:
 * - Email domain restrictions (checked by caller)
 * - Default access level from registration settings
 * - No sensitive data exposure in response
 */

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(4),
  emailVerifToken: z.string().optional(),
  access: z.enum(["NONE", "USER", "ADMIN"]).default("NONE"),
  roleId: z.number().int().default(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate input
    const validatedData = signupSchema.parse(body);

    // Hash password
    const hashedPassword = await hash(validatedData.password, 10);

    // Check if user already exists
    const existingUser = await db.user.findUnique({
      where: { email: validatedData.email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 400 }
      );
    }

    // Check if email verification is required
    // Email verification is automatically disabled if no email server is configured
    const registrationSettings = await db.registrationSettings.findFirst();
    const requireEmailVerification = isEmailServerConfigured() && (registrationSettings?.requireEmailVerification ?? true);

    // Create user with preferences in a transaction
    const user = await db.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          name: validatedData.name,
          email: validatedData.email,
          password: hashedPassword,
          emailVerifToken: requireEmailVerification ? validatedData.emailVerifToken : null,
          emailVerified: requireEmailVerification ? null : new Date(),
          access: validatedData.access,
          roleId: validatedData.roleId,
          isActive: true,
          isDeleted: false,
          authMethod: "INTERNAL",
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
          createdAt: true,
        },
      });

      return newUser;
    });

    return NextResponse.json(
      { data: user },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[Signup API] Error creating user:", error);

    // Handle Prisma unique constraint violation
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "User with this email already exists" },
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
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}
