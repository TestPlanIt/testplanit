/**
 * API Token Creation Endpoint
 *
 * POST /api/api-tokens - Create a new API token
 *
 * This endpoint is needed because we generate the token server-side
 * and return the plaintext token to the user only once.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/lib/prisma";
import { generateApiToken } from "~/lib/api-tokens";
import { z } from "zod/v4";

// Accept either ISO datetime (2025-12-31T00:00:00Z) or date-only (2025-12-31)
const dateOrDatetimeSchema = z.string().refine(
  (val) => {
    // Check for ISO datetime format
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(val)) {
      return !isNaN(Date.parse(val));
    }
    // Check for date-only format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      return !isNaN(Date.parse(val));
    }
    return false;
  },
  { message: "Invalid date format. Use YYYY-MM-DD or ISO datetime." }
);

const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: dateOrDatetimeSchema.optional().nullable(),
});

export async function POST(request: NextRequest) {
  const session = await getServerAuthSession();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const validated = createTokenSchema.parse(body);

    // Generate the token
    const { plaintext, hash, prefix } = generateApiToken();

    // Create the token record
    const apiToken = await prisma.apiToken.create({
      data: {
        name: validated.name,
        token: hash,
        tokenPrefix: prefix,
        userId: session.user.id,
        expiresAt: validated.expiresAt ? new Date(validated.expiresAt) : null,
      },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        createdAt: true,
        expiresAt: true,
        isActive: true,
      },
    });

    // Return the token with the plaintext (only time it's ever shown)
    return NextResponse.json({
      ...apiToken,
      // Include the plaintext token - user must save this now, it won't be shown again
      token: plaintext,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }

    console.error("Error creating API token:", error);
    return NextResponse.json(
      { error: "Failed to create API token" },
      { status: 500 }
    );
  }
}
