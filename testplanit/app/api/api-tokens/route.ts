/**
 * API Token Creation Endpoint
 *
 * POST /api/api-tokens - Create a new API token
 *
 * This endpoint is needed because we generate the token server-side
 * and return the plaintext token to the user only once.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { generateApiToken } from "~/lib/api-tokens";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { getServerAuthSession } from "~/server/auth";

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

/**
 * Canonical allow-list for API token scope tags.
 *
 * Convention: <namespace>:<value> (see schema.zmodel `ApiToken.scopes` comment).
 * Recognized values:
 *   - "mode:read"   — narrows the token to read-only operations (write methods rejected at the ZenStack chokepoint)
 *   - "client:mcp"  — attributes audit events from this token to the MCP source
 *
 * Exported so the UI (plan 05-04) and any other writer can agree on the same source of truth.
 */
export const ALLOWED_API_TOKEN_SCOPES = ["mode:read", "client:mcp"] as const;
export type ApiTokenScope = (typeof ALLOWED_API_TOKEN_SCOPES)[number];

const createTokenSchema = z.object({
  name: z.string().min(1).max(100),
  expiresAt: dateOrDatetimeSchema.optional().nullable(),
  scopes: z.array(z.enum([...ALLOWED_API_TOKEN_SCOPES])).default([]),
});

export const POST = withAuditContext(async (request: NextRequest) => {
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
        scopes: validated.scopes,
      },
      select: {
        id: true,
        name: true,
        tokenPrefix: true,
        createdAt: true,
        expiresAt: true,
        isActive: true,
        scopes: true,
      },
    });

    // Audit log the token creation
    await captureAuditEvent({
      action: "API_KEY_CREATED",
      entityType: "ApiToken",
      entityId: apiToken.id,
      entityName: apiToken.name,
      userId: session.user.id,
      userEmail: session.user.email || undefined,
      userName: session.user.name || undefined,
      metadata: {
        tokenPrefix: prefix,
        expiresAt: apiToken.expiresAt?.toISOString() || null,
        scopes: validated.scopes,
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
});
